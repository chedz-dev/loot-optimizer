import test from 'node:test';
import assert from 'node:assert/strict';
import { rankItemFromSignals, RANKING_SOURCE_REGISTRY, summarizeUsageRate } from '../server/ranking-engine.js';

const classes = [{ id: 'mage', name: 'Mage', stat: 'intellect', specs: [{ id: 'arcane', name: 'Arcane', role: 'dps' }] }];
const signal = (source, textValue, overrides = {}) => ({
  source,
  snapshotKey: `${source}:snapshot`,
  itemId: 250215,
  classId: 'mage',
  specId: 'arcane',
  contentType: source === 'icyveins' ? 'all' : 'raid',
  signalType: 'editorial-tier',
  textValue,
  numericValue: null,
  sampleSize: null,
  confidence: null,
  fetchedAt: '2026-08-22T09:00:00.000Z',
  ...overrides,
});

test('pondera Wowhead e Icy Veins 50/50 usando la escala de tiers', () => {
  const result = rankItemFromSignals({ classSpecs: classes, signals: [signal('wowhead', 'S'), signal('icyveins', 'A')], content: 'raid' });
  assert.equal(result.rankings[0].score, 95);
  assert.equal(result.rankings[0].confidence, 100);
  assert.equal(result.rankings[0].sourceScores.wowhead.weight, 0.5);
  assert.equal(result.rankings[0].sourceScores.icyveins.weight, 0.5);
});

test('normaliza S+ de Wowhead como tier S y no como una fuente ausente', () => {
  const result = rankItemFromSignals({
    classSpecs: classes,
    signals: [signal('wowhead', 'S+'), signal('icyveins', 'S')],
    content: 'raid',
  });
  assert.equal(result.rankings[0].score, 100);
  assert.equal(result.rankings[0].tier, 'S');
  assert.equal(result.rankings[0].confidence, 100);
  assert.equal(result.rankings[0].sourceScores.wowhead.status, 'observed');
  assert.equal(result.rankings[0].sourceTiers.wowhead, 'S+');
  assert.equal(result.rankings[0].sourceTiers.icyveins, 'S');
});

test('normaliza la tier G publicada por Wowhead', () => {
  const result = rankItemFromSignals({ classSpecs: classes, signals: [signal('wowhead', 'G')], content: 'raid' });
  assert.equal(result.rankings[0].sourceScores.wowhead.score, 15);
  assert.equal(result.rankings[0].sourceScores.wowhead.status, 'observed');
});

test('rechaza una tier editorial desconocida en lugar de degradarla silenciosamente a NR', () => {
  assert.throws(
    () => rankItemFromSignals({ classSpecs: classes, signals: [signal('wowhead', 'Z')], content: 'raid' }),
    /Tier editorial no soportado: Z/,
  );
});

test('una fuente ausente reduce cobertura, pero no degrada una recomendación S observada', () => {
  const result = rankItemFromSignals({ classSpecs: classes, signals: [signal('wowhead', 'S')], content: 'raid' });
  assert.equal(result.rankings[0].score, 100);
  assert.equal(result.rankings[0].tier, 'S');
  assert.equal(result.rankings[0].confidence, 50);
  assert.equal(result.rankings[0].sourceScores.icyveins.status, 'unranked');
  assert.equal(result.rankings[0].sourceScores.icyveins.score, null);
  assert.equal(result.rankings[0].sourceScores.icyveins.weight, 0);
  assert.equal(result.rankings[0].sourceScores.wowhead.weight, 1);
  assert.equal(result.rankings[0].sourceScores.wowhead.configuredWeight, 0.5);
});

test('excluye una spec cuando ninguna fuente tiene evidencia observada', () => {
  const result = rankItemFromSignals({ classSpecs: classes, signals: [], content: 'raid' });
  assert.equal(result.rankings.length, 0);
  assert.equal(result.metadata.eligibleSpecs, 0);
  assert.equal(result.metadata.excludedSpecs, 1);
});

test('usa solamente el lote más reciente de una fuente', () => {
  const result = rankItemFromSignals({
    classSpecs: classes,
    content: 'raid',
    signals: [
      signal('wowhead', 'C', { snapshotKey: 'old', fetchedAt: '2026-08-21T09:00:00.000Z' }),
      signal('wowhead', 'S', { snapshotKey: 'new' }),
      signal('icyveins', 'S'),
    ],
  });
  assert.equal(result.rankings[0].score, 100);
});

test('admite una fuente numérica mediante el mismo contrato sin activarla globalmente', () => {
  const registry = {
    ...RANKING_SOURCE_REGISTRY,
    bloodmallet: { ...RANKING_SOURCE_REGISTRY.bloodmallet, enabled: true, weight: 1 },
    wowhead: { ...RANKING_SOURCE_REGISTRY.wowhead, enabled: false, weight: 0 },
    icyveins: { ...RANKING_SOURCE_REGISTRY.icyveins, enabled: false, weight: 0 },
  };
  const result = rankItemFromSignals({
    classSpecs: classes,
    registry,
    content: 'raid',
    signals: [signal('bloodmallet', '', { signalType: 'normalized-score', numericValue: 88, contentType: 'raid' })],
  });
  assert.equal(result.rankings[0].score, 88);
  assert.equal(result.rankings[0].confidence, 100);
});

