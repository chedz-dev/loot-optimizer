import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { publicWclDataset, selectStaticWclContext, staticWclCatalog, staticWclResponse } from '../src/warcraftlogs-static.js';
import { validateWarcraftLogsStatic } from '../scripts/validate-warcraftlogs-static.js';

const data = JSON.parse(fs.readFileSync(new URL('../public/data/warcraftlogs.json', import.meta.url), 'utf8'));
const query = (route, input = {}) => new URL(`/api/warcraftlogs/${route}?${new URLSearchParams(input)}`, 'http://localhost');

test('static context selectors keep encounter and difficulty without inventing missing combinations', () => {
  const contexts = [
    { zoneId: 53, encounterId: 3470, difficulty: 4, partition: 1 },
    { zoneId: 53, encounterId: 3470, difficulty: 5, partition: 1 },
    { zoneId: 53, encounterId: 3379, difficulty: 4, partition: 1 },
    { zoneId: 53, encounterId: 3379, difficulty: 5, partition: 1 },
    { zoneId: 55, encounterId: 12993, difficulty: 10, partition: 1 },
  ];
  assert.deepEqual(selectStaticWclContext(contexts, { ...contexts[0], difficulty: '5' }), contexts[1]);
  assert.deepEqual(selectStaticWclContext(contexts, { ...contexts[1], encounterId: '3379' }), contexts[3]);
  assert.deepEqual(selectStaticWclContext(contexts, { ...contexts[3], zoneId: '55' }), contexts[4]);
  assert.deepEqual(selectStaticWclContext(contexts, { ...contexts[0], difficulty: 3 }), contexts[0]);
  assert.equal(selectStaticWclContext([], {}), null);
});

test('WCL baked validates without private cache and preserves capture dates', () => {
  validateWarcraftLogsStatic(data);
  assert.deepEqual(publicWclDataset(data), data);
  const catalog = staticWclCatalog(data);
  const dates = data.snapshots.map(snapshot => snapshot.capturedAt).sort();
  assert.equal(catalog.oldestCaptureAt, dates[0]);
  assert.equal(catalog.newestCaptureAt, dates.at(-1));
  assert.equal(catalog.contexts.length, new Set(data.snapshots.map(snapshot => JSON.stringify(snapshot.context))).size);
});

test('WCL projection excludes private fields at every nested level without mutating input', () => {
  const input = structuredClone(data);
  input.credentials = 'private';
  input.currentItemSeason.futureDiagnostic = 'private';
  const snapshot = input.snapshots[0];
  snapshot.cohort = [{ name: 'PrivatePlayer' }];
  snapshot.rawRankings = [{ report: 'private' }];
  snapshot.context.futureDiagnostic = 'private';
  snapshot.spec.futureDiagnostic = 'private';
  for (const object of [snapshot.items[0], snapshot.items[0].localizedNames, snapshot.items[0].seasonClassification]) {
    object.futureDiagnostic = 'private';
  }
  const before = structuredClone(input);
  assert.deepEqual(publicWclDataset(input), data);
  assert.deepEqual(input, before);
  assert.throws(() => validateWarcraftLogsStatic(input));
  const nested = structuredClone(data);
  nested.snapshots[0].items[0].name = { player: 'private' };
  assert.throws(() => validateWarcraftLogsStatic(nested), /escalar/);
});

test('WCL baked matches every saved spec, counts, ordering and context-specific source link', () => {
  for (const snapshot of data.snapshots) {
    const result = staticWclResponse(data, query('popularity', { ...snapshot.context, ...snapshot.spec }));
    assert.equal(result.status, 200);
    assert.deepEqual(result.payload, snapshot);
    const url = new URL(result.payload.sourceUrl);
    assert.equal(url.hostname, 'www.warcraftlogs.com');
    assert.equal(url.searchParams.get('boss'), String(snapshot.context.encounterId));
    assert.equal(url.searchParams.get('difficulty'), String(snapshot.context.difficulty));
    assert.equal(url.searchParams.get('metric'), snapshot.metric);
  }
});

