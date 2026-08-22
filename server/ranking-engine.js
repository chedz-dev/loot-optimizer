const clamp = (value, minimum = 0, maximum = 100) => Math.max(minimum, Math.min(maximum, value));

export const TIER_SCORES = Object.freeze({
  'S+': 100,
  S: 100,
  'A+': 95,
  A: 90,
  B: 75,
  C: 60,
  D: 45,
  F: 30,
  G: 15,
});

export const RANKING_SOURCE_REGISTRY = Object.freeze({
  wowhead: {
    id: 'wowhead', name: 'Wowhead', enabled: true, weight: 0.5,
    kind: 'editorial-guide', signalWeights: { 'editorial-tier': 1 }, unrankedScore: 35,
  },
  icyveins: {
    id: 'icyveins', name: 'Icy Veins', enabled: true, weight: 0.5,
    kind: 'editorial-guide', signalWeights: { 'editorial-tier': 1 }, unrankedScore: 35,
  },
  warcraftlogs: {
    id: 'warcraftlogs', name: 'Warcraft Logs', enabled: false, weight: 0,
    kind: 'empirical', signalWeights: { 'normalized-score': 1 }, unrankedScore: null,
  },
  bloodmallet: {
    id: 'bloodmallet', name: 'Bloodmallet', enabled: false, weight: 0,
    kind: 'simulation', signalWeights: { 'normalized-score': 1 }, unrankedScore: null,
  },
  maxroll: {
    id: 'maxroll', name: 'Maxroll', enabled: false, weight: 0,
    kind: 'editorial-guide', signalWeights: { 'editorial-tier': 1 }, unrankedScore: null,
  },
  methodgg: {
    id: 'methodgg', name: 'Method.gg', enabled: false, weight: 0,
    kind: 'editorial-guide', signalWeights: { 'editorial-tier': 1 }, unrankedScore: null,
  },
  'liquid-armory': {
    id: 'liquid-armory', name: 'Liquid Armory', enabled: false, weight: 0,
    kind: 'editorial-guide', signalWeights: { 'editorial-tier': 1 }, unrankedScore: null,
  },
});

const signalNormalizers = {
  'editorial-tier': (signal) => {
    const tier = String(signal.textValue || '').trim().toUpperCase();
    if (!Object.hasOwn(TIER_SCORES, tier)) {
      throw new Error(`Tier editorial no soportado: ${tier || '(vacío)'}`);
    }
    return TIER_SCORES[tier];
  },
  'normalized-score': (signal) => Number.isFinite(signal.numericValue) ? clamp(signal.numericValue) : null,
  percentile: (signal) => Number.isFinite(signal.numericValue) ? clamp(signal.numericValue) : null,
};

const normalizeContentType = (content) => content === 'mythic-plus' ? 'dungeon' : content;

function latestBatch(signals) {
  if (!signals.length) return [];
  const latest = signals.reduce((winner, signal) => (
    !winner || Date.parse(signal.fetchedAt) > Date.parse(winner.fetchedAt) ? signal : winner
  ), null);
  return signals.filter((signal) => signal.snapshotKey === latest.snapshotKey);
}

function scoreSource(source, signals, requestedContent) {
  const sourceSignals = latestBatch(signals.filter((signal) => signal.source === source.id));
  const exactSignals = sourceSignals.filter((signal) => signal.contentType === requestedContent);
  const generalSignals = sourceSignals.filter((signal) => signal.contentType === 'all');
  const relevantSignals = exactSignals.length ? exactSignals : generalSignals;
  const scoredSignals = relevantSignals.flatMap((signal) => {
    const typeWeight = source.signalWeights[signal.signalType];
    const normalizer = signalNormalizers[signal.signalType];
    const value = normalizer?.(signal);
    return typeWeight && Number.isFinite(value) ? [{ signal, value, weight: typeWeight }] : [];
  });

  if (!scoredSignals.length) {
    return {
      source: source.id,
      name: source.name,
      status: 'unranked',
      score: source.unrankedScore,
      rawValue: null,
      signalType: null,
      sampleSize: null,
      confidence: null,
    };
  }

  const totalSignalWeight = scoredSignals.reduce((sum, entry) => sum + entry.weight, 0);
  const score = scoredSignals.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / totalSignalWeight;
  const strongest = scoredSignals.reduce((winner, entry) => entry.value > winner.value ? entry : winner, scoredSignals[0]);
  return {
    source: source.id,
    name: source.name,
    status: 'observed',
    score: Math.round(score * 10) / 10,
    rawValue: strongest.signal.textValue || strongest.signal.numericValue,
    signalType: strongest.signal.signalType,
    sampleSize: strongest.signal.sampleSize,
    confidence: strongest.signal.confidence,
  };
}

