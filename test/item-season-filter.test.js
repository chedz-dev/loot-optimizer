import test from 'node:test';
import assert from 'node:assert/strict';
import { filterItemsBySeason, itemSeasonStatus, normalizeItemSeasonFilter, selectVisibleSeasonItem } from '../src/item-season-filter.js';

const items = [
  { itemId: 1, count: 50, popularity: 62.5, seasonClassification: { status: 'current', seasonId: 'midnight-s2' } },
  { itemId: 2, count: 20, popularity: 25, seasonClassification: { status: 'past', seasonId: 'midnight-s1' } },
  { itemId: 3, count: 10, popularity: 12.5, seasonClassification: { status: 'unknown' } },
  { itemId: 4, count: 4, popularity: 5 },
];

test('season filter defaults to current and rejects invalid persisted preferences', () => {
  for (const invalid of [null, undefined, {}, 1, 'S2', 'obsolete']) {
    assert.equal(normalizeItemSeasonFilter(invalid), 'current');
    assert.deepEqual(filterItemsBySeason(items, invalid).map((item) => item.itemId), [1]);
  }
  for (const valid of ['current', 'past', 'unknown', 'all']) assert.equal(normalizeItemSeasonFilter(valid), valid);
});

test('current, past, unknown, and all remain distinct without guessing from item IDs or item level', () => {
  assert.deepEqual(filterItemsBySeason(items, 'past').map((item) => item.itemId), [2]);
  assert.deepEqual(filterItemsBySeason(items, 'unknown').map((item) => item.itemId), [3, 4]);
  assert.deepEqual(filterItemsBySeason(items, 'all'), items);
  assert.equal(itemSeasonStatus({ itemId: 123, itemLevel: 999, seasonClassification: { status: 'bad' } }), 'unknown');
  assert.equal(itemSeasonStatus(null), 'unknown');
});

test('filtering does not mutate observations or renormalize counts and popularity', () => {
  const before = structuredClone(items);
  const snapshot = { validCharacters: 80, items };
  const visible = filterItemsBySeason(snapshot.items, 'current');
  assert.equal(visible[0], items[0]);
  assert.equal(visible[0].count, 50);
  assert.equal(visible[0].popularity, 62.5);
  assert.equal(snapshot.validCharacters, 80);
  assert.deepEqual(items, before);
});

test('a hidden previous-season selection falls back to a visible item without modifying saved preference', () => {
  const savedPreference = 2;
  const currentItems = filterItemsBySeason(items, 'current');
  assert.equal(selectVisibleSeasonItem(currentItems, savedPreference).itemId, 1);
  assert.equal(savedPreference, 2);
  assert.equal(selectVisibleSeasonItem(filterItemsBySeason(items, 'all'), savedPreference).itemId, 2);
  assert.equal(selectVisibleSeasonItem(items, '2').itemId, 2);
});

test('an empty filtered catalog clears the effective item instead of requesting hidden item comparisons', () => {
  assert.equal(selectVisibleSeasonItem(filterItemsBySeason(items.slice(1), 'current'), 2), null);
  assert.deepEqual(filterItemsBySeason(undefined, 'current'), []);
  assert.equal(selectVisibleSeasonItem([], 2), null);
});
