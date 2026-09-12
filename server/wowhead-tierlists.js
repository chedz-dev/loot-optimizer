import { createHash } from 'node:crypto';
import {
  SNAPSHOT_TTL_MS,
  hasFreshSnapshot,
  loadLatestGuide,
  loadLatestGuides,
  saveGuideSnapshots,
} from './editorial-store.js';
import { WOWHEAD_GUIDES } from './guide-catalog.js';
import { mapWithConcurrency } from './sync-guides.js';
import { localizeGuideItems } from './wowhead-localization.js';

export { WOWHEAD_GUIDES } from './guide-catalog.js';

let synchronization;
let lastSyncErrors = [];

function decodeGuideSource(html) {
  return html
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\\//g, '/')
    .replace(/\\"/g, '"');
}

function decodeEntities(value = '') {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function decodeJsonString(value = '') {
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return value.replace(/\\'/g, "'").replace(/\\"/g, '"');
  }
}

function parseAttributes(source = '') {
  const attributes = {};
  const pattern = /([\w-]+)=(?:"([^"]*)"|([^\s\]]+))/g;
  for (const match of source.matchAll(pattern)) attributes[match[1]] = match[2] ?? match[3];
  return attributes;
}

function noteToPlainText(markup = '') {
  return decodeEntities(markup)
    .replace(/\[item=(\d+)[^\]]*\]/gi, 'Item #$1')
    .replace(/\[spell=(\d+)[^\]]*\]/gi, 'Spell #$1')
    .replace(/\[\/?[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTooltipNotes(decodedHtml) {
  const notes = new Map();
  const pattern = /\[tooltip\s+name=(?:"([^"]+)"|([^\]\s]+))\]([\s\S]*?)\[\/tooltip\]/gi;
  for (const match of decodedHtml.matchAll(pattern)) {
    const name = match[1] || match[2];
    notes.set(name, noteToPlainText(match[3]));
  }
  return notes;
}

function extractItemMetadata(decodedHtml, itemId) {
  const marker = `"${itemId}":{`;
  const index = decodedHtml.indexOf(marker);
  if (index < 0) return { name: `Item ${itemId}`, icon: '' };

  const itemSource = decodedHtml.slice(index, index + 1800);
  const name = itemSource.match(/"name_enus":"((?:\\.|[^"])*)"/);
  const icon = itemSource.match(/"icon":"([^"]+)"/);
  return {
    name: name ? decodeEntities(decodeJsonString(name[1])) : `Item ${itemId}`,
    icon: icon?.[1] || '',
  };
}

function findTierListBlock(decodedHtml) {
  const headingIndex = decodedHtml.toLocaleLowerCase().indexOf('trinket tier list');
  const start = decodedHtml.indexOf('[tier-list=rows grid]', Math.max(0, headingIndex));
  if (start < 0) throw new Error('No se encontró el bloque Trinket Tier List');
  const end = decodedHtml.indexOf('[/tier-list]', start);
  if (end < 0) throw new Error('El bloque Trinket Tier List está incompleto');
  return decodedHtml.slice(start, end + '[/tier-list]'.length);
}

function htmlAttributes(tag) {
  const attributes = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)) attributes[match[1].toLowerCase()] = decodeEntities(match[3]);
  return attributes;
}

function schemaAuthor(author) {
  if (Array.isArray(author)) return author.map(schemaAuthor).filter(Boolean).join(', ');
  if (typeof author === 'string') return decodeEntities(author).trim();
  return typeof author?.name === 'string' ? decodeEntities(author.name).trim() : '';
}

