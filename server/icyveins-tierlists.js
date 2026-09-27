import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  SNAPSHOT_TTL_MS,
  hasFreshSnapshot,
  loadLatestGuide,
  loadLatestGuides,
  saveGuideSnapshots,
} from './editorial-store.js';
import { ICYVEINS_GUIDES } from './guide-catalog.js';
import { mapWithConcurrency } from './sync-guides.js';
import { localizeGuideItems } from './wowhead-localization.js';

export { ICYVEINS_GUIDES } from './guide-catalog.js';

let synchronization;
let lastSyncErrors = [];

function decodeEntities(value = '') {
  return value
    .replace(/&mdash;/g, '—')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripHtml(value = '') {
  return decodeEntities(value)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:—-]+/, '')
    .trim();
}

function cleanGuideNote(value = '') {
  const note = stripHtml(value)
    .replace(/^(?:—|-)?\s*click for details\s*$/i, '')
    .trim();
  return note;
}

function findTrinketTable(html, guide) {
  const identity = `${guide.specName} ${guide.className} Trinket Rankings`.toLocaleLowerCase();
  const seasonalIdentity = new RegExp(`\\b${guide.specName}\\s+Season\\s+\\d+\\s+Trinket Rankings\\b`, 'i');
  const openingPattern = /<details[^>]*class="[^"]*trinket-dropdown[^"]*"[^>]*>/gi;
  const openings = [...html.matchAll(openingPattern)];
  for (let index = 0; index < openings.length; index += 1) {
    const start = openings[index].index + openings[index][0].length;
    const end = openings[index + 1]?.index || html.length;
    const details = html.slice(start, end);
    const summaryMatch = details.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
    const summary = stripHtml(summaryMatch?.[1] || '').toLocaleLowerCase();
    if (!summary.includes(identity) && !seasonalIdentity.test(summary)) continue;
    const tableStart = details.indexOf('<table', summaryMatch?.index || 0);
    const tableEnd = details.indexOf('</table>', tableStart);
    if (tableStart < 0 || tableEnd < 0) throw new Error('La tabla de trinkets está incompleta');
    return details.slice(tableStart, tableEnd + '</table>'.length);
  }
  throw new Error(`No se encontró la tabla de ${guide.specName} ${guide.className}`);
}

function iconSlug(source = '') {
  const pathname = source.replace(/^\/\//, 'https://').split('?')[0];
  return path.basename(pathname).replace(/\.(?:jpe?g|png|webp)$/i, '');
}

function parseItemMarkup(markup, tier, displayOrder, noteMarkup = null) {
  const itemMatch = markup.match(/data-wowhead="item=(\d+)(?:&amp;[^"]*)?"[^>]*>([\s\S]*?)<\/span>/i);
  if (!itemMatch) return null;
  const itemId = Number(itemMatch[1]);
  const icon = markup.match(/<img[^>]+class="spell_icon"[^>]+src="([^"]+)"/i)?.[1]
    || markup.match(/<img[^>]+src="([^"]+)"[^>]+class="spell_icon"/i)?.[1]
    || '';
  const quality = Number(markup.match(/class="q(\d+)"/i)?.[1] || 0);
  const itemEnd = (itemMatch.index || 0) + itemMatch[0].length;
  const resolvedNoteMarkup = noteMarkup ?? markup.slice(itemEnd);
  return {
    itemId,
    name: stripHtml(itemMatch[2]),
    icon: iconSlug(icon),
    tier,
    displayOrder,
    quality,
    contentTypes: [],
    guideNote: cleanGuideNote(resolvedNoteMarkup),
    noteKey: '',
    wowheadUrl: `https://www.wowhead.com/item=${itemId}`,
  };
}

