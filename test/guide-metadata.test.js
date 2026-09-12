import test from 'node:test';
import assert from 'node:assert/strict';
import { formatGuideUpdatedDate, guideAuthorName } from '../src/guide-metadata.js';
import { publicGuide } from '../scripts/static-projections.js';

test('publisher dates normalize Wowhead slash dates and Icy Veins ISO dates to the printed day', () => {
  for (const input of ['2026/08/21', '2026-08-21', '2026-08-21T00:00:00Z', '2026-08-21T23:30:00-06:00']) {
    assert.deepEqual(formatGuideUpdatedDate(input, 'en'), { iso: '2026-08-21', label: 'Aug 21, 2026' });
  }
  assert.match(formatGuideUpdatedDate('2026/08/21', 'es').label, /21.*ago.*2026/);
});

test('invalid or missing publisher dates return an explicit missing value', () => {
  for (const input of [null, undefined, '', 'unknown', '2026/2/3', '2026-02-30', '2026-13-01', '2026-08-21T99:00:00Z', 1787270400000]) {
    assert.equal(formatGuideUpdatedDate(input), null, String(input));
  }
  assert.equal(formatGuideUpdatedDate('2024-02-29').iso, '2024-02-29');
  assert.equal(formatGuideUpdatedDate('2025-02-29'), null);
});

test('missing author values never invent an attribution', () => {
  assert.equal(guideAuthorName('  Wordup  '), 'Wordup');
  for (const input of ['', '  ', null, undefined, {}]) assert.equal(guideAuthorName(input), '');
});

test('baked guides keep publisher attribution while removing snapshot diagnostics', () => {
  for (const source of ['wowhead', 'icyveins']) {
    const input = {
      source, id: 'mage-arcane', author: 'Guide Writer', pageUpdatedAt: '2026/08/21',
      url: 'https://example.com/guide', pageTitle: 'Arcane Mage', tiers: [],
      snapshotId: 17, cacheExpiresAt: '2026-09-08T00:00:00Z', contentHash: 'abc',
      fetchedAt: '2026-09-07T23:00:00Z', itemCount: 3, tierCount: 2,
    };
    assert.deepEqual(publicGuide(input), {
      source, id: 'mage-arcane', author: 'Guide Writer', pageUpdatedAt: '2026/08/21',
      url: 'https://example.com/guide', pageTitle: 'Arcane Mage', tiers: [],
    });
    assert.equal(input.snapshotId, 17);
  }
});

test('baked projection does not substitute capture time for a missing publisher date', () => {
  const projected = publicGuide({ author: '', pageUpdatedAt: '', fetchedAt: '2026-09-07T23:00:00Z' });
  assert.deepEqual(projected, { author: '', pageUpdatedAt: '' });
  assert.equal(formatGuideUpdatedDate(projected.pageUpdatedAt), null);
});
