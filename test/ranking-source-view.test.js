import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceRankings, visibleTiers } from '../src/ranking-source-view.js';

const rankings = [
  {
    className: 'Mage', specName: 'Arcane', tier: 'A', score: 95,
    sourceTiers: { wowhead: 'S+', icyveins: 'A' },
    sourceScores: {
      wowhead: { status: 'observed', rawValue: 'S+' },
      icyveins: { status: 'observed', rawValue: 'A' },
    },
  },
  {
    className: 'Druid', specName: 'Balance', tier: 'C', score: 60,
    sourceTiers: { icyveins: 'C' },
    sourceScores: {
      wowhead: { status: 'unranked', rawValue: null },
      icyveins: { status: 'observed', rawValue: 'C' },
    },
  },
];

test('una vista editorial conserva el tier original y excluye specs sin evidencia de esa fuente', () => {
  const wowhead = sourceRankings(rankings, 'wowhead');
  assert.equal(wowhead.length, 1);
  assert.equal(wowhead[0].specName, 'Arcane');
  assert.equal(wowhead[0].tier, 'S+');
});

test('la vista unificada conserva el resultado ponderado', () => {
  assert.strictEqual(sourceRankings(rankings, 'unified'), rankings);
});

test('la tier list editorial muestra solamente los tiers originales presentes', () => {
  const icyveins = sourceRankings(rankings, 'icyveins');
  assert.deepEqual(visibleTiers(icyveins, 'icyveins'), ['A', 'C']);
});