test('el consenso preserva tiers bajos publicados y distingue ausencia de una evaluación negativa', () => {
  for (const tier of ['S', 'A', 'B', 'C', 'D', 'F', 'G']) {
    const result = rankItemFromSignals({ classSpecs: classes, signals: [signal('wowhead', tier), signal('icyveins', tier)] });
    assert.equal(result.rankings[0].tier, tier);
    assert.equal(result.rankings[0].diagnostics.agreement.status, 'agreement');
  }
  const result = rankItemFromSignals({ classSpecs: classes, signals: [signal('wowhead', 'S'), signal('icyveins', 'D')] });
  assert.equal(result.rankings[0].score, 72.5);
  assert.equal(result.rankings[0].confidence, 100);
  assert.equal(result.rankings[0].diagnostics.agreement.status, 'disagreement');
  assert.equal(result.rankings[0].diagnostics.agreement.sensitivity.tierStable, false);
  assert.deepEqual(result.rankings[0].diagnostics.agreement.sensitivity.scenarios.map((entry) => entry.tier), ['D', 'S']);
});

test('los duplicados no crean votos adicionales y tiers conflictivos no eligen arbitrariamente el más alto', () => {
  const result = rankItemFromSignals({ classSpecs: classes, signals: [
    signal('wowhead', 'S'), signal('wowhead', 'S', { entryKey: 'duplicate' }),
    signal('icyveins', 'A'), signal('icyveins', 'B'), signal('icyveins', 'A', { entryKey: 'duplicate' }),
  ] });
  const entry = result.rankings[0];
  assert.equal(entry.score, 100);
  assert.equal(entry.confidence, 50);
  assert.equal(entry.sourceScores.wowhead.signalCount, 1);
  assert.equal(entry.sourceScores.icyveins.status, 'ambiguous');
  assert.equal(entry.sourceScores.icyveins.rawValue, null);
  assert.deepEqual(entry.sourceScores.icyveins.rawValues, ['A', 'B']);
  assert.equal(entry.sourceTiers.icyveins, undefined);
  assert.deepEqual(result.metadata.ambiguousEvidence, [{ classId: 'mage', specId: 'arcane', source: 'icyveins', rawValues: ['A', 'B'] }]);
});

test('S+ y S equivalentes en una misma fuente no producen una falsa ambigüedad', () => {
  const result = rankItemFromSignals({ classSpecs: classes, signals: [signal('wowhead', 'S+'), signal('wowhead', 'S')] });
  assert.equal(result.rankings[0].tier, 'S');
  assert.equal(result.rankings[0].sourceScores.wowhead.status, 'observed');
});

test('una spec con solo evidencia ambigua se excluye con diagnóstico explícito', () => {
  const result = rankItemFromSignals({ classSpecs: classes, signals: [signal('icyveins', 'S'), signal('icyveins', 'A')] });
  assert.equal(result.rankings.length, 0);
  assert.equal(result.metadata.ambiguousEvidence.length, 1);
});

test('una captura reciente de M+ no borra el contexto raid de la misma fuente', () => {
  const result = rankItemFromSignals({ classSpecs: classes, content: 'raid', signals: [
    signal('wowhead', 'S', { snapshotKey: 'raid', contentType: 'raid' }),
    signal('wowhead', 'D', { snapshotKey: 'dungeon', contentType: 'dungeon', fetchedAt: '2026-08-23T09:00:00.000Z' }),
  ] });
  assert.equal(result.rankings[0].tier, 'S');
});

test('el contexto específico prevalece sobre all y no se mezclan sus votos', () => {
  const result = rankItemFromSignals({ classSpecs: classes, content: 'mythic-plus', signals: [
    signal('icyveins', 'S', { contentType: 'all' }),
    signal('icyveins', 'D', { contentType: 'dungeon' }),
  ] });
  assert.equal(result.rankings[0].tier, 'D');
});

test('fuentes adicionales sin observaciones no diluyen el score y sí reducen cobertura', () => {
  const registry = { ...RANKING_SOURCE_REGISTRY, bloodmallet: { ...RANKING_SOURCE_REGISTRY.bloodmallet, enabled: true, weight: 1 } };
  const result = rankItemFromSignals({ classSpecs: classes, registry, signals: [signal('wowhead', 'S'), signal('icyveins', 'S')] });
  assert.equal(result.rankings[0].tier, 'S');
  assert.equal(result.rankings[0].score, 100);
  assert.equal(result.rankings[0].confidence, 50);
});

