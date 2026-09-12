// Public provenance belongs in the baked edition too. Keep the publisher's
// author and update date while removing only local capture/cache diagnostics.
export function publicGuide(guide) {
  const {
    snapshotId,
    cacheExpiresAt,
    contentHash,
    fetchedAt,
    itemCount,
    tierCount,
    ...content
  } = guide;
  return content;
}

const pick = (value, keys) => Object.fromEntries(keys
  .filter((key) => Object.hasOwn(value, key))
  .map((key) => [key, value[key]]));

// The public client needs the final tiers and source tiers, never engine scores,
// weights, diagnostics, API configuration or locally captured usage metrics.
export function publicRankings(result) {
  return {
    item: result.item,
    content: result.content,
    rankings: result.rankings.map((entry) => ({
      ...pick(entry, ['classId', 'className', 'specId', 'specName', 'role', 'stat', 'tier', 'sourceTiers']),
      sourceScores: Object.fromEntries(Object.entries(entry.sourceScores || {}).map(([id, source]) => [
        id, pick(source, ['source', 'name', 'status', 'rawValue', 'rawValues']),
      ])),
    })),
    metadata: {
      sources: (result.metadata.sources || []).map((source) => pick(source, ['id', 'name'])),
      // Keep ambiguity warnings: they explain missing recommendations to readers.
      ambiguousEvidence: (result.metadata.ambiguousEvidence || []).map((entry) =>
        pick(entry, ['classId', 'specId', 'source', 'rawValues'])),
    },
  };
}
