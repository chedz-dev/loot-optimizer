import test from 'node:test';
import assert from 'node:assert/strict';
import { getItemRankings, getSpecRankings, rankingItems } from '../server/rankings-data.js';

test('rankings devuelve items ordenados por score', () => {
  const result = getSpecRankings('priest', 'shadow', 'raid');
  assert.equal(result.spec.name, 'Shadow');
  assert.ok(result.rankings.length > 0);
  assert.ok(result.rankings.every((item, index, list) => index === 0 || list[index - 1].score >= item.score));
});

test('rankings rechaza combinaciones inexistentes', () => {
  assert.throws(() => getSpecRankings('priest', 'fury', 'raid'), /no válida/);
});

test('ranking por item omite specs cuando no recibe evidencia de ninguna fuente', () => {
  const result = getItemRankings('gebbo', 'raid');
  assert.equal(result.item.id, 'gebbo');
  assert.equal(result.rankings.length, 0);
  assert.equal(result.metadata.excludedSpecs, 40);
});

test('todos los trinkets tienen icono, Wowhead ID y procedencia', () => {
  assert.equal(rankingItems.length, 41);
  assert.equal(rankingItems.filter((item) => item.category === 'raid').length, 14);
  assert.equal(rankingItems.filter((item) => item.category === 'mythic-plus').length, 27);
  assert.ok(rankingItems.every((item) => item.itemId && item.icon && item.drop?.encounter && item.drop?.instance && item.drop?.sourceType));
});

test('el catálogo de rankings no contiene trinkets de Season 1', () => {
  const seasonOneIds = new Set([264507, 249346, 249809]);
  assert.ok(rankingItems.every((item) => !seasonOneIds.has(item.itemId)));
});
