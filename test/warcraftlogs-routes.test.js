import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createWarcraftLogsRouter } from '../server/warcraftlogs-routes.js';
import { WarcraftLogsError } from '../server/warcraftlogs-client.js';

async function withApi(service, run) {
  const app = express();
  app.use(express.json());
  app.use('/api/warcraftlogs', createWarcraftLogsRouter(service));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}/api/warcraftlogs`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('WCL routes reject a foreign browser origin before using the authenticated service', async () => {
  let calls = 0;
  await withApi({ getCatalog: () => { calls += 1; return {}; } }, async (base) => {
    const denied = await fetch(`${base}/catalog`, { headers: { origin: 'https://foreign.example' } });
    assert.equal(denied.status, 403);
    assert.equal(calls, 0);
    const allowed = await fetch(`${base}/catalog`, { headers: { origin: 'http://localhost:5173' } });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('cache-control'), 'no-store');
    assert.equal(calls, 1);
  });
});

test('WCL routes preserve safe service status, hide unknown exception bodies, and dispatch sync', async () => {
  await withApi({
    getPopularity: () => { throw new Error('sensitive upstream response'); },
    getItemPopularity: () => { throw new WarcraftLogsError('Item no válido.', 'INVALID_CONTEXT', 400); },
    startSync: (input) => ({ id: 'job', status: 'running', context: input }),
    getJob: (id) => ({ id, status: 'complete' }),
  }, async (base) => {
    const bad = await fetch(`${base}/popularity`);
    assert.equal(bad.status, 502);
    assert.ok(!(await bad.text()).includes('sensitive'));
    const invalid = await fetch(`${base}/item?itemId=-1`);
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).code, 'INVALID_CONTEXT');
    const job = await fetch(`${base}/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ zoneId: 53 }) });
    assert.equal(job.status, 202);
    assert.equal((await job.json()).context.zoneId, 53);
    assert.equal((await (await fetch(`${base}/sync?id=job`)).json()).status, 'complete');
  });
});

test('WCL read routes expose only cached service methods and preserve CACHE_MISS responses', async () => {
  const calls = [];
  const service = Object.fromEntries(['getCatalog', 'getItems', 'getItemPopularity', 'getCacheStatus', 'getSyncPlan', 'getJob'].map((name) => [name, (input) => {
    calls.push({ name, input });
    return { name, input };
  }]));
  service.getPopularity = () => { throw new WarcraftLogsError('La captura aún no existe.', 'CACHE_MISS', 404); };
  for (const name of ['refreshCatalog', 'startSync', 'resumeSync', 'rebuild']) service[name] = () => assert.fail(`GET dispatched update method ${name}`);
  await withApi(service, async (base) => {
    for (const [route, method] of [
      ['catalog', 'getCatalog'], ['items?zoneId=42', 'getItems'], ['item?itemId=990001', 'getItemPopularity'],
      ['cache', 'getCacheStatus'], ['sync/plan?scope=spec&classId=mage&specId=arcane', 'getSyncPlan'], ['sync?id=job', 'getJob'],
    ]) {
      const response = await fetch(`${base}/${route}`);
      assert.equal(response.status, 200, route);
      assert.equal((await response.json()).name, method, route);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    const missing = await fetch(`${base}/popularity?zoneId=42&classId=mage&specId=arcane`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).code, 'CACHE_MISS');
  });
  assert.equal(calls.length, 6);
});

test('WCL update routes require POST and forward explicit sync, catalog, resume and offline rebuild options', async () => {
  const calls = [];
  const service = Object.fromEntries(['refreshCatalog', 'startSync', 'resumeSync', 'rebuild'].map((name) => [name, (input) => {
    calls.push({ name, input });
    return { id: 'job', name, input };
  }]));
  await withApi(service, async (base) => {
    const actions = [
      ['catalog/refresh', 'refreshCatalog', { force: true }, 200],
      ['sync', 'startSync', { scope: 'spec', mode: 'missing', zoneId: 42, classId: 'mage', specId: 'arcane' }, 202],
      ['sync/resume', 'resumeSync', { id: 'saved-job' }, 202],
      ['rebuild', 'rebuild', {}, 202],
    ];
    for (const [route, method, body, status] of actions) {
      const response = await fetch(`${base}/${route}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      assert.equal(response.status, status, route);
      assert.equal((await response.json()).name, method, route);
    }
    for (const route of ['catalog/refresh', 'sync/resume', 'rebuild']) {
      assert.equal((await fetch(`${base}/${route}`)).status, 404, `GET ${route} must not update cache`);
    }
  });
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[0].input, { force: true });
  assert.deepEqual(calls[1].input, { scope: 'spec', mode: 'missing', zoneId: 42, classId: 'mage', specId: 'arcane' });
  assert.equal(calls[2].input, 'saved-job');
});

test('WCL foreign-origin requests cannot start any cache update', async () => {
  const service = Object.fromEntries(['refreshCatalog', 'startSync', 'resumeSync', 'rebuild'].map((name) => [name, () => assert.fail(`Foreign origin dispatched ${name}`)]));
  await withApi(service, async (base) => {
    for (const route of ['catalog/refresh', 'sync', 'sync/resume', 'rebuild']) {
      const response = await fetch(`${base}/${route}`, {
        method: 'POST', headers: { origin: 'https://foreign.example', 'Content-Type': 'application/json' }, body: '{}',
      });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).code, 'LOCAL_ONLY');
    }
  });
});
