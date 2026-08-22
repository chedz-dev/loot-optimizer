import test from 'node:test';
import assert from 'node:assert/strict';
import { rankItemFromSignals, RANKING_SOURCE_REGISTRY } from '../server/ranking-engine.js';

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

test('marca como NR una fuente que no rankea el item y reduce cobertura', () => {
  const result = rankItemFromSignals({ classSpecs: classes, signals: [signal('wowhead', 'S')], content: 'raid' });
  assert.equal(result.rankings[0].score, 68);
  assert.equal(result.rankings[0].confidence, 50);
  assert.equal(result.rankings[0].sourceScores.icyveins.status, 'unranked');
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
    warcraftlogs: { ...RANKING_SOURCE_REGISTRY.warcraftlogs, enabled: true, weight: 1 },
    wowhead: { ...RANKING_SOURCE_REGISTRY.wowhead, enabled: false, weight: 0 },
    icyveins: { ...RANKING_SOURCE_REGISTRY.icyveins, enabled: false, weight: 0 },
  };
  const result = rankItemFromSignals({
    classSpecs: classes,
    registry,
    content: 'raid',
    signals: [signal('warcraftlogs', '', { signalType: 'normalized-score', numericValue: 88, contentType: 'raid' })],
  });
  assert.equal(result.rankings[0].score, 88);
  assert.equal(result.rankings[0].confidence, 100);
});