function guidePublicationMetadata(html, decodedHtml, guide) {
  const articles = [];
  function inspectSchema(value) {
    if (Array.isArray(value)) { value.forEach(inspectSchema); return; }
    if (!value || typeof value !== 'object') return;
    const types = [value['@type']].flat();
    if (types.some((type) => ['Article', 'NewsArticle', 'BlogPosting', 'TechArticle'].includes(type))) articles.push(value);
    inspectSchema(value['@graph']);
    inspectSchema(value.mainEntity);
  }
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (htmlAttributes(match[1]).type?.toLowerCase() !== 'application/ld+json') continue;
    try { inspectSchema(JSON.parse(match[2])); } catch { /* Malformed structured data must not invent attribution. */ }
  }
  // If a page embeds several articles, select only its own URL. A solitary
  // Article is a standard page-level schema; breadcrumb and Person nodes are
  // never interpreted as the guide's attribution by themselves.
  const articleUrls = (article) => [article.url, article['@id'], article.mainEntityOfPage?.['@id'], article.mainEntityOfPage]
    .filter((url) => typeof url === 'string' && /^https?:\/\//i.test(url));
  const pageArticle = articles.find((article) => articleUrls(article).some((url) => url.split('#')[0] === guide.url))
    || (articles.length === 1 && articleUrls(articles[0]).length === 0 ? articles[0] : null);
  const meta = new Map();
  for (const match of decodedHtml.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = htmlAttributes(match[0]);
    const name = (attributes.name || attributes.property || attributes.itemprop || '').toLowerCase();
    if (name && attributes.content) meta.set(name, attributes.content.trim());
  }
  const modifiedTime = [...decodedHtml.matchAll(/<time\b[^>]*>/gi)]
    .map((match) => htmlAttributes(match[0]))
    .find((attributes) => attributes.itemprop?.toLowerCase() === 'datemodified')?.datetime;
  const visibleText = decodeEntities(decodedHtml.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
  const visibleUpdated = visibleText.match(/\bUpdated:\s*(\d{4}[/-]\d{2}[/-]\d{2})/i)?.[1];
  return {
    author: schemaAuthor(pageArticle?.author) || meta.get('author') || '',
    pageUpdatedAt: (typeof pageArticle?.dateModified === 'string' ? pageArticle.dateModified : '')
      || meta.get('article:modified_time') || meta.get('datemodified') || modifiedTime || visibleUpdated || '',
  };
}

export function parseWowheadGuideHtml(html, guide) {
  const decodedHtml = decodeGuideSource(html);
  const block = findTierListBlock(decodedHtml);
  const notes = extractTooltipNotes(decodedHtml);
  const tiers = [];
  const tierPattern = /\[tier\]([\s\S]*?)\[\/tier\]/gi;

  for (const tierMatch of block.matchAll(tierPattern)) {
    const tierSource = tierMatch[1];
    const labelMatch = tierSource.match(/\[tier-label[^\]]*\]([^[]+?)\[\/tier-label\]/i);
    if (!labelMatch) continue;

    const label = labelMatch[1].trim();
    const items = [];
    const badgePattern = /\[icon-badge=(\d+)([^\]]*)\]/gi;
    for (const badgeMatch of tierSource.matchAll(badgePattern)) {
      const itemId = Number(badgeMatch[1]);
      const attributes = parseAttributes(badgeMatch[2]);
      const metadata = extractItemMetadata(decodedHtml, itemId);
      const contentTypes = (attributes['display-options'] || 'unknown').split(',').map((entry) => entry.trim()).filter(Boolean);
      items.push({
        itemId,
        name: metadata.name,
        icon: metadata.icon,
        tier: label,
        displayOrder: items.length + 1,
        quality: Number(attributes.quality || 0),
        contentTypes,
        guideNote: attributes.tooltip ? notes.get(attributes.tooltip) || '' : '',
        noteKey: attributes.tooltip || '',
        wowheadUrl: `https://www.wowhead.com/item=${itemId}`,
      });
    }

    if (items.length) tiers.push({ label, items });
  }

  const itemCount = tiers.reduce((total, tier) => total + tier.items.length, 0);
  if (!tiers.length || !itemCount) throw new Error('Wowhead devolvió una tier list sin items');
  const unresolvedItems = tiers.flatMap((tier) => tier.items).filter((item) => !item.icon || item.name === `Item ${item.itemId}`);
  if (unresolvedItems.length) throw new Error(`No se pudieron resolver ${unresolvedItems.length} items de Wowhead`);

  const title = decodedHtml.match(/<title>(.*?)<\/title>/i)?.[1]?.trim() || `${guide.specName} ${guide.className}`;
  const expectedIdentity = `${guide.specName} ${guide.className}`.toLocaleLowerCase();
  if (!title.toLocaleLowerCase().includes(expectedIdentity)) {
    throw new Error(`La guía no coincide con ${guide.specName} ${guide.className}`);
  }

  const patch = decodedHtml.match(/Patch\s+(\d+\.\d+(?:\.\d+)?)/i)?.[1] || '';
  const publication = guidePublicationMetadata(html, decodedHtml, guide);
  return {
    ...guide,
    pageTitle: decodeEntities(title),
    patch,
    ...publication,
    fetchedAt: new Date().toISOString(),
    contentHash: createHash('sha256').update(block).digest('hex'),
    itemCount,
    tierCount: tiers.length,
    tiers,
  };
}

