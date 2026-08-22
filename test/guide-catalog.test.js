import test from 'node:test';
import assert from 'node:assert/strict';
import { allSpecs } from '../server/spec-catalog.js';
import { ICYVEINS_GUIDES, WOWHEAD_GUIDES } from '../server/guide-catalog.js';
import { mapWithConcurrency } from '../server/sync-guides.js';

test('el catálogo editorial cubre las 40 specs sin identificadores duplicados', () => {
  assert.equal(allSpecs.length, 40);
  assert.equal(new Set(allSpecs.map((entry) => entry.id)).size, 40);
  assert.equal(WOWHEAD_GUIDES.length, 40);
  assert.equal(ICYVEINS_GUIDES.length, 40);
  assert.equal(new Set(WOWHEAD_GUIDES.map((entry) => entry.url)).size, 40);
  assert.equal(new Set(ICYVEINS_GUIDES.map((entry) => entry.url)).size, 40);
});

test('Icy Veins usa el slug de rol correcto para tank, healer y support', () => {
  assert.match(ICYVEINS_GUIDES.find((entry) => entry.id === 'death-knight-blood').url, /pve-tank/);
  assert.match(ICYVEINS_GUIDES.find((entry) => entry.id === 'priest-holy').url, /pve-healing/);
  assert.match(ICYVEINS_GUIDES.find((entry) => entry.id === 'evoker-augmentation').url, /pve-dps/);
});

test('la cola de sincronización respeta el límite de concurrencia', async () => {
  let active = 0;
  let maximum = 0;
  const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (value) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return value * 2;
  });
  assert.equal(maximum, 2);
  assert.deepEqual(results.map((entry) => entry.value), [2, 4, 6, 8, 10, 12]);
});