test('WCL items sum observed counts and preserve the denominator across season filters', () => {
  const snapshots = structuredClone(data.snapshots.slice(0, 2));
  snapshots[1].context = structuredClone(snapshots[0].context);
  snapshots[1].spec = { ...snapshots[0].spec, specId: 'other-spec' };
  const small = { ...data, snapshots };
  const input = snapshots[0].context;
  const { payload } = staticWclResponse(small, query('items', input));
  const denominator = snapshots.reduce((sum, entry) => sum + entry.validCharacters, 0);
  assert.equal(payload.totalSpecs, data.totalSpecs);
  assert.equal(payload.snapshots, 2);
  for (const [index, item] of payload.items.entries()) {
    const count = snapshots.reduce((sum, entry) => sum + (entry.items.find(value => value.itemId === item.itemId)?.count || 0), 0);
    assert.equal(item.count, count);
    assert.equal(item.validCharacters, denominator);
    assert.equal(item.popularity, count / denominator * 100);
    if (index > 0) {
      assert.ok(payload.items[index - 1].count >= count);
    }
    const { payload: comparison } = staticWclResponse(small, query('item', { ...input, itemId: item.itemId }));
    assert.equal(comparison.rankings.length, snapshots.filter(value => value.validCharacters > 0).length);
    assert.equal(comparison.coverage.totalSpecs, data.totalSpecs);
    for (const entry of comparison.rankings) {
      const original = snapshots.find(value => value.spec.specId === entry.specId);
      assert.equal(entry.popularity, original.items.find(value => value.itemId === item.itemId)?.popularity || 0);
      assert.equal(entry.validCharacters, original.validCharacters);
    }
  }
});

test('WCL does not invent zero measurements for missing specs or contexts', () => {
  const input = { ...data.snapshots[0].context, ...data.snapshots[0].spec };
  for (const [route, overrides] of [['popularity', { specId: 'missing' }], ['items', { encounterId: 0 }], ['item', { itemId: 1 }]]) {
    assert.equal(staticWclResponse(data, query(route, { ...input, ...overrides })).status, 404);
  }
  assert.equal(staticWclResponse(data, query('sync', input)).status, 404);
});

test('WCL validation rejects duplicate, empty and inconsistent measurements', () => {
  assert.throws(() => validateWarcraftLogsStatic({ ...data, snapshots: [] }));
  assert.throws(() => validateWarcraftLogsStatic({ ...data, snapshots: [data.snapshots[0], data.snapshots[0]] }));
  const invalid = structuredClone(data);
  invalid.snapshots[0].items[0].popularity = -1;
  assert.throws(() => validateWarcraftLogsStatic(invalid));
});

test('static client caches one public JSON, never calls WCL admin routes and respects aborted readers', async t => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  t.after(() => { globalThis.fetch = originalFetch; globalThis.window = originalWindow; });
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(url);
    return new Response(JSON.stringify(data));
  };
  globalThis.window = { location: { origin: 'http://localhost' } };
  const source = fs.readFileSync(new URL('../src/data-client.js', import.meta.url), 'utf8')
    .replace("'./warcraftlogs-static.js'", JSON.stringify(new URL('../src/warcraftlogs-static.js', import.meta.url).href))
    .replaceAll('import.meta.env.VITE_STATIC_DATA', "'true'")
    .replaceAll('import.meta.env.BASE_URL', "'/loot-optimizer/'")
    .replaceAll('__DATA_VERSION__', "'test-version'");
  const { dataFetch } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const input = { ...data.snapshots[0].context, ...data.snapshots[0].spec };
  await Promise.all(['catalog', 'items', 'popularity'].map(route => dataFetch(query(route, input).href)));
  assert.deepEqual(calls, ['/loot-optimizer/data/warcraftlogs.json?v=test-version']);
  await assert.rejects(dataFetch('/api/warcraftlogs/cache'));
  await assert.rejects(dataFetch('/api/warcraftlogs/sync', { method: 'POST' }));
  await assert.rejects(dataFetch('/api/warcraftlogs/catalog', { signal: AbortSignal.abort() }));
  assert.equal(calls.length, 1);
});