export function rankItemFromSignals({ classSpecs, signals = [], content = 'raid', registry = RANKING_SOURCE_REGISTRY }) {
  const requestedContent = normalizeContentType(content);
  const activeSources = Object.values(registry).filter((source) => source.enabled && source.weight > 0);
  const totalWeight = activeSources.reduce((sum, source) => sum + source.weight, 0);
  if (!activeSources.length || totalWeight <= 0) throw new Error('El motor no tiene fuentes activas');

  const evaluatedSpecs = classSpecs.flatMap((wowClass) => wowClass.specs.map((spec) => {
    const specSignals = signals.filter((signal) => signal.classId === wowClass.id && signal.specId === spec.id);
    const sourceScores = Object.fromEntries(activeSources.map((source) => {
      const scored = scoreSource(source, specSignals, requestedContent);
      const normalizedWeight = source.weight / totalWeight;
      return [source.id, {
        ...scored,
        weight: normalizedWeight,
        contribution: Number.isFinite(scored.score) ? Math.round(scored.score * normalizedWeight * 10) / 10 : null,
      }];
    }));
    const contributions = Object.values(sourceScores).filter((source) => Number.isFinite(source.score));
    const score = contributions.reduce((sum, source) => sum + source.score * source.weight, 0);
    const observedWeight = contributions.filter((source) => source.status === 'observed').reduce((sum, source) => sum + source.weight, 0);
    const sourceTiers = Object.fromEntries(contributions
      .filter((source) => source.status === 'observed' && source.signalType === 'editorial-tier')
      .map((source) => [source.source, source.rawValue]));
    const roundedScore = Math.round(score);
    return {
      classId: wowClass.id,
      className: wowClass.name,
      specId: spec.id,
      specName: spec.name,
      role: spec.role,
      stat: spec.stat || wowClass.stat,
      score: roundedScore,
      confidence: Math.round(observedWeight * 100),
      sourceScores,
      sourceTiers,
      tier: roundedScore >= 95 ? 'S' : roundedScore >= 85 ? 'A' : roundedScore >= 70 ? 'B' : 'C',
    };
  }));
  const rankings = evaluatedSpecs
    .filter((entry) => entry.confidence > 0)
    .sort((left, right) => right.score - left.score || right.confidence - left.confidence || left.className.localeCompare(right.className));
  rankings.forEach((entry, index) => {
    const previous = rankings[index - 1];
    entry.rank = previous && previous.score === entry.score && previous.confidence === entry.confidence ? previous.rank : index + 1;
  });

  return {
    rankings,
    metadata: {
      mode: 'normalized-source-engine',
      contentType: requestedContent,
      tierScale: TIER_SCORES,
      missingPolicy: 'Un item ausente en una tierlist activa recibe 35/100 y se marca como unranked.',
      eligibilityPolicy: 'Una spec necesita al menos una señal observada para aparecer en el ranking.',
      evaluatedSpecs: evaluatedSpecs.length,
      eligibleSpecs: rankings.length,
      excludedSpecs: evaluatedSpecs.length - rankings.length,
      sources: activeSources.map((source) => ({
        id: source.id,
        name: source.name,
        kind: source.kind,
        weight: source.weight / totalWeight,
        signalTypes: Object.keys(source.signalWeights),
      })),
      plannedSources: Object.values(registry).filter((source) => !source.enabled).map(({ id, name, kind }) => ({ id, name, kind })),
    },
  };
}
