const clamp = (value, minimum = 0, maximum = 100) => Math.max(minimum, Math.min(maximum, value));
const round = (value) => Math.round(value * 10) / 10;
const EPSILON = 1e-9;

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
    kind: 'editorial-guide', signalWeights: { 'editorial-tier': 1 }, unrankedScore: null,
  },
  icyveins: {
    id: 'icyveins', name: 'Icy Veins', enabled: true, weight: 0.5,
    kind: 'editorial-guide', signalWeights: { 'editorial-tier': 1 }, unrankedScore: null,
  },
  warcraftlogs: {
    id: 'warcraftlogs', name: 'Warcraft Logs', enabled: false, weight: 0,
    kind: 'empirical', signalWeights: { 'usage-rate': 1 }, unrankedScore: null,
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
const timestamp = (signal) => Number.isFinite(Date.parse(signal.fetchedAt)) ? Date.parse(signal.fetchedAt) : 0;
const scoreToTier = (score) => score >= 95 ? 'S' : score >= 85 ? 'A' : score >= 70 ? 'B'
  : score >= 55 ? 'C' : score >= 40 ? 'D' : score >= 25 ? 'F' : 'G';
const recommendationSource = (source) => Object.entries(source.signalWeights)
  .some(([type, weight]) => weight > 0 && Object.hasOwn(signalNormalizers, type));

// This interval describes a conditional binomial model. The selected top 100
// are not a random sample of WoW players, so it is not population-level evidence.
export function summarizeUsageRate(signal) {
  const sampleSize = signal.sampleSize;
  const count = signal.metadata?.count;
  if (!Number.isInteger(sampleSize) || sampleSize <= 0 || !Number.isInteger(count) || count < 0 || count > sampleSize) {
    throw new Error('La señal de uso necesita count y sampleSize enteros válidos');
  }
  const rate = count / sampleSize;
  if (!Number.isFinite(signal.numericValue) || Math.abs(signal.numericValue - rate * 100) > 0.051) {
    throw new Error('La tasa de uso no coincide con count / sampleSize');
  }
  const z = 1.959963984540054;
  const denominator = 1 + z ** 2 / sampleSize;
  const center = (rate + z ** 2 / (2 * sampleSize)) / denominator;
  const margin = z * Math.sqrt(rate * (1 - rate) / sampleSize + z ** 2 / (4 * sampleSize ** 2)) / denominator;
  const target = signal.metadata?.targetSampleSize;
  return {
    count,
    sampleSize,
    usageRate: round(rate * 100),
    sampleCoverage: Number.isInteger(target) && target > 0 ? round(clamp(sampleSize / target * 100)) : null,
    interval: { method: 'wilson', level: 0.95, lower: round(clamp((center - margin) * 100)), upper: round(clamp((center + margin) * 100)), scope: 'conditional-binomial-model' },
    context: signal.metadata || {},
    interpretation: 'Uso observado en el top seleccionado; no estima poder, BiS ni popularidad de toda la población.',
  };
}

function latestBatch(signals) {
  if (!signals.length) return [];
  const latest = signals.reduce((winner, signal) => (
    !winner || timestamp(signal) > timestamp(winner)
      || (timestamp(signal) === timestamp(winner) && String(signal.snapshotKey) > String(winner.snapshotKey)) ? signal : winner
  ), null);
  return signals.filter((signal) => signal.snapshotKey === latest.snapshotKey);
}

function scoreSource(source, signals, requestedContent, context) {
  const sourceSignals = signals.filter((signal) => signal.source === source.id);
  const empty = { source: source.id, name: source.name, status: 'unranked', score: null,
    rawValue: null, rawValues: [], signalType: null, sampleSize: null, confidence: null };
  const usageSignals = sourceSignals.filter((signal) => signal.signalType === 'usage-rate');
  const contextKeys = ['zoneId', 'encounterId', 'difficulty', 'partition'];
  if (usageSignals.length && contextKeys.some((key) => context?.[key] == null)) {
    return { ...empty, status: 'context-required', signalType: 'usage-rate' };
  }
  const matchingSignals = sourceSignals.filter((signal) => (
    signal.signalType !== 'usage-rate' || contextKeys.every((key) => String(signal.metadata?.[key]) === String(context[key]))
  ));
  // Select the requested content before its newest snapshot. An independently
  // fetched dungeon snapshot must not invalidate a still-current raid snapshot.
  const exactSignals = matchingSignals.filter((signal) => normalizeContentType(signal.contentType) === requestedContent);
  const generalSignals = matchingSignals.filter((signal) => signal.contentType === 'all');
  const relevantSignals = latestBatch(exactSignals.length ? exactSignals : generalSignals);
  const usage = relevantSignals.filter((signal) => signal.signalType === 'usage-rate' && source.signalWeights['usage-rate'] > 0);
  const empiricalEvidence = usage.map(summarizeUsageRate);
  const unique = new Map();
  relevantSignals.forEach((signal) => {
    const typeWeight = source.signalWeights[signal.signalType];
    const normalizer = signalNormalizers[signal.signalType];
    if (!Number.isFinite(typeWeight) || typeWeight <= 0 || !normalizer) return;
    const value = normalizer(signal);
    if (!Number.isFinite(value)) return;
    const key = `${signal.signalType}:${signal.signalType === 'editorial-tier' ? String(signal.textValue).trim().toUpperCase() : value}`;
    if (!unique.has(key)) unique.set(key, { signal, value, weight: typeWeight });
  });
  const scoredSignals = [...unique.values()];
  const editorialSignals = scoredSignals.filter((entry) => entry.signal.signalType === 'editorial-tier');
  const editorialValues = [...new Set(editorialSignals.map((entry) => entry.value))];

  // Different contextual variants of a guide are not independent votes. Until
  // an adapter identifies their conditions, do not silently choose the best one.
  if (editorialValues.length > 1) {
    return { ...empty, status: 'ambiguous', signalType: 'editorial-tier',
      rawValues: editorialSignals.map((entry) => entry.signal.textValue),
      scoreRange: { minimum: Math.min(...editorialValues), maximum: Math.max(...editorialValues) },
      evidence: editorialSignals.map(({ signal }) => ({ value: signal.textValue, note: signal.metadata?.guideNote || '', entryKey: signal.entryKey || null })),
      empiricalEvidence };
  }

  if (!scoredSignals.length) {
    return { ...empty, ...(empiricalEvidence.length ? { status: 'supporting', signalType: 'usage-rate', empiricalEvidence } : {}) };
  }

  // A provider gets its configured weight once, regardless of the number of
  // repeated HTML rows or signal values its adapter emitted.
  const typeCounts = new Map();
  scoredSignals.forEach(({ signal }) => typeCounts.set(signal.signalType, (typeCounts.get(signal.signalType) || 0) + 1));
  scoredSignals.forEach((entry) => { entry.weight /= typeCounts.get(entry.signal.signalType); });
  const totalSignalWeight = scoredSignals.reduce((sum, entry) => sum + entry.weight, 0);
  const score = scoredSignals.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / totalSignalWeight;
  const strongest = scoredSignals.reduce((winner, entry) => entry.value > winner.value ? entry : winner, scoredSignals[0]);
  return {
    source: source.id,
    name: source.name,
    status: 'observed',
    score,
    rawValue: strongest.signal.textValue || strongest.signal.numericValue,
    rawValues: scoredSignals.map(({ signal }) => signal.textValue || signal.numericValue),
    signalType: strongest.signal.signalType,
    sampleSize: strongest.signal.sampleSize,
    confidence: strongest.signal.confidence,
    scoreRange: { minimum: Math.min(...scoredSignals.map((entry) => entry.value)), maximum: Math.max(...scoredSignals.map((entry) => entry.value)) },
    signalCount: scoredSignals.length,
    empiricalEvidence,
  };
}

function agreementFor(sources, score) {
  if (!sources.length) return null;
  const minimum = Math.min(...sources.map((source) => source.score));
  const maximum = Math.max(...sources.map((source) => source.score));
  const deviation = Math.sqrt(sources.reduce((sum, source) => sum + source.weight * (source.score - score) ** 2, 0));
  const leaveOneOut = sources.length > 1 ? sources.map((omitted) => {
    const remaining = sources.filter((source) => source !== omitted);
    const weight = remaining.reduce((sum, source) => sum + source.weight, 0);
    const alternate = remaining.reduce((sum, source) => sum + source.score * source.weight, 0) / weight;
    return { omittedSource: omitted.source, score: round(alternate), tier: scoreToTier(alternate) };
  }) : [];
  return { status: sources.length === 1 ? 'single-source' : maximum - minimum <= EPSILON ? 'agreement' : 'disagreement',
    sourceCount: sources.length, minimumScore: round(minimum), maximumScore: round(maximum),
    standardDeviation: round(deviation),
    sensitivity: { method: 'leave-one-source-out', tierStable: sources.length > 1 ? leaveOneOut.every((entry) => entry.tier === scoreToTier(score)) : null, scenarios: leaveOneOut } };
}

export function rankItemFromSignals({ classSpecs, signals = [], content = 'raid', registry = RANKING_SOURCE_REGISTRY, context = null }) {
  const requestedContent = normalizeContentType(content);
  const activeSources = Object.values(registry).filter((source) => source.enabled && Number.isFinite(source.weight) && source.weight > 0);
  const totalWeight = activeSources.filter(recommendationSource).reduce((sum, source) => sum + source.weight, 0);
  if (!activeSources.length) throw new Error('El motor no tiene fuentes activas');

  const evaluatedSpecs = classSpecs.flatMap((wowClass) => wowClass.specs.map((spec) => {
    const specSignals = signals.filter((signal) => signal.classId === wowClass.id && signal.specId === spec.id);
    const scoredSources = activeSources.map((source) => ({ source, scored: scoreSource(source, specSignals, requestedContent, context) }));
    const observedWeight = scoredSources.filter(({ scored }) => scored.status === 'observed' && Number.isFinite(scored.score))
      .reduce((sum, { source }) => sum + source.weight, 0);
    const sourceScores = Object.fromEntries(scoredSources.map(({ source, scored }) => {
      const normalizedWeight = Number.isFinite(scored.score) && observedWeight > 0 ? source.weight / observedWeight : 0;
      return [source.id, {
        ...scored,
        weight: normalizedWeight,
        configuredWeight: recommendationSource(source) && totalWeight > 0 ? source.weight / totalWeight : 0,
        contribution: Number.isFinite(scored.score) ? round(scored.score * normalizedWeight) : null,
      }];
    }));
    const contributions = Object.values(sourceScores).filter((source) => Number.isFinite(source.score));
    const score = contributions.reduce((sum, source) => sum + source.score * source.weight, 0);
    const sourceTiers = Object.fromEntries(contributions
      .filter((source) => source.status === 'observed' && source.signalType === 'editorial-tier')
      .map((source) => [source.source, source.rawValue]));
    const roundedScore = round(score);
    return {
      classId: wowClass.id,
      className: wowClass.name,
      specId: spec.id,
      specName: spec.name,
      role: spec.role,
      stat: spec.stat || wowClass.stat,
      score: roundedScore,
      // Kept for the UI contract; this is source coverage, not a probability.
      confidence: totalWeight > 0 ? Math.round(observedWeight / totalWeight * 100) : 0,
      evidenceCoverage: totalWeight > 0 ? round(observedWeight / totalWeight * 100) : 0,
      sourceScores,
      sourceTiers,
      tier: contributions.length ? scoreToTier(score) : null,
      diagnostics: { agreement: agreementFor(contributions, score), ambiguousSources: Object.values(sourceScores).filter((entry) => entry.status === 'ambiguous').map((entry) => entry.source) },
    };
  }));
  const rankings = evaluatedSpecs
    .filter((entry) => entry.tier !== null)
    .sort((left, right) => right.score - left.score || right.evidenceCoverage - left.evidenceCoverage
      || left.className.localeCompare(right.className) || left.specName.localeCompare(right.specName));
  rankings.forEach((entry, index) => {
    const previous = rankings[index - 1];
    entry.rank = previous && previous.score === entry.score ? previous.rank : index + 1;
  });

  return {
    rankings,
    metadata: {
      mode: 'normalized-source-engine',
      algorithmVersion: 2,
      aggregation: 'observed-source-weighted-mean',
      contentType: requestedContent,
      tierScale: TIER_SCORES,
      missingPolicy: 'Una fuente ausente no aporta puntuación. Los pesos se renormalizan entre las fuentes con evidencia inequívoca.',
      eligibilityPolicy: 'Una spec necesita al menos una señal de recomendación inequívoca para aparecer en el ranking. La popularidad no sustituye esa evidencia.',
      confidenceMeaning: 'Cobertura de fuentes de recomendación activas, no probabilidad de que el ranking sea correcto.',
      ambiguityPolicy: 'Tiers distintos para el mismo item, fuente y contexto se conservan como ambiguos y no aportan una puntuación hasta resolver la variante.',
      empiricalPolicy: 'usage-rate es evidencia de popularidad separada; requiere zona, encuentro, dificultad y partición explícitos, y no contribuye al tier.',
      scoreMeaning: 'Índice editorial con escala y pesos de producto; no DPS, probabilidad de BiS ni porcentaje de mejora.',
      evaluatedSpecs: evaluatedSpecs.length,
      eligibleSpecs: rankings.length,
      excludedSpecs: evaluatedSpecs.length - rankings.length,
      ambiguousEvidence: evaluatedSpecs.flatMap((entry) => entry.diagnostics.ambiguousSources.map((source) => ({ classId: entry.classId, specId: entry.specId, source, rawValues: entry.sourceScores[source].rawValues }))),
      sources: activeSources.map((source) => ({
        id: source.id,
        name: source.name,
        kind: source.kind,
        weight: recommendationSource(source) && totalWeight > 0 ? source.weight / totalWeight : 0,
        signalTypes: Object.keys(source.signalWeights),
      })),
      plannedSources: Object.values(registry).filter((source) => !source.enabled).map(({ id, name, kind }) => ({ id, name, kind })),
    },
  };
}
