import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWowheadGuideHtml } from '../server/wowhead-tierlists.js';

const guide = {
  id: 'hunter-beast-mastery',
  classId: 'hunter',
  className: 'Hunter',
  specId: 'beast-mastery',
  specName: 'Beast Mastery',
  url: 'https://www.wowhead.com/guide/classes/hunter/beast-mastery/bis-gear',
};

const fixture = String.raw`<title>Beast Mastery Hunter Gear and Best in Slot - Midnight - Wowhead</title>
Patch 12.1.0 Updated: 2026/08/21
"270173":{"name_enus":"Zul'jin's Guillotine Technique","quality":4,"icon":"inv_axe_1h_amaniberserker_d_01","screenshot":{},"jsonequip":{}}
[h3]Trinket Tier List[\/h3]\r\n
[tier-list=rows grid]\r\n
[tier]\r\n
[tier-label bg=q5]S[\/tier-label]\r\n
[tier-content]\r\n
[icon-badge=270173 quality=4 display-options=raid tooltip=axe]\r\n
[\/tier-content]\r\n
[\/tier]\r\n
[\/tier-list]
[tooltip name=axe]Strong in [color=green]single-target[\/color].[\/tooltip]`;

test('parsea tier, item, categoría y nota editorial desde el markup de Wowhead', () => {
  const result = parseWowheadGuideHtml(fixture, guide);
  assert.equal(result.pageTitle, 'Beast Mastery Hunter Gear and Best in Slot - Midnight - Wowhead');
  assert.equal(result.patch, '12.1.0');
  assert.equal(result.pageUpdatedAt, '2026/08/21');
  assert.equal(result.itemCount, 1);
  assert.deepEqual(result.tiers[0].items[0], {
    itemId: 270173,
    name: "Zul'jin's Guillotine Technique",
    icon: 'inv_axe_1h_amaniberserker_d_01',
    tier: 'S',
    displayOrder: 1,
    quality: 4,
    contentTypes: ['raid'],
    guideNote: 'Strong in single-target.',
    noteKey: 'axe',
    wowheadUrl: 'https://www.wowhead.com/item=270173',
  });
});

test('rechaza una URL asignada a la spec equivocada', () => {
  assert.throws(() => parseWowheadGuideHtml(fixture, { ...guide, specName: 'Marksmanship' }), /no coincide/);
});