export async function fetchWowheadGuide(guide) {
  const response = await fetch(guide.url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'LootOptimizer/0.1 (cached Wowhead guide reader)',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Wowhead respondió HTTP ${response.status}`);
  return parseWowheadGuideHtml(await response.text(), guide);
}

export async function syncWowheadTierlists({ force = false, guideIds, concurrency = 3 } = {}) {
  if (synchronization) return synchronization;
  const allowedIds = guideIds ? new Set(guideIds) : null;
  const targets = WOWHEAD_GUIDES.filter((guide) => (
    (!allowedIds || allowedIds.has(guide.id))
    && (force || !hasFreshSnapshot('wowhead', guide.id))
  ));
  if (!targets.length) return { source: 'wowhead', attempted: 0, saved: 0, errors: [] };

  synchronization = mapWithConcurrency(targets, concurrency, async (guide) => {
    return fetchWowheadGuide(guide);
  }).then(async (results) => {
    const parsedGuides = results.filter((result) => result.status === 'fulfilled').map((result) => result.value);
    const localization = await localizeGuideItems(parsedGuides);
    const saved = saveGuideSnapshots('wowhead', parsedGuides);
    const errors = results.flatMap((result, index) => result.status === 'rejected'
      ? [{ guideId: targets[index].id, url: targets[index].url, error: result.reason?.message || String(result.reason) }]
      : []);
    lastSyncErrors = errors;
    return { source: 'wowhead', attempted: targets.length, saved: saved.length, snapshots: saved, errors, localizationErrors: localization.errors };
  }).finally(() => { synchronization = null; });
  return synchronization;
}

export async function getWowheadTierlists({ waitForRefresh = false } = {}) {
  const missingBeforeSync = WOWHEAD_GUIDES.filter((guide) => !loadLatestGuide('wowhead', guide.id));
  if (missingBeforeSync.length) {
    await syncWowheadTierlists({ guideIds: missingBeforeSync.map((guide) => guide.id) });
  } else {
    const staleGuides = WOWHEAD_GUIDES.filter((guide) => !hasFreshSnapshot('wowhead', guide.id));
    if (staleGuides.length) {
      const refresh = syncWowheadTierlists({ guideIds: staleGuides.map((guide) => guide.id) });
      if (waitForRefresh) await refresh;
    }
  }

  const guides = loadLatestGuides('wowhead', WOWHEAD_GUIDES.map((guide) => guide.id));
  const missing = WOWHEAD_GUIDES.filter((guide) => !loadLatestGuide('wowhead', guide.id));
  if (missing.length) {
    const failure = lastSyncErrors.find((entry) => missing.some((guide) => guide.id === entry.guideId));
    throw new Error(failure?.error || `No hay snapshot para ${missing.map((guide) => guide.id).join(', ')}`);
  }
  return {
    source: 'Wowhead',
    mode: synchronization ? 'sqlite-stale-refreshing' : 'sqlite-cache',
    storage: 'JSON local',
    cacheHours: SNAPSHOT_TTL_MS / 3_600_000,
    guideCount: guides.length,
    syncErrors: lastSyncErrors,
    guides,
  };
}
