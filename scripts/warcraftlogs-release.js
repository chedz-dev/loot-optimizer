import assert from 'node:assert/strict';
import release from '../data/warcraftlogs-release.json' with { type: 'json' };
import { allSpecs } from '../server/spec-catalog.js';
import { wclContextKey } from '../src/warcraftlogs-static.js';

export const releaseContexts = release.encounterIds.flatMap(encounterId => release.difficulties.map(difficulty => ({
  zoneId: release.zoneId, encounterId, difficulty, partition: release.partition,
})));

// La presencia en el catálogo del proveedor no basta para publicar un boss nuevo.
export function selectReleaseSnapshots(snapshots) {
  const allowed = new Set(releaseContexts.map(wclContextKey));
  const order = new Map(releaseContexts.map((context, index) => [wclContextKey(context), index]));
  return snapshots.filter(snapshot => !release.excludedEncounterIds.includes(snapshot.context.encounterId)
    && (allowed.has(wclContextKey(snapshot.context)) || (snapshot.context.zoneId === 55
      && snapshot.context.difficulty === 10 && snapshot.context.partition === 1)))
    .sort((a, b) => (order.get(wclContextKey(a.context)) ?? releaseContexts.length)
      - (order.get(wclContextKey(b.context)) ?? releaseContexts.length));
}

export function validateReleaseCoverage(data) {
  assert.equal(data.currentItemSeason.id, release.seasonId);
  const keys = new Set(data.snapshots.map(snapshot => `${wclContextKey(snapshot.context)}:${snapshot.spec.classId}:${snapshot.spec.specId}`));

  for (const context of releaseContexts) {
    for (const spec of allSpecs) {
      assert.ok(keys.has(`${wclContextKey(context)}:${spec.classId}:${spec.specId}`),
        `Falta una captura WCL: ${wclContextKey(context)} ${spec.classId}/${spec.specId}`);
    }
  }

  assert.equal(selectReleaseSnapshots(data.snapshots).length, data.snapshots.length, 'El baked contiene encuentros fuera del alcance aprobado');
}
