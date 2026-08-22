export const RANKING_SOURCES = Object.freeze(['unified', 'wowhead', 'icyveins']);

export const SOURCE_TIER_ORDER = Object.freeze(['S+', 'S', 'A+', 'A', 'B', 'C', 'D', 'F', 'G']);

export function sourceRankings(rankings = [], source = 'unified') {
  if (source === 'unified') return rankings;
  if (!RANKING_SOURCES.includes(source)) return [];

  return rankings
    .filter((entry) => entry.sourceScores?.[source]?.status === 'observed')
    .map((entry) => ({
      ...entry,
      tier: String(entry.sourceTiers?.[source] || entry.sourceScores[source].rawValue || '').trim().toUpperCase(),
      selectedSource: source,
    }))
    .filter((entry) => SOURCE_TIER_ORDER.includes(entry.tier))
    .sort((left, right) => (
      SOURCE_TIER_ORDER.indexOf(left.tier) - SOURCE_TIER_ORDER.indexOf(right.tier)
      || left.className.localeCompare(right.className)
      || left.specName.localeCompare(right.specName)
    ));
}

export function visibleTiers(rankings = [], source = 'unified') {
  if (source === 'unified') return ['S', 'A', 'B', 'C'];
  const present = new Set(rankings.map((entry) => entry.tier));
  return SOURCE_TIER_ORDER.filter((tier) => present.has(tier));
}

export const tierClassName = (tier) => tier.toLowerCase().replace('+', '-plus');
