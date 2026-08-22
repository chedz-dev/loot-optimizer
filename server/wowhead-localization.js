import { mapWithConcurrency } from './sync-guides.js';

const WOWHEAD_TOOLTIP_BASE = 'https://nether.wowhead.com/tooltip/item';

export async function fetchWowheadSpanishName(itemId) {
  const response = await fetch(`${WOWHEAD_TOOLTIP_BASE}/${itemId}?dataEnv=1&locale=6`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'LootOptimizer/0.1 (cached Wowhead localization reader)',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Wowhead ES respondió HTTP ${response.status} para item ${itemId}`);
  const payload = await response.json();
  if (!payload.name) throw new Error(`Wowhead ES no devolvió nombre para item ${itemId}`);
  return payload.name;
}

export async function localizeGuideItems(guides, { concurrency = 6 } = {}) {
  const itemNames = new Map();
  guides.forEach((guide) => guide.tiers.forEach((tier) => tier.items.forEach((item) => {
    if (!itemNames.has(item.itemId)) itemNames.set(item.itemId, item.name);
  })));

  const itemIds = [...itemNames.keys()];
  const results = await mapWithConcurrency(itemIds, concurrency, async (itemId) => ({
    itemId,
    es: await fetchWowheadSpanishName(itemId),
  }));
  const localized = new Map(results.flatMap((result) => result.status === 'fulfilled'
    ? [[result.value.itemId, result.value.es]]
    : []));

  guides.forEach((guide) => guide.tiers.forEach((tier) => tier.items.forEach((item) => {
    item.localizedNames = {
      en: item.localizedNames?.en || item.name,
      ...(localized.has(item.itemId) ? { es: localized.get(item.itemId) } : {}),
    };
  })));

  return {
    guides,
    resolved: localized.size,
    errors: results.flatMap((result, index) => result.status === 'rejected'
      ? [{ itemId: itemIds[index], error: result.reason?.message || String(result.reason) }]
      : []),
  };
}
