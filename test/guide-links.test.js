import test from 'node:test';
import assert from 'node:assert/strict';
import { specGuideUrls } from '../src/guide-links.js';

test('construye las guías de Wowhead e Icy Veins para una spec DPS', () => {
  assert.deepEqual(specGuideUrls({ classId: 'death-knight', specId: 'unholy', role: 'dps' }), {
    wowhead: 'https://www.wowhead.com/guide/classes/death-knight/unholy/bis-gear',
    icyveins: 'https://www.icy-veins.com/wow/unholy-death-knight-pve-dps-gear-best-in-slot',
  });
});

test('usa los slugs de rol de Icy Veins para healer, tank y support', () => {
  assert.match(specGuideUrls({ classId: 'druid', specId: 'restoration', role: 'healer' }).icyveins, /pve-healing-gear-best-in-slot$/);
  assert.match(specGuideUrls({ classId: 'paladin', specId: 'protection', role: 'tank' }).icyveins, /pve-tank-gear-best-in-slot$/);
  assert.match(specGuideUrls({ classId: 'evoker', specId: 'augmentation', role: 'support' }).icyveins, /pve-dps-gear-best-in-slot$/);
});
