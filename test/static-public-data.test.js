import test from 'node:test';
import assert from 'node:assert/strict';
import { getItemRankings, rankingItems } from '../server/rankings-data.js';
import { getRankingSignalsForItem } from '../server/editorial-store.js';
import { publicRankings } from '../scripts/static-projections.js';
import { RANKING_SOURCES, sourceRankings } from '../src/ranking-source-view.js';

const originalRanking = (item) => getItemRankings(
  item.id,
  item.category === 'mythic-plus' ? 'mythic-plus' : 'raid',
  getRankingSignalsForItem(item.itemId),
);

const rankingIdentity = (entries) => entries.map(({ classId, specId, tier }) => ({ classId, specId, tier }));

const assertAllowedKeys = (value, allowed, location) => {
  for (const key of Object.keys(value)) assert.ok(allowed.includes(key), `${location} exposes ${key}`);
};

test('public rankings preserve every real item/spec/tier and their order in all source modes', () => {
  assert.ok(rankingItems.length > 0);
  for (const item of rankingItems) {
    const original = originalRanking(item);
    const beforeProjection = structuredClone(original);
    const projected = publicRankings(original);
    assert.deepEqual(projected.item, original.item, item.id);
    assert.equal(projected.content, original.content, item.id);
    for (const mode of RANKING_SOURCES) {
      assert.deepEqual(
        rankingIdentity(sourceRankings(projected.rankings, mode)),
        rankingIdentity(sourceRankings(original.rankings, mode)),
        `${item.id}: ${mode}`,
      );
    }
    assert.deepEqual(original, beforeProjection, `projection mutated ${item.id}`);
  }
});

test('public rankings allow only presentation fields, excluding internal metrics and source configuration', () => {
  for (const item of rankingItems) {
    const projected = publicRankings(originalRanking(item));
    assertAllowedKeys(projected, ['item', 'content', 'rankings', 'metadata'], item.id);
    assertAllowedKeys(projected.metadata, ['sources', 'ambiguousEvidence'], `${item.id}.metadata`);
    for (const source of projected.metadata.sources) {
      assertAllowedKeys(source, ['id', 'name'], `${item.id}.metadata.sources`);
    }
    for (const entry of projected.rankings) {
      const location = `${item.id}.${entry.classId}.${entry.specId}`;
      assertAllowedKeys(entry, ['classId', 'className', 'specId', 'specName', 'role', 'stat', 'tier', 'sourceTiers', 'sourceScores'], location);
      for (const source of Object.values(entry.sourceScores)) {
        assertAllowedKeys(source, ['source', 'name', 'status', 'rawValue', 'rawValues'], `${location}.sourceScores`);
      }
    }
  }
});

test('public ranking projection does not publish newly added diagnostic fields', () => {
  const original = originalRanking(rankingItems[0]);
  const privateField = 'futureAdminDiagnostic';
  original[privateField] = 'private';
  original.metadata[privateField] = 'private';
  for (const source of original.metadata.sources) source[privateField] = 'private';
  for (const entry of original.rankings) {
    entry[privateField] = 'private';
    for (const source of Object.values(entry.sourceScores)) source[privateField] = 'private';
  }
  const beforeProjection = structuredClone(original);
  assert.ok(!JSON.stringify(publicRankings(original)).includes(privateField));
  assert.deepEqual(original, beforeProjection);
});

test('public rankings retain source ambiguity warnings without changing their meaning', () => {
  for (const item of rankingItems) {
    const original = originalRanking(item);
    const projected = publicRankings(original);
    assert.deepEqual(projected.metadata.ambiguousEvidence, original.metadata.ambiguousEvidence, item.id);
    assert.deepEqual(projected.metadata.sources, original.metadata.sources.map(({ id, name }) => ({ id, name })), item.id);
    original.rankings.forEach((entry, index) => {
      const publicEntry = projected.rankings[index];
      assert.deepEqual(publicEntry.sourceTiers, entry.sourceTiers, item.id);
      for (const [sourceId, source] of Object.entries(entry.sourceScores)) {
        const publicSource = publicEntry.sourceScores[sourceId];
        assert.equal(publicSource.status, source.status, `${item.id}:${sourceId}`);
        assert.equal(publicSource.rawValue, source.rawValue, `${item.id}:${sourceId}`);
        assert.deepEqual(publicSource.rawValues, source.rawValues, `${item.id}:${sourceId}`);
      }
    });
  }
});
