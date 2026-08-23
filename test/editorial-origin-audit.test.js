import test from 'node:test';
import assert from 'node:assert/strict';
import { ICYVEINS_GUIDES, WOWHEAD_GUIDES } from '../server/guide-catalog.js';
import { loadLatestGuides } from '../server/editorial-store.js';

test('ningún item editorial publicado combina procedencias contradictorias', () => {
  const guides = [
    ...loadLatestGuides('wowhead', WOWHEAD_GUIDES.map((guide) => guide.id)),
    ...loadLatestGuides('icyveins', ICYVEINS_GUIDES.map((guide) => guide.id)),
  ];
  const conflicts = guides.flatMap((guide) => guide.tiers.flatMap((tier) => tier.items
    .filter((item) => item.contentTypes.length > 1)
    .map((item) => ({ source: guide.source, guide: guide.id, itemId: item.itemId, contentTypes: item.contentTypes }))));
  assert.deepEqual(conflicts, []);
});

