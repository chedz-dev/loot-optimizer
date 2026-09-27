import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createWarcraftLogsStore, WARCRAFTLOGS_LOCK_NAME } from '../server/warcraftlogs-store.js';

const moduleUrl = new URL('../server/warcraftlogs-store.js', import.meta.url).href;
const key = 'a'.repeat(64);
const data = (revision) => ({ schemaVersion: 1, revision, nested: { items: [270167] } });
function temporaryStore(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'loot-wcl-store-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, store: createWarcraftLogsStore({ cacheDir: directory, ...options }) };
}
function childCode(directory, body) {
  return `import { createWarcraftLogsStore } from ${JSON.stringify(moduleUrl)}; const store = createWarcraftLogsStore({cacheDir:${JSON.stringify(directory)}}); ${body}`;
}
function abandonedLease(directory) {
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', childCode(directory, "store.acquireLease({label:'interrupted'});")], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

test('WCL memory database returns independent JSON copies without changing the input', () => {
  const store = createWarcraftLogsStore({ cacheDir: null });
  const input = data(1);
  store.write('catalog.json', input);
  input.nested.items.push(123);
  const firstRead = store.read('catalog.json');
  firstRead.nested.items.push(456);
  assert.deepEqual(store.read('catalog.json'), data(1));
  assert.equal(store.read('state.json'), null);
  assert.equal(store.stats().files, 1);
});

test('WCL JSON database rejects traversal and unsupported names for reads and writes', (t) => {
  const { store } = temporaryStore(t);
  for (const name of ['../catalog.json', '..\\catalog.json', '/catalog.json', 'C:\\catalog.json', 'tokens.json', `${key}.json.bak`, `${key.toUpperCase()}.json`, 'catalog.json\0', '', null]) {
    for (const operation of [() => store.read(name), () => store.write(name, data(1))]) {
      assert.throws(operation, (error) => error.code === 'INVALID_STORAGE_KEY' && error.status === 400);
    }
  }
});

test('WCL persisted JSON survives a store restart and schema mismatches are not returned', (t) => {
  const { directory, store } = temporaryStore(t);
  store.write('catalog.json', data(1));
  assert.deepEqual(createWarcraftLogsStore({ cacheDir: directory }).read('catalog.json'), data(1));
  fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify({ schemaVersion: 2, data: 'unsupported' }));
  assert.equal(store.read('state.json'), null);
  for (const value of [null, [], { schemaVersion: 2 }, undefined]) assert.throws(() => store.write('catalog.json', value), { code: 'STORAGE_ERROR' });
  assert.deepEqual(store.read('catalog.json'), data(1));
});

test('WCL first snapshot has a usable backup and corrupt reads never mutate primary files', (t) => {
  const { directory, store } = temporaryStore(t);
  const primary = path.join(directory, `${key}.json`);
  store.write(`${key}.json`, data(1));
  assert.deepEqual(JSON.parse(fs.readFileSync(`${primary}.bak`, 'utf8')), data(1));
  fs.writeFileSync(primary, '{"schemaVersion":1,"revision":');
  assert.deepEqual(store.read(`${key}.json`), data(1));
  assert.equal(fs.readFileSync(primary, 'utf8'), '{"schemaVersion":1,"revision":');
  assert.equal(store.stats().recoveredFiles, 1);
  assert.deepEqual(store.listSnapshotKeys(), [key]);
});

test('WCL repeated writes preserve last known good backup through corrupt and missing primaries', (t) => {
  const { directory, store } = temporaryStore(t);
  const primary = path.join(directory, 'catalog.json');
  store.write('catalog.json', data(1));
  store.write('catalog.json', data(2));
  assert.deepEqual(JSON.parse(fs.readFileSync(`${primary}.bak`, 'utf8')), data(1));
  fs.writeFileSync(primary, 'truncated');
  store.write('catalog.json', data(3));
  assert.deepEqual(JSON.parse(fs.readFileSync(`${primary}.bak`, 'utf8')), data(1));
  store.write('catalog.json', data(4));
  assert.deepEqual(JSON.parse(fs.readFileSync(`${primary}.bak`, 'utf8')), data(3));
  fs.unlinkSync(primary);
  assert.deepEqual(store.read('catalog.json'), data(3));
  store.write('catalog.json', data(5));
  assert.deepEqual(JSON.parse(fs.readFileSync(`${primary}.bak`, 'utf8')), data(3));
});