// Conserva cada entrada desplegable, incluso cuando comparte un li con otras.
function parseRowItems(row, tier) {
  const candidates = [];
  const listRanges = [];
  const listPattern = /<li\b[^>]*>([\s\S]*?)(?=<li\b|<\/ul>)/gi;

  for (const listMatch of row.matchAll(listPattern)) {
    const start = listMatch.index;
    const end = start + listMatch[0].length;
    listRanges.push({ start, end });
    const detailsMatches = [...listMatch[1].matchAll(/<details\b[^>]*class="[^"]*\blist-item\b[^"]*"[^>]*>([\s\S]*?)<\/details>/gi)];

    if (detailsMatches.length) {
      for (const detailsMatch of detailsMatches) {
        const details = detailsMatch[1];
        const summaryMatch = details.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);

        if (!summaryMatch) {
          throw new Error(`Una entrada desplegable de la tier ${tier} no tiene encabezado`);
        }

        const noteMarkup = details.slice((summaryMatch.index || 0) + summaryMatch[0].length);
        candidates.push({ start: start + detailsMatch.index, markup: summaryMatch[1], noteMarkup });
      }
    } else {
      candidates.push({ start, markup: listMatch[1], noteMarkup: null });
    }
  }

  const detailsPattern = /<details\b[^>]*class="[^"]*\blist-item\b[^"]*"[^>]*>([\s\S]*?)<\/details>/gi;

  for (const detailsMatch of row.matchAll(detailsPattern)) {
    if (listRanges.some((range) => detailsMatch.index >= range.start && detailsMatch.index < range.end)) {
      continue;
    }

    const details = detailsMatch[1];
    const summaryMatch = details.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
    if (!summaryMatch) {
      throw new Error(`Una entrada desplegable de la tier ${tier} no tiene encabezado`);
    }

    const noteMarkup = details.slice((summaryMatch.index || 0) + summaryMatch[0].length);
    candidates.push({ start: detailsMatch.index, markup: summaryMatch[1], noteMarkup });
  }

  const parsed = candidates
    .sort((left, right) => left.start - right.start)
    .map((candidate, index) => ({
      candidate,
      item: parseItemMarkup(candidate.markup, tier, index + 1, candidate.noteMarkup),
    }));
  const unresolved = parsed.filter(({ candidate, item }) => !item && /data-wowhead="item=\d+/i.test(candidate.markup));
  if (unresolved.length) {
    throw new Error(`No se pudieron interpretar ${unresolved.length} entradas de la tier ${tier}`);
  }

  return parsed
    .flatMap(({ item }) => item ? [item] : [])
    .map((item, index) => ({ ...item, displayOrder: index + 1 }));
}

export function parseIcyVeinsGuideHtml(html, guide) {
  const table = findTrinketTable(html, guide);
  const tiers = [];
  for (const rowMatch of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = rowMatch[1];
    const tierMatch = row.match(/<strong>\s*([SABCDF](?:\+)?)\s+Tier\s*<\/strong>/i);
    if (!tierMatch) continue;
    const label = tierMatch[1].toUpperCase();
    const items = parseRowItems(row, label);
    if (!items.length && /data-wowhead="item=\d+/i.test(row)) {
      throw new Error(`La tier ${label} contiene items que el parser no reconoció`);
    }
    if (items.length) tiers.push({ label, items });
  }

  const itemCount = tiers.reduce((total, tier) => total + tier.items.length, 0);
  if (!tiers.length || !itemCount) throw new Error('Icy Veins devolvió una tier list sin items');
  const unresolved = tiers.flatMap((tier) => tier.items).filter((item) => !item.itemId || !item.name);
  if (unresolved.length) throw new Error(`No se pudieron resolver ${unresolved.length} items de Icy Veins`);

  const title = stripHtml(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '');
  const identity = `${guide.specName} ${guide.className}`.toLocaleLowerCase();
  if (!title.toLocaleLowerCase().includes(identity)) throw new Error(`La guía no coincide con ${guide.specName} ${guide.className}`);
  const patch = title.match(/\b(\d+\.\d+(?:\.\d+)?)\b/)?.[1] || '';
  const pageUpdatedAt = html.match(/"dateModified":"([^"]+)"/)?.[1] || '';
  const author = html.match(/"author":\{"name":"([^"]+)"/)?.[1] || '';

  return {
    ...guide,
    pageTitle: title,
    patch,
    author: decodeEntities(author),
    pageUpdatedAt,
    fetchedAt: new Date().toISOString(),
    contentHash: createHash('sha256').update(table).digest('hex'),
    itemCount,
    tierCount: tiers.length,
    tiers,
  };
}

export async function fetchIcyVeinsGuide(guide) {
  const response = await fetch(guide.url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'LootOptimizer/0.1 (cached Icy Veins guide reader)',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Icy Veins respondió HTTP ${response.status}`);
  return parseIcyVeinsGuideHtml(await response.text(), guide);
}

export async function syncIcyVeinsTierlists({ force = false, guideIds, concurrency = 3 } = {}) {
  if (synchronization) return synchronization;
  const allowedIds = guideIds ? new Set(guideIds) : null;
  const targets = ICYVEINS_GUIDES.filter((guide) => (
    (!allowedIds || allowedIds.has(guide.id))
    && (force || !hasFreshSnapshot('icyveins', guide.id))
  ));
  if (!targets.length) return { source: 'icyveins', attempted: 0, saved: 0, errors: [] };

  synchronization = mapWithConcurrency(targets, concurrency, async (guide) => {
    return fetchIcyVeinsGuide(guide);
  }).then(async (results) => {
    const parsedGuides = results.filter((result) => result.status === 'fulfilled').map((result) => result.value);
    const localization = await localizeGuideItems(parsedGuides);
    const saved = saveGuideSnapshots('icyveins', parsedGuides);
    const errors = results.flatMap((result, index) => result.status === 'rejected'
      ? [{ guideId: targets[index].id, url: targets[index].url, error: result.reason?.message || String(result.reason) }]
      : []);
    lastSyncErrors = errors;
    return { source: 'icyveins', attempted: targets.length, saved: saved.length, snapshots: saved, errors, localizationErrors: localization.errors };
  }).finally(() => { synchronization = null; });
  return synchronization;
}

export async function getIcyVeinsTierlists({ waitForRefresh = false } = {}) {
  const missingBeforeSync = ICYVEINS_GUIDES.filter((guide) => !loadLatestGuide('icyveins', guide.id));
  if (missingBeforeSync.length) {
    await syncIcyVeinsTierlists({ guideIds: missingBeforeSync.map((guide) => guide.id) });
  } else {
    const staleGuides = ICYVEINS_GUIDES.filter((guide) => !hasFreshSnapshot('icyveins', guide.id));
    if (staleGuides.length) {
      const refresh = syncIcyVeinsTierlists({ guideIds: staleGuides.map((guide) => guide.id) });
      if (waitForRefresh) await refresh;
    }
  }

  const guides = loadLatestGuides('icyveins', ICYVEINS_GUIDES.map((guide) => guide.id));
  const missing = ICYVEINS_GUIDES.filter((guide) => !loadLatestGuide('icyveins', guide.id));
  if (missing.length) {
    const failure = lastSyncErrors.find((entry) => missing.some((guide) => guide.id === entry.guideId));
    throw new Error(failure?.error || `No hay snapshot para ${missing.map((guide) => guide.id).join(', ')}`);
  }
  return {
    source: 'Icy Veins',
    mode: synchronization ? 'sqlite-stale-refreshing' : 'sqlite-cache',
    storage: 'JSON local',
    cacheHours: SNAPSHOT_TTL_MS / 3_600_000,
    guideCount: guides.length,
    syncErrors: lastSyncErrors,
    guides,
  };
}
