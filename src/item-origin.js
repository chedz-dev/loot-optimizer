const ORIGIN_ALIASES = new Map([
  ['raid', 'raid'],
  ['dungeon', 'dungeon'], ['mythic+', 'dungeon'], ['mythic plus', 'dungeon'], ['mythicplus', 'dungeon'], ['mythic-plus', 'dungeon'], ['m+', 'dungeon'],
  ['delves', 'delves'], ['delve', 'delves'],
  ['lair', 'lair'],
  ['world', 'world'], ['world boss', 'world'], ['worldboss', 'world'],
  ['crafting', 'crafting'],
  ['pvp', 'pvp'],
]);

function normalizeOrigin(value) {
  return typeof value === 'string' ? ORIGIN_ALIASES.get(value.trim().toLowerCase()) || null : null;
}

// Acquisition metadata wins over broad categories. Observed use and season do not
// identify where an item drops, and conflicting fallback categories remain unknown.
export function resolveItemOrigin(item) {
  const dropOrigin = normalizeOrigin(item?.drop?.sourceType);
  if (dropOrigin) return dropOrigin;
  const categories = Array.isArray(item?.originTypes) ? item.originTypes : [];
  const origins = [...new Set(categories.map(normalizeOrigin).filter(Boolean))];
  return origins.length === 1 ? origins[0] : 'unknown';
}

function locationText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function itemOriginLocation(item, { detailed = false } = {}) {
  const instance = locationText(item?.drop?.instance);
  const encounter = locationText(item?.drop?.encounter);
  if (detailed) {
    const seen = new Set();
    return [instance, encounter].filter((value) => {
      const key = value.toLowerCase().replace(/\s+/g, ' ');
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).join(' · ');
  }
  return ['raid', 'lair', 'world'].includes(resolveItemOrigin(item)) ? encounter || instance : instance;
}
