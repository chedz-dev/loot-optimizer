import { getCanonicalItem } from './editorial-store.js';
import { canonicalItemDropDetails, canonicalItemOrigins, canonicalItemSeasons } from './item-origins.js';
import { classifyItemSeason } from './item-seasons.js';
export const WCL_TTL_MS = 60 * 60 * 1000;
export const WCL_SAMPLE_SIZE = 100;
const SCHEMA_VERSION = 1;
const round = (value) => Math.round(value * 100) / 100;

export const metricForSpec = (spec, contentType) => contentType === 'mythic-plus' ? 'playerscore' : spec.role === 'healer' ? 'hps' : 'dps';

function characterKey(row) {
  if (row.characterID) return `id:${row.characterID}`;
  if (!row.name || !row.server?.region || !(row.server.id || row.server.name)) return null;
  return JSON.stringify([row.server.region, row.server.id || row.server.name, row.name].map((part) => String(part).toLowerCase()));
}

export function extractTrinkets(row) {
  // Verified against live retail raid and M+ characterRankings on 2026-09-07.
  // WCL returns 18 ordered gear slots, including empty-slot placeholders. Never
  // treat a compact/unknown gear array as this schema or guess by item name.
  if (!Array.isArray(row.gear) || row.gear.length !== 18) return null;
  const trinkets = row.gear.slice(12, 14);
  if (trinkets.some((item) => !item || !Number.isInteger(Number(item.id)) || Number(item.id) <= 0)) return null;
  if (Number(trinkets[0].id) === Number(trinkets[1].id)) return null;
  return trinkets;
}

export function itemDetails(item) {
  const itemId = Number(item.itemId || item.id);
  const canonical = getCanonicalItem(itemId);
  return {
    itemId, name: canonical?.name || item.name || `Item ${itemId}`,
    localizedNames: canonical?.localizedNames || item.localizedNames || { en: item.name || `Item ${itemId}` },
    icon: String(canonical?.icon || item.icon || '').replace(/\.(jpg|png)$/i, ''),
    wowheadUrl: `https://www.wowhead.com/item=${itemId}`,
    drop: canonicalItemDropDetails.get(itemId) || item.drop || null,
    originTypes: canonicalItemOrigins.get(itemId) || item.originTypes || [],
    season: canonicalItemSeasons.get(itemId) || item.season || null,
    seasonClassification: classifyItemSeason(itemId),
  };
}

export function aggregateTrinketPopularity(rows, { spec, context, fetchedAt = new Date().toISOString(), enrichItem = itemDetails } = {}) {
  const counts = new Map();
  const seen = new Set();
  let duplicateCharacters = 0;
  let missingGear = 0;
  let invalidIdentity = 0;
  let sampledCharacters = 0;
  let validCharacters = 0;
  const cohort = [];
  // Keep the actual first 100 ranking positions. Missing gear/duplicates do not
  // get replaced with lower-ranked characters to inflate the denominator.
  for (const [index, row] of rows.slice(0, WCL_SAMPLE_SIZE).entries()) {
    const identity = characterKey(row);
    if (!identity) { invalidIdentity += 1; continue; }
    if (seen.has(identity)) { duplicateCharacters += 1; continue; }
    seen.add(identity);
    sampledCharacters += 1;
    const gear = extractTrinkets(row);
    cohort.push({ rank: index + 1, character: { name: row.name, server: row.server }, report: row.report || null,
      trinkets: gear?.map((item) => ({ itemId: Number(item.id), itemLevel: Number(item.itemLevel) || null })) || null });
    if (!gear) { missingGear += 1; continue; }
    validCharacters += 1;
    for (const item of gear) {
      const itemId = Number(item.id);
      const entry = counts.get(itemId) || { ...enrichItem(item), itemId, count: 0, levels: [] };
      entry.count += 1;
      const level = Number(item.itemLevel);
      if (Number.isFinite(level) && level > 0) entry.levels.push(level);
      counts.set(itemId, entry);
    }
  }
  const items = [...counts.values()].map(({ levels, ...item }) => ({
    ...item, popularity: round(item.count * 100 / validCharacters),
    averageItemLevel: levels.length ? round(levels.reduce((sum, level) => sum + level, 0) / levels.length) : null,
  })).sort((a, b) => b.count - a.count || a.itemId - b.itemId);
  const metric = metricForSpec(spec, context.contentType);
  const params = new URLSearchParams({ boss: context.encounterId, difficulty: context.difficulty, partition: context.partition,
    class: spec.wclClassSlug || spec.className.replaceAll(' ', ''), spec: spec.wclSpecSlug || spec.specName.replaceAll(' ', ''), metric });
  return {
    schemaVersion: SCHEMA_VERSION, source: 'warcraftlogs', context, spec, metric,
    targetSampleSize: WCL_SAMPLE_SIZE, rankingRows: Math.min(rows.length, WCL_SAMPLE_SIZE), sampledCharacters, validCharacters,
    missingGear, invalidIdentity, duplicateCharacters, items, cohort,
    fetchedAt, expiresAt: new Date(Date.parse(fetchedAt) + WCL_TTL_MS).toISOString(), stale: false,
    status: rows.length === 0 ? 'empty' : validCharacters < WCL_SAMPLE_SIZE ? 'incomplete' : 'ready',
    sourceUrl: `https://www.warcraftlogs.com/zone/rankings/${context.zoneId}?${params}`,
  };
}

export function popularitySignals(snapshot) {
  // Usage is a separate empirical signal, not an editorial tier or simulated DPS.
  const snapshotKey = `warcraftlogs:${snapshot.context.zoneId}:${snapshot.context.encounterId}:${snapshot.context.difficulty}:${snapshot.context.partition}:${snapshot.spec.classId}:${snapshot.spec.specId}:${snapshot.fetchedAt}`;
  return snapshot.items.map((item) => ({
    source: 'warcraftlogs', snapshotKey, itemId: item.itemId, classId: snapshot.spec.classId, specId: snapshot.spec.specId,
    contentType: snapshot.context.contentType === 'mythic-plus' ? 'dungeon' : 'raid', signalType: 'usage-rate',
    numericValue: item.popularity, textValue: null, sampleSize: snapshot.validCharacters,
    confidence: snapshot.validCharacters / WCL_SAMPLE_SIZE, fetchedAt: snapshot.fetchedAt,
    metadata: { ...snapshot.context, metric: snapshot.metric, count: item.count,
      targetSampleSize: WCL_SAMPLE_SIZE, sampledCharacters: snapshot.sampledCharacters, sourceUrl: snapshot.sourceUrl },
  }));
}
