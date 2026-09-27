import test from 'node:test';
import assert from 'node:assert/strict';
import { allSpecs } from '../server/spec-catalog.js';
import { releaseContexts, selectReleaseSnapshots, validateReleaseCoverage } from '../scripts/warcraftlogs-release.js';

const data = () => ({
  currentItemSeason: { id: 'midnight-s2' },
  snapshots: releaseContexts.flatMap(context => allSpecs.map(spec => ({ context, spec }))),
});

test('release covers nine encounters and both raid difficulties, excluding Kithix', () => {
  assert.equal(releaseContexts.length, 18);
  assert.equal(new Set(releaseContexts.map(context => context.encounterId)).size, 9);
  assert.deepEqual([...new Set(releaseContexts.map(context => context.difficulty))], [4, 5]);
  assert.ok(releaseContexts.some(context => context.encounterId === 3379));
  assert.ok(!releaseContexts.some(context => context.encounterId === 3513));
  validateReleaseCoverage(data());
});

test('export excludes future encounters and unsupported difficulties or partitions', () => {
  const valid = data();
  const extra = [
    { zoneId: 53, encounterId: 3513, difficulty: 4, partition: 1 },
    { zoneId: 53, encounterId: 3470, difficulty: 3, partition: 1 },
    { zoneId: 53, encounterId: 3470, difficulty: 5, partition: 2 },
  ].map(context => ({ context, spec: allSpecs[0] }));
  assert.deepEqual(selectReleaseSnapshots([...valid.snapshots, ...extra]), valid.snapshots);
  assert.throws(() => validateReleaseCoverage({ ...valid, snapshots: [...valid.snapshots, ...extra] }));
});

test('release rejects missing specs without dropping existing S2 Mythic+ snapshots', () => {
  const valid = data();
  assert.throws(() => validateReleaseCoverage({ ...valid, snapshots: valid.snapshots.slice(1) }), /Falta una captura/);
  const mythicPlus = { context: { zoneId: 55, encounterId: 12993, difficulty: 10, partition: 1 }, spec: allSpecs[0] };
  valid.snapshots.push(mythicPlus);
  assert.equal(selectReleaseSnapshots(valid.snapshots).length, 721);
  validateReleaseCoverage(valid);
});