test('WCL failed atomic replacement preserves existing snapshot and removes temporary files', (t) => {
  const { directory, store } = temporaryStore(t);
  store.write('catalog.json', data(1));
  const primary = path.join(directory, 'catalog.json');
  const failingStore = createWarcraftLogsStore({ cacheDir: directory, fsImpl: {
    ...fs,
    renameSync: (from, to) => {
      if (to === primary) throw new Error('Internal secret-bearing operating system error');
      return fs.renameSync(from, to);
    },
  } });
  assert.throws(() => failingStore.write('catalog.json', data(2)), (error) => error.code === 'STORAGE_ERROR' && !error.message.includes('secret'));
  assert.deepEqual(store.read('catalog.json'), data(1));
  assert.deepEqual(JSON.parse(fs.readFileSync(`${primary}.bak`, 'utf8')), data(1));
  assert.equal(fs.readdirSync(directory).some((name) => name.endsWith('.tmp')), false);
});

test('WCL retries a transient file lock without rewriting or losing the previous snapshot', t => {
  const { directory, store } = temporaryStore(t);
  store.write('catalog.json', data(1));
  const primary = path.join(directory, 'catalog.json');
  let attempts = 0;
  const retryingStore = createWarcraftLogsStore({ cacheDir: directory, fsImpl: {
    ...fs,
    renameSync: (from, to) => {
      if (to === primary && ++attempts < 3) {
        throw Object.assign(new Error('File is locked'), { code: 'EPERM' });
      }

      return fs.renameSync(from, to);
    },
  } });
  retryingStore.write('catalog.json', data(2));
  assert.equal(attempts, 3);
  assert.deepEqual(store.read('catalog.json'), data(2));
  assert.deepEqual(JSON.parse(fs.readFileSync(`${primary}.bak`, 'utf8')), data(1));
});

test('WCL stops retrying persistent file locks and preserves the old snapshot', t => {
  const { directory, store } = temporaryStore(t);
  store.write('catalog.json', data(1));
  const primary = path.join(directory, 'catalog.json');
  let attempts = 0;
  const lockedStore = createWarcraftLogsStore({ cacheDir: directory, fsImpl: {
    ...fs,
    renameSync: (from, to) => {
      if (to === primary) {
        attempts++;
        throw Object.assign(new Error('File is locked'), { code: 'EPERM' });
      }

      return fs.renameSync(from, to);
    },
  } });
  assert.throws(() => lockedStore.write('catalog.json', data(2)), { code: 'STORAGE_ERROR' });
  assert.equal(attempts, 6);
  assert.deepEqual(store.read('catalog.json'), data(1));
  assert.equal(fs.readdirSync(directory).some(name => name.endsWith('.tmp')), false);
});

test('WCL failed file fsync never replaces the existing snapshot', (t) => {
  const { directory, store } = temporaryStore(t);
  store.write('catalog.json', data(1));
  const failingStore = createWarcraftLogsStore({ cacheDir: directory, fsImpl: { ...fs, fsyncSync: () => { throw new Error('disk failed'); } } });
  assert.throws(() => failingStore.write('catalog.json', data(2)), { code: 'STORAGE_ERROR' });
  assert.deepEqual(store.read('catalog.json'), data(1));
  assert.equal(fs.readdirSync(directory).some((name) => name.endsWith('.tmp')), false);
});

