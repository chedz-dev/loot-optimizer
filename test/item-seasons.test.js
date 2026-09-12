import test from 'node:test';
import assert from 'node:assert/strict';
import seasonData from '../data/item-season-classification.json' with { type: 'json' };
import { rankingItems } from '../server/trinkets-s2.js';
import { classifyItemSeason, CURRENT_ITEM_SEASON } from '../server/item-seasons.js';
import { itemDetails } from '../server/warcraftlogs-data.js';

test('season registry is versioned, unique, and carries evidence for non-catalog classifications', () => {
  assert.equal(seasonData.schemaVersion, 1);
  assert.equal(CURRENT_ITEM_SEASON.id, 'midnight-s2');
  assert.equal(new Set(seasonData.items.map((item) => item.itemId)).size, seasonData.items.length);
  for (const item of seasonData.items) {
    assert.ok(Number.isSafeInteger(item.itemId) && item.itemId > 0);
    assert.ok(['current', 'past'].includes(item.status));
    assert.ok(item.reason);
    assert.equal(new URL(item.sourceUrl).protocol, 'https:');
    if (item.status === 'current') assert.equal(item.seasonId, CURRENT_ITEM_SEASON.id);
    else assert.notEqual(item.seasonId, CURRENT_ITEM_SEASON.id);
  }
});

test('every active raid/M+ item is current, including Lair and returning old dungeon IDs', () => {
  for (const item of rankingItems) assert.equal(classifyItemSeason(item.itemId).status, 'current', item.name);
  for (const itemId of [270167, 193757, 158374, 159617]) {
    assert.equal(classifyItemSeason(itemId).seasonId, 'midnight-s2');
  }
});

test('confirmed old raid trinkets are not classified as current because players still equip them', () => {
  assert.equal(classifyItemSeason(249343).status, 'past');
  assert.equal(classifyItemSeason('268292').seasonId, 'midnight-s1');
});

test('unknown items remain unknown regardless of numeric ID, name, ilvl or stale snapshot season', () => {
  for (const itemId of [1, 9999999, 0, -1, NaN]) assert.equal(classifyItemSeason(itemId).status, 'unknown');
  const item = itemDetails({ itemId: 9999999, name: 'Season 2 Raid Trinket', averageItemLevel: 350,
    season: { id: 'midnight-s2' }, seasonClassification: { status: 'current' } });
  assert.equal(item.seasonClassification.status, 'unknown');
});

test('renewed current-season crafts, delves and renown rewards retain current availability', () => {
  for (const itemId of [248583, 251792, 264507, 246304, 241340, 251783, 274493]) {
    assert.equal(classifyItemSeason(itemId).status, 'current', `item ${itemId}`);
    assert.equal(classifyItemSeason(itemId).basis, 'verified-source');
  }
  for (const itemId of [193701, 250256, 260235]) assert.equal(classifyItemSeason(itemId).status, 'past');
});

test('old Timewalking IDs and unverified delve items remain unknown instead of automatically previous-season', () => {
  for (const itemId of [156207, 156234, 156310, 265657, 274495]) assert.equal(classifyItemSeason(itemId).status, 'unknown');
});

test('read-time classification overrides obsolete snapshot labels without mutating snapshot data', () => {
  const old = { itemId: 193757, name: 'Ruby Whelp Shell', popularity: 23.5, count: 47,
    seasonClassification: { status: 'past', seasonId: 'dragonflight-s1' } };
  const copy = structuredClone(old);
  assert.equal(itemDetails(old).seasonClassification.status, 'current');
  assert.deepEqual(old, copy);
});
