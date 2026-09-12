import test from 'node:test';
import assert from 'node:assert/strict';
import { itemOriginLocation, resolveItemOrigin } from '../src/item-origin.js';

test('recognized acquisition source takes priority over conflicting broad origin types', () => {
  assert.equal(resolveItemOrigin({ drop: { sourceType: 'Raid' }, originTypes: ['delves', 'raid'] }), 'raid');
  assert.equal(resolveItemOrigin({ drop: { sourceType: ' Lair ' }, originTypes: ['raid'] }), 'lair');
  assert.equal(resolveItemOrigin({ drop: { sourceType: 'Mythic+' }, originTypes: ['raid'] }), 'dungeon');
});

test('supported origins normalize to one category', () => {
  for (const [sourceType, expected] of [['RAID', 'raid'], ['dungeon', 'dungeon'], ['Mythic Plus', 'dungeon'], ['Delves', 'delves'], ['Lair', 'lair'], ['World', 'world'], ['Crafting', 'crafting'], ['PvP', 'pvp']]) {
    assert.equal(resolveItemOrigin({ drop: { sourceType } }), expected);
  }
});

test('fallback accepts only one distinct valid origin and does not infer origin from sample or season', () => {
  assert.equal(resolveItemOrigin({ originTypes: ['raid'] }), 'raid');
  assert.equal(resolveItemOrigin({ drop: { sourceType: 'unknown' }, originTypes: ['Mythic+', 'dungeon'] }), 'dungeon');
  assert.equal(resolveItemOrigin({ originTypes: ['unknown', 'raid', 'invalid'] }), 'raid');
  assert.equal(resolveItemOrigin({ originTypes: ['raid', 'delves'] }), 'unknown');
  assert.equal(resolveItemOrigin({ source: 'raid', context: { mode: 'raid' }, seasonClassification: { status: 'current' } }), 'unknown');
  for (const item of [null, undefined, {}, { originTypes: null }, { originTypes: 'raid' }, { drop: { sourceType: 123 }, originTypes: [null, {}] }]) assert.equal(resolveItemOrigin(item), 'unknown');
});

test('compact dungeon location uses the dungeon, not its boss', () => {
  assert.equal(itemOriginLocation({ drop: { sourceType: 'Mythic+', instance: 'Altar of Fangs', encounter: 'Boss' } }), 'Altar of Fangs');
  assert.equal(itemOriginLocation({ drop: { sourceType: 'Dungeon', encounter: 'Boss' } }), '');
});

test('compact raid, lair and world locations prefer boss and fall back to instance', () => {
  for (const sourceType of ['Raid', 'Lair', 'World']) {
    assert.equal(itemOriginLocation({ drop: { sourceType, instance: 'Instance', encounter: 'Nymrissa' } }), 'Nymrissa');
    assert.equal(itemOriginLocation({ drop: { sourceType, instance: 'Instance', encounter: ' ' } }), 'Instance');
  }
  assert.equal(itemOriginLocation({ originTypes: ['raid'], drop: { instance: 'Raid', encounter: 'Boss' } }), 'Boss');
});

test('other origins use instance, and details retain both known locations without duplicates', () => {
  assert.equal(itemOriginLocation({ drop: { sourceType: 'Crafting', instance: 'Alchemy', encounter: 'Not an instance' } }), 'Alchemy');
  assert.equal(itemOriginLocation({ drop: { sourceType: 'Lair', instance: 'Lair', encounter: 'Nymrissa' } }, { detailed: true }), 'Lair · Nymrissa');
  assert.equal(itemOriginLocation({ drop: { instance: ' The Lair ', encounter: 'the   lair' } }, { detailed: true }), 'The Lair');
  assert.equal(itemOriginLocation({ drop: { instance: '', encounter: 'Boss' } }, { detailed: true }), 'Boss');
  assert.equal(itemOriginLocation({ drop: { instance: 1, encounter: {} } }, { detailed: true }), '');
  assert.equal(itemOriginLocation(null), '');
  assert.equal(itemOriginLocation(null, { detailed: true }), '');
});
