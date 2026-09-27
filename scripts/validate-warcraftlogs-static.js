import assert from 'node:assert/strict';
import { publicWclDataset, wclContextKey } from '../src/warcraftlogs-static.js';

function checkScalars(value) {
  for (const field of Object.values(value)) {
    assert.ok(field === null || typeof field === 'string' || (typeof field === 'number' && Number.isFinite(field)), 'Campo público no escalar');
  }
}

// Rechaza campos nuevos no autorizados y muestras incoherentes antes de publicar.
export function validateWarcraftLogsStatic(data) {
  assert.equal(data.schemaVersion, 1);
  assert.ok(Number.isInteger(data.totalSpecs) && data.totalSpecs > 0);
  assert.ok(Array.isArray(data.snapshots));
  assert.ok(data.snapshots.length > 0, 'El baked WCL está vacío');
  assert.deepEqual(data, publicWclDataset(data), 'El baked WCL contiene campos privados o no reconocidos');
  checkScalars(data.currentItemSeason);
  const identities = new Set();

  for (const snapshot of data.snapshots) {
    checkScalars(snapshot.context);
    checkScalars(snapshot.spec);
    assert.equal(snapshot.context.region, 'world');
    for (const key of ['zoneId', 'encounterId', 'difficulty', 'partition']) {
      assert.ok(Number.isInteger(snapshot.context[key]) && snapshot.context[key] >= 0);
    }
    for (const key of ['classId', 'className', 'specId', 'specName', 'role']) {
      assert.equal(typeof snapshot.spec[key], 'string');
    }
    const identity = `${wclContextKey(snapshot.context)}:${snapshot.spec.classId}:${snapshot.spec.specId}`;
    assert.ok(!identities.has(identity), `Muestra duplicada: ${identity}`);
    identities.add(identity);
    assert.ok(Number.isFinite(Date.parse(snapshot.capturedAt)) && Date.parse(snapshot.capturedAt) <= Date.now());
    assert.equal(snapshot.targetSampleSize, 100);
    assert.ok(['ready', 'incomplete', 'empty'].includes(snapshot.status));
    assert.ok(['dps', 'hps', 'playerscore'].includes(snapshot.metric));
    assert.ok(Number.isInteger(snapshot.validCharacters) && snapshot.validCharacters >= 0 && snapshot.validCharacters <= 100);
    assert.ok(Number.isInteger(snapshot.rankingRows) && snapshot.rankingRows >= snapshot.validCharacters && snapshot.rankingRows <= 100);
    const ids = new Set();

    for (const item of snapshot.items) {
      const { localizedNames, originTypes, drop, season, seasonClassification, ...fields } = item;
      [fields, localizedNames, drop || {}, season || {}, seasonClassification].forEach(checkScalars);
      assert.ok(Number.isSafeInteger(item.itemId) && item.itemId > 0 && !ids.has(item.itemId));
      ids.add(item.itemId);
      assert.ok(Number.isInteger(item.count) && item.count > 0 && item.count <= snapshot.validCharacters);
      assert.ok(Math.abs(item.popularity - item.count / snapshot.validCharacters * 100) <= 0.011);
      assert.ok(['current', 'past', 'unknown'].includes(item.seasonClassification.status));
    }

    assert.equal(snapshot.items.reduce((total, item) => total + item.count, 0), snapshot.validCharacters * 2);
  }

  assert.ok(new Set(data.snapshots.map(snapshot => `${snapshot.spec.classId}:${snapshot.spec.specId}`)).size <= data.totalSpecs);

  return data;
}
