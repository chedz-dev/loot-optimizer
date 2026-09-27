import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WarcraftLogsError } from './warcraftlogs-client.js';

export const WARCRAFTLOGS_LOCK_NAME = '.sync.lock';
const SNAPSHOT_NAME = /^[a-f0-9]{64}\.json$/;
const FILE_NAME = /^(?:catalog|state|manifest|[a-f0-9]{64})\.json$/;
const LEASE_DURATION = 30_000;
const clone = (value) => value == null ? null : structuredClone(value);
const storageError = () => new WarcraftLogsError('No se pudo guardar la base local de Warcraft Logs. Se conserva la captura anterior.', 'STORAGE_ERROR', 500);
const conflict = () => new WarcraftLogsError('Ya hay una actualización de Warcraft Logs en curso.', 'SYNC_RUNNING', 409);

function processIsAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

function parseData(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) && value.schemaVersion === 1 ? value : null;
  } catch { return null; }
}

function parseLease(text) {
  const value = parseData(text);
  if (!value || !Number.isInteger(value.pid) || value.pid <= 0 || typeof value.owner !== 'string'
      || !value.owner.startsWith(`${value.pid}:`) || typeof value.label !== 'string'
      || ![value.startedAt, value.heartbeatAt, value.expiresAt].every(Number.isFinite)) return null;
  return value;
}