test('WCL failed first snapshot is not visible through an uncommitted backup', (t) => {
  const { directory, store } = temporaryStore(t);
  const primary = path.join(directory, `${key}.json`);
  const failingStore = createWarcraftLogsStore({ cacheDir: directory, fsImpl: {
    ...fs, renameSync: (from, to) => {
      if (to === primary) throw new Error('publication failed');
      return fs.renameSync(from, to);
    },
  } });
  assert.throws(() => failingStore.write(`${key}.json`, data(1)), { code: 'STORAGE_ERROR' });
  assert.equal(store.read(`${key}.json`), null);
  assert.deepEqual(store.listSnapshotKeys(), []);
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('WCL discovers existing hash snapshots, including backup-only files, without a manifest', (t) => {
  const { directory, store } = temporaryStore(t);
  const legacyKey = 'b'.repeat(64);
  const backupKey = 'c'.repeat(64);
  fs.writeFileSync(path.join(directory, `${legacyKey}.json`), JSON.stringify(data(1)));
  fs.writeFileSync(path.join(directory, `${backupKey}.json.bak`), JSON.stringify(data(2)));
  fs.writeFileSync(path.join(directory, `${'d'.repeat(64)}.json`), '{}');
  fs.writeFileSync(path.join(directory, 'unrelated.json'), JSON.stringify(data(5)));
  store.write('catalog.json', data(3));
  store.write('manifest.json', data(4));
  assert.deepEqual(store.listSnapshotKeys(), [legacyKey, backupKey]);
  assert.equal(store.stats().recoveredFiles, 1);
  assert.ok(store.stats().bytes > 0);
});

test('WCL memory leases are exclusive, refreshable, and released idempotently', () => {
  let clock = 1;
  const store = createWarcraftLogsStore({ cacheDir: null, now: () => clock });
  const lease = store.acquireLease({ label: 'raid' });
  try {
    assert.equal(store.getLease().label, 'raid');
    assert.throws(() => store.acquireLease(), { code: 'SYNC_RUNNING', status: 409 });
    clock += 5_000;
    assert.equal(lease.refresh(), true);
    assert.equal(store.getLease().heartbeatAt, clock);
  } finally { lease.release(); }
  assert.equal(store.getLease(), null);
  assert.equal(lease.refresh(), false);
  assert.equal(lease.release(), false);
});

test('WCL leases prevent same-process and cross-process writers even after heartbeat expiration', (t) => {
  let clock = 1;
  const { directory, store } = temporaryStore(t, { now: () => clock });
  const lease = store.acquireLease();
  t.after(() => lease.release());
  clock += 3_600_000;
  const secondStore = createWarcraftLogsStore({ cacheDir: directory, now: () => clock });
  assert.throws(() => secondStore.acquireLease(), { code: 'SYNC_RUNNING' });
  assert.equal(secondStore.getLease().abandoned, false);
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', childCode(directory, "try { store.acquireLease(); process.exitCode=1; } catch(error) { console.log(error.code); }")], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout.trim(), 'SYNC_RUNNING');
});

test('WCL reclaims an interrupted process lease even when its timestamp is still fresh', (t) => {
  const { directory, store } = temporaryStore(t);
  abandonedLease(directory);
  assert.equal(store.getLease().abandoned, true);
  const lease = store.acquireLease({ label: 'recovered' });
  try {
    assert.equal(store.getLease().owner, lease.owner);
    assert.equal(store.getLease().abandoned, false);
  } finally { lease.release(); }
  assert.equal(store.getLease(), null);
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('WCL older owners cannot refresh or delete a replacement lease', (t) => {
  const { directory, store } = temporaryStore(t);
  const lease = store.acquireLease();
  const lock = path.join(directory, WARCRAFTLOGS_LOCK_NAME);
  const replacement = { ...store.getLease(), owner: `${process.pid}:replacement-owner` };
  fs.writeFileSync(lock, JSON.stringify(replacement));
  try {
    assert.equal(lease.refresh(), false);
    assert.equal(lease.release(), false);
    assert.equal(store.getLease().owner, replacement.owner);
  } finally { lease.release(); }
});

test('WCL malformed lease fails closed without exposing filesystem errors', (t) => {
  const { directory, store } = temporaryStore(t);
  fs.writeFileSync(path.join(directory, WARCRAFTLOGS_LOCK_NAME), '{broken');
  assert.equal(store.getLease().invalid, true);
  assert.throws(() => store.acquireLease(), { code: 'SYNC_RUNNING' });
});

test('WCL simultaneous processes safely reclaim one abandoned lease with a single winner', async (t) => {
  const { directory } = temporaryStore(t);
  abandonedLease(directory);
  const run = () => new Promise((resolve, reject) => {
    const source = childCode(directory, "try { const lease=store.acquireLease(); console.log('acquired'); setTimeout(()=>lease.release(),400); } catch(error) { console.log(error.code); }");
    const child = spawn(process.execPath, ['--input-type=module', '--eval', source]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr)));
  });
  const results = await Promise.all([run(), run(), run()]);
  assert.deepEqual(results.sort(), ['SYNC_RUNNING', 'SYNC_RUNNING', 'acquired']);
  assert.deepEqual(fs.readdirSync(directory), []);
});