test('respeta pesos explícitos y no cambia la puntuación al escalar todos los pesos', () => {
  const registry = { wowhead: { ...RANKING_SOURCE_REGISTRY.wowhead, weight: 3 }, icyveins: { ...RANKING_SOURCE_REGISTRY.icyveins, weight: 1 } };
  const signals = [signal('wowhead', 'S'), signal('icyveins', 'D')];
  const a = rankItemFromSignals({ classSpecs: classes, registry, signals });
  const b = rankItemFromSignals({ classSpecs: classes, registry: Object.fromEntries(Object.entries(registry).map(([id, source]) => [id, { ...source, weight: source.weight * 10 }])), signals });
  assert.equal(a.rankings[0].score, 86.3);
  assert.equal(a.rankings[0].score, b.rankings[0].score);
  assert.equal(a.rankings[0].sourceScores.wowhead.weight, 0.75);
});

test('las specs con la misma puntuación comparten rank aunque tengan diferente cobertura', () => {
  const twoSpecs = [{ ...classes[0], specs: [...classes[0].specs, { id: 'fire', name: 'Fire', role: 'dps' }] }];
  const result = rankItemFromSignals({ classSpecs: twoSpecs, signals: [
    signal('wowhead', 'S'), signal('wowhead', 'S', { specId: 'fire' }), signal('icyveins', 'S', { specId: 'fire' }),
  ] });
  assert.deepEqual(result.rankings.map((entry) => entry.rank), [1, 1]);
  assert.deepEqual(result.rankings.map((entry) => entry.confidence), [100, 50]);
});

const usageContext = { zoneId: 44, encounterId: 1, difficulty: 5, partition: 1 };
const usage = (count, sampleSize = 100, overrides = {}) => signal('warcraftlogs', '', {
  signalType: 'usage-rate', numericValue: count * 100 / sampleSize, sampleSize, contentType: 'raid',
  metadata: { ...usageContext, count, targetSampleSize: 100 }, ...overrides,
});

test('Wilson conserva el denominador de personajes y cuantifica la incertidumbre de muestras pequeñas', () => {
  const small = summarizeUsageRate(usage(1, 1));
  const large = summarizeUsageRate(usage(100, 100));
  assert.equal(small.usageRate, 100);
  assert.equal(small.sampleCoverage, 1);
  assert.equal(large.sampleCoverage, 100);
  assert.ok(large.interval.lower > small.interval.lower);
  assert.deepEqual(summarizeUsageRate(usage(50)).interval, { method: 'wilson', level: 0.95, lower: 40.4, upper: 59.6, scope: 'conditional-binomial-model' });
  assert.equal(summarizeUsageRate(usage(0)).interval.lower, 0);
  assert.equal(large.interval.upper, 100);
});

test('rechaza tasas de uso incoherentes y muestras inválidas', () => {
  assert.throws(() => summarizeUsageRate(usage(50, 0)), /count y sampleSize/);
  assert.throws(() => summarizeUsageRate(usage(101, 100)), /count y sampleSize/);
  assert.throws(() => summarizeUsageRate(usage(50, 100, { numericValue: 90 })), /no coincide/);
});

test('WCL queda desactivado y no confunde popularidad con recomendación aunque se solicite como evidencia', () => {
  assert.equal(RANKING_SOURCE_REGISTRY.warcraftlogs.enabled, false);
  const registry = { ...RANKING_SOURCE_REGISTRY, warcraftlogs: { ...RANKING_SOURCE_REGISTRY.warcraftlogs, enabled: true, weight: 1 } };
  const result = rankItemFromSignals({ classSpecs: classes, registry, context: usageContext,
    signals: [signal('wowhead', 'S'), signal('icyveins', 'S'), usage(1)] });
  assert.equal(result.rankings[0].tier, 'S');
  assert.equal(result.rankings[0].score, 100);
  assert.equal(result.rankings[0].confidence, 100);
  assert.equal(result.rankings[0].sourceScores.warcraftlogs.status, 'supporting');
  assert.equal(result.rankings[0].sourceScores.warcraftlogs.weight, 0);
  assert.equal(result.rankings[0].sourceScores.warcraftlogs.empiricalEvidence[0].usageRate, 1);
  assert.equal(rankItemFromSignals({ classSpecs: classes, registry, context: usageContext, signals: [usage(100)] }).rankings.length, 0);
});

test('la popularidad requiere contexto y no se mezclan bosses de capturas diferentes', () => {
  const registry = { ...RANKING_SOURCE_REGISTRY, warcraftlogs: { ...RANKING_SOURCE_REGISTRY.warcraftlogs, enabled: true, weight: 1 } };
  const signals = [signal('wowhead', 'S'), usage(25), usage(100, 100, {
    snapshotKey: 'other-boss', fetchedAt: '2026-08-23T09:00:00.000Z', metadata: { ...usageContext, encounterId: 2, count: 100, targetSampleSize: 100 },
  })];
  const missing = rankItemFromSignals({ classSpecs: classes, registry, signals });
  assert.equal(missing.rankings[0].sourceScores.warcraftlogs.status, 'context-required');
  const result = rankItemFromSignals({ classSpecs: classes, registry, signals, context: usageContext });
  assert.equal(result.rankings[0].sourceScores.warcraftlogs.empiricalEvidence[0].usageRate, 25);
});