/** Durable JSON snapshots. Reading never fetches remote data or changes a file. */
export function createWarcraftLogsStore({ cacheDir = null, now = Date.now, fsImpl = fs, isProcessAlive = processIsAlive } = {}) {
  const directory = cacheDir == null ? null : path.resolve(cacheDir);
  const memory = new Map();
  const recovered = new Set();
  let memoryLease = null;

  function validateName(name) {
    if (typeof name !== 'string' || !FILE_NAME.test(name)) {
      throw new WarcraftLogsError('Nombre de archivo local no válido.', 'INVALID_STORAGE_KEY', 400);
    }
    return name;
  }

  function readText(file) {
    try { return fsImpl.readFileSync(file, 'utf8'); } catch { return null; }
  }

  function ensureDirectory() {
    fsImpl.mkdirSync(directory, { recursive: true });
  }

  function syncDirectory() {
    // Windows does not support opening/fsyncing directories through Node. Files
    // are always fsynced; directory fsync improves rename durability on POSIX.
    if (process.platform === 'win32') return;
    let descriptor;
    try { descriptor = fsImpl.openSync(directory, 'r'); fsImpl.fsyncSync(descriptor); }
    catch (error) { if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(error.code)) throw error; }
    finally { if (descriptor !== undefined) fsImpl.closeSync(descriptor); }
  }

  function writeTemporary(text) {
    const temporary = path.join(directory, `.wcl-${process.pid}-${randomUUID()}.tmp`);
    let descriptor;
    try {
      descriptor = fsImpl.openSync(temporary, 'wx', 0o600);
      fsImpl.writeFileSync(descriptor, text, 'utf8');
      fsImpl.fsyncSync(descriptor);
      fsImpl.closeSync(descriptor);
      descriptor = undefined;
      return temporary;
    } catch (error) {
      if (descriptor !== undefined) { try { fsImpl.closeSync(descriptor); } catch {} }
      try { fsImpl.unlinkSync(temporary); } catch {}
      throw error;
    }
  }

  function atomicReplace(file, text) {
    const temporary = writeTemporary(text);
    try {
      // Windows puede bloquear brevemente un archivo mientras otro proceso lo lee.
      for (let attempt = 0; ; attempt += 1) {
        try {
          fsImpl.renameSync(temporary, file);
          break;
        } catch (error) {
          if (attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) {
            throw error;
          }

          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 * 2 ** attempt);
        }
      }

      syncDirectory();
    }
    finally { try { fsImpl.unlinkSync(temporary); } catch {} }
  }

  function read(name) {
    validateName(name);
    if (!directory) return clone(memory.get(name));
    const file = path.join(directory, name);
    const primary = parseData(readText(file));
    if (primary) return primary;
    const backup = parseData(readText(`${file}.bak`));
    if (backup) recovered.add(name);
    return backup;
  }

  function write(name, value) {
    validateName(name);
    try {
      const serialized = JSON.stringify(value, null, 2);
      const verified = parseData(serialized);
      if (!verified) throw storageError();
      if (!directory) { memory.set(name, verified); return clone(verified); }
      ensureDirectory();
      const file = path.join(directory, name);
      const primaryText = readText(file);
      const backupFile = `${file}.bak`;
      let firstBackup = false;
      // A corrupt primary must never replace the last readable backup. On the
      // first write keep a backup too, so even the first snapshot is recoverable.
      if (parseData(primaryText)) atomicReplace(backupFile, primaryText);
      else if (!parseData(readText(backupFile))) { atomicReplace(backupFile, serialized); firstBackup = true; }
      try { atomicReplace(file, serialized); }
      catch (error) {
        // Do not advertise an uncommitted first snapshot through its backup if
        // publication failed. Existing known-good backups are always retained.
        if (firstBackup && !parseData(readText(file)) && readText(backupFile) === serialized) {
          try { fsImpl.unlinkSync(backupFile); } catch {}
        }
        throw error;
      }
      return clone(verified);
    } catch { throw storageError(); }
  }

  function listSnapshotKeys() {
    let names;
    if (!directory) names = [...memory.keys()];
    else {
      try { names = fsImpl.readdirSync(directory).map((name) => name.endsWith('.json.bak') ? name.slice(0, -4) : name); }
      catch { return []; }
    }
    return [...new Set(names)].filter((name) => SNAPSHOT_NAME.test(name) && read(name))
      .map((name) => name.slice(0, -5)).sort();
  }

  function stats() {
    if (!directory) return { files: memory.size, bytes: [...memory.values()].reduce((sum, value) => sum + Buffer.byteLength(JSON.stringify(value)), 0), recoveredFiles: 0 };
    let files = 0;
    let bytes = 0;
    try {
      for (const name of fsImpl.readdirSync(directory)) {
        if (!FILE_NAME.test(name) && !(name.endsWith('.bak') && FILE_NAME.test(name.slice(0, -4)))) continue;
        try { const stat = fsImpl.statSync(path.join(directory, name)); if (stat.isFile()) { files += 1; bytes += stat.size; } } catch {}
      }
    } catch {}
    return { files, bytes, recoveredFiles: recovered.size };
  }

  function newLease(label) {
    const time = now();
    return { schemaVersion: 1, owner: `${process.pid}:${randomUUID()}`, pid: process.pid,
      label: String(label).slice(0, 80), startedAt: time, heartbeatAt: time, expiresAt: time + LEASE_DURATION };
  }

  function inspectLease(file) {
    const text = readText(file);
    if (text === null) {
      // Unreadable files are not safe to treat as absent.
      try { if (fsImpl.existsSync(file)) return { invalid: true }; } catch { return { invalid: true }; }
      return null;
    }
    return parseLease(text) || { invalid: true };
  }

  function getLease() {
    const lease = directory ? inspectLease(path.join(directory, WARCRAFTLOGS_LOCK_NAME)) : memoryLease;
    if (!lease) return null;
    if (lease.invalid) return { owner: null, pid: null, label: 'sync', invalid: true, abandoned: false };
    return { ...clone(lease), abandoned: !isProcessAlive(lease.pid) };
  }

  function exclusiveLease(file, lease) {
    // link is an atomic create-if-absent. Publishing a fully fsynced file avoids
    // exposing an empty lock if a process is interrupted during acquisition.
    const temporary = writeTemporary(JSON.stringify(lease));
    let published = false;
    try { fsImpl.linkSync(temporary, file); published = true; syncDirectory(); return true; }
    catch (error) {
      if (published) { try { releaseOwned(file, lease.owner); } catch {} }
      if (!published && error.code === 'EEXIST') return false;
      throw error;
    }
    finally { try { fsImpl.unlinkSync(temporary); } catch {} }
  }

  function releaseOwned(file, owner) {
    if (inspectLease(file)?.owner !== owner) return false;
    fsImpl.unlinkSync(file);
    syncDirectory();
    return true;
  }

  function removeAbandoned(file, expected, depth = 0) {
    if (depth > 6 || !expected?.owner || isProcessAlive(expected.pid)) return false;
    // Only one contender may reclaim a specific stale lock at a time. Without
    // this guard, two reclaimers could unlink a newly acquired live lease.
    const guardFile = `${file}.reclaim`;
    const guard = newLease('reclaim');
    if (!exclusiveLease(guardFile, guard)) {
      const existing = inspectLease(guardFile);
      if (!existing || !removeAbandoned(guardFile, existing, depth + 1) || !exclusiveLease(guardFile, guard)) return false;
    }
    try {
      const current = inspectLease(file);
      if (current?.owner !== expected.owner || isProcessAlive(current.pid)) return false;
      return releaseOwned(file, current.owner);
    } finally { releaseOwned(guardFile, guard.owner); }
  }

  function acquireLease({ label = 'sync' } = {}) {
    const metadata = newLease(label);
    const file = directory && path.join(directory, WARCRAFTLOGS_LOCK_NAME);
    try {
      if (!directory) {
        if (memoryLease) throw conflict();
        memoryLease = metadata;
      } else {
        ensureDirectory();
        if (!exclusiveLease(file, metadata)) {
          const existing = inspectLease(file);
          if (!existing || !removeAbandoned(file, existing) || !exclusiveLease(file, metadata)) throw conflict();
        }
      }
    } catch (error) { if (error instanceof WarcraftLogsError) throw error; throw storageError(); }

    let released = false;
    const refresh = () => {
      if (released) return false;
      try {
        const current = directory ? inspectLease(file) : memoryLease;
        if (current?.owner !== metadata.owner) return false;
        const time = now();
        metadata.heartbeatAt = time;
        metadata.expiresAt = time + LEASE_DURATION;
        if (directory) atomicReplace(file, JSON.stringify(metadata));
        else memoryLease = clone(metadata);
        return true;
      } catch { throw storageError(); }
    };
    const timer = setInterval(() => { try { refresh(); } catch { /* A live PID still protects a lease when a heartbeat cannot be written. */ } }, 10_000);
    timer.unref();
    const release = () => {
      if (released) return false;
      released = true;
      clearInterval(timer);
      try {
        if (directory) return releaseOwned(file, metadata.owner);
        if (memoryLease?.owner !== metadata.owner) return false;
        memoryLease = null;
        return true;
      } catch { throw storageError(); }
    };
    return { owner: metadata.owner, refresh, release };
  }

  return { read, write, listSnapshotKeys, stats, getLease, acquireLease };
}
