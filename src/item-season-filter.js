export const ITEM_SEASON_FILTERS = Object.freeze(['current', 'past', 'all', 'unknown']);

export function normalizeItemSeasonFilter(value) {
  return ITEM_SEASON_FILTERS.includes(value) ? value : 'current';
}

export function itemSeasonStatus(item) {
  const status = item?.seasonClassification?.status;
  return ['current', 'past'].includes(status) ? status : 'unknown';
}

// Presentation only: retain observed counts and the original sample denominator.
export function filterItemsBySeason(items = [], filter = 'current') {
  const normalized = normalizeItemSeasonFilter(filter);
  return items.filter((item) => normalized === 'all' || itemSeasonStatus(item) === normalized);
}

// Resolve against the filtered catalog without overwriting the saved preference.
export function selectVisibleSeasonItem(items = [], preferredItemId) {
  return items.find((item) => preferredItemId != null && String(item.itemId) === String(preferredItemId)) || items[0] || null;
}
