import test from 'node:test';
import assert from 'node:assert/strict';
import originData from '../data/item-origin-overrides.json' with { type: 'json' };
import seasonData from '../data/item-season-classification.json' with { type: 'json' };
import { itemDetails } from '../server/warcraftlogs-data.js';
import { rankingItems } from '../server/trinkets-s2.js';

test('verified origin registry has unique IDs, one origin and evidence for every override', () => {
  assert.equal(originData.schemaVersion, 1);
  assert.equal(new Set(originData.items.map((item) => item.itemId)).size, originData.items.length);
  const sourceTypes = { raid: 'Raid', dungeon: 'Mythic+', delves: 'Delves', world: 'World', crafting: 'Crafting', pvp: 'PvP' };
  for (const item of originData.items) {
    assert.ok(Number.isSafeInteger(item.itemId) && item.itemId > 0);
    assert.equal(item.originTypes.length, 1);
    assert.equal(item.drop.sourceType, sourceTypes[item.originTypes[0]]);
    assert.equal(new URL(item.sourceUrl).protocol, 'https:');
    assert.ok(item.reason);
  }
});

test('WCL metadata covers active items, including non-raid sources, without another API call', () => {
  const ids = [...rankingItems.map((item) => item.itemId), ...seasonData.items.filter((item) => item.status === 'current').map((item) => item.itemId)];
  for (const itemId of ids) {
    const item = itemDetails({ itemId });
    assert.equal(item.originTypes.length, 1, `origin for ${itemId}`);
    assert.ok(item.drop?.sourceType, `drop for ${itemId}`);
  }
  for (const [itemId, type] of [[270175, 'Raid'], [250215, 'Mythic+'], [274493, 'Delves'],
    [270167, 'Lair'], [264507, 'World'], [250462, 'World'], [241340, 'Crafting'], [270602, 'PvP'], [270603, 'PvP']]) {
    assert.equal(itemDetails({ itemId }).drop.sourceType, type);
  }
});

test('verified acquisition overrides obsolete Delves labels and preserves stored snapshots', () => {
  for (const [itemId, type] of [[264507, 'world'], [270602, 'pvp'], [270603, 'pvp'], [249343, 'raid']]) {
    const snapshotItem = { itemId, originTypes: ['delves', 'raid'], drop: { sourceType: 'Delves', instance: 'Wrong' } };
    const before = structuredClone(snapshotItem);
    const item = itemDetails(snapshotItem);
    assert.deepEqual(item.originTypes, [type]);
    assert.notEqual(item.drop.instance, 'Wrong');
    assert.deepEqual(snapshotItem, before);
  }
});

test('Lair retains exact source and unknown origins are not inferred from usage or season', () => {
  const item = itemDetails({ itemId: 270167 });
  assert.equal(item.drop.sourceType, 'Lair');
  assert.equal(item.drop.encounter, 'Nymrissa Wavecaller');
  assert.equal(item.drop.instance, 'The Tidebound Grotto');
  const unknown = itemDetails({ itemId: 99999999, name: 'Season 2 Raid Relic', contentTypes: ['raid'], context: { contentType: 'raid' } });
  assert.deepEqual(unknown.originTypes, []);
  assert.equal(unknown.drop, null);
});
