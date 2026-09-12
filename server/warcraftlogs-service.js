import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { classSpecs, allSpecs } from './spec-catalog.js';
import { WarcraftLogsError, warcraftLogsClient } from './warcraftlogs-client.js';
import { createWarcraftLogsStore } from './warcraftlogs-store.js';
import { CURRENT_ITEM_SEASON } from './item-seasons.js';
import { WCL_TTL_MS, WCL_SAMPLE_SIZE, metricForSpec, itemDetails, aggregateTrinketPopularity, popularitySignals } from './warcraftlogs-data.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const invalid = (message) => new WarcraftLogsError(message, 'INVALID_CONTEXT', 400);
const contextKey = (context) => [context.zoneId, context.encounterId, context.difficulty, context.partition].join(':');
const keyFor = (context, spec) => createHash('sha256').update(`1:${contextKey(context)}:${spec.id}:${metricForSpec(spec, context.contentType)}:${WCL_SAMPLE_SIZE}`).digest('hex');
const safeError = (error) => error instanceof WarcraftLogsError ? error : new WarcraftLogsError('No se pudo procesar la captura local. Se conserva la anterior.', 'CACHE_ERROR', 500);

const CATALOG_QUERY = `query TrinketPopularityCatalog {
  worldData { zones { id name frozen expansion { id name }
    difficulties { id name } encounters { id name } partitions { id name default }
  } }
  gameData { classes { id name slug specs { id name slug } } }
  rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn }
}`;

const RANKINGS_QUERY = `query TrinketPopularityTop100(
  $encounter: Int!, $difficulty: Int!, $partition: Int!,
  $className: String!, $specName: String!, $metric: CharacterRankingMetricType!, $page: Int!
) {
  worldData { encounter(id: $encounter) { characterRankings(
    difficulty: $difficulty, partition: $partition, className: $className, specName: $specName,
    metric: $metric, page: $page, includeCombatantInfo: true, includeOtherPlayers: false
  ) } }
  rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn }
}`;


/**
 * GETs read durable JSON only. An expired snapshot is usable until an explicit
 * update replaces it. A process-wide file lease serializes every writer.
 */
export function createWarcraftLogsService({ client = warcraftLogsClient,
  cacheDir = path.join(root, 'data', 'warcraftlogs'), now = Date.now, store } = {}) {
  const db = store || createWarcraftLogsStore({ cacheDir, now });
  const runningJobs = new Map();
  const iso = () => new Date(now()).toISOString();
  const fresh = (value) => Boolean(value && now() < Date.parse(value.expiresAt));
  const state = () => db.read('state.json') || { schemaVersion: 1, jobs: [], failures: {}, apiUsage: { queries: 0, lastRequestAt: null } };
  const changeState = (change) => { const value = state(); change(value); db.write('state.json', value); return value; };
  const catalog = () => db.read('catalog.json');
  function requireCatalog() {
    const value = catalog();
    if (!value) throw new WarcraftLogsError('Descarga el catálogo con Actualizar catálogo para inicializar la base local.', 'CATALOG_REQUIRED', 409);
    return value;
  }
  function getCatalog() {
    const value = catalog();
    return { configured: client.configured(), cacheAvailable: Boolean(value), readPolicy: 'cache-only', currentItemSeason: { ...CURRENT_ITEM_SEASON },
      zones: value?.zones || [], classes: classSpecs, defaultContext: value?.defaultContext || null,
      cacheHours: 1, fetchedAt: value?.fetchedAt || null, stale: Boolean(value && !fresh(value)) };
  }
  async function query(document, variables) {
    const current = state();
    if (current.providerBackoff?.until > now()) throw new WarcraftLogsError('La API está en pausa temporal. Los datos locales siguen disponibles.', 'API_BACKOFF', 429);
    changeState((value) => { value.apiUsage.queries += 1; value.apiUsage.lastRequestAt = iso(); });
    try {
      const data = await client.query(document, variables);
      if (data.rateLimitData) changeState((value) => {
        value.apiUsage.rateLimit = data.rateLimitData;
        if (data.rateLimitData.pointsSpentThisHour >= data.rateLimitData.limitPerHour) {
          value.providerBackoff = { code: 'RATE_LIMITED', until: now() + Math.max(60, Number(data.rateLimitData.pointsResetIn) || 3600) * 1000 };
        }
      });
      return data;
    } catch (error) {
      const safe = safeError(error);
      if (['RATE_LIMITED', 'AUTH_ERROR', 'CREDENTIALS_REQUIRED', 'AUTH_FAILED'].includes(safe.code)) {
        changeState((value) => { value.providerBackoff = { code: safe.code, until: Math.max(
          value.providerBackoff?.until || 0, Number(safe.retryAt) || 0,
          now() + (safe.code === 'RATE_LIMITED' ? 300_000 : 60_000)) }; });
      }
      throw safe;
    }
  }
  async function refreshCatalog({ force = false } = {}) {
    const lease = db.acquireLease({ label: 'catalog' });
    try {
      if (!force && fresh(catalog())) return getCatalog();
      const data = await query(CATALOG_QUERY);
      const zonesRaw = data.worldData?.zones;
      if (!Array.isArray(zonesRaw) || !Array.isArray(data.gameData?.classes)) throw new WarcraftLogsError('Catálogo de Warcraft Logs no válido.', 'INVALID_RESPONSE');
      const expansion = Math.max(...zonesRaw.map((zone) => zone.expansion?.id ?? -1));
      const zones = zonesRaw.filter((zone) => zone.expansion?.id === expansion && !zone.frozen
        && zone.encounters?.length && zone.partitions?.length && zone.difficulties?.length && !/PTR|Beta|Complete|Dummy/i.test(zone.name))
        .map((zone) => ({ ...zone, contentType: /^Mythic\+/i.test(zone.name) ? 'mythic-plus' : 'raid' }));
      const zone = zones.find((entry) => entry.contentType === 'raid') || zones[0];
      if (!zone) throw new WarcraftLogsError('No hay zonas activas disponibles.', 'NO_ZONES');
      db.write('catalog.json', { schemaVersion: 1, zones, wclClasses: data.gameData.classes, fetchedAt: iso(),
        expiresAt: new Date(now() + WCL_TTL_MS).toISOString(),
        defaultContext: { zoneId: zone.id, encounterId: zone.encounters[0].id,
          difficulty: (zone.difficulties.find((entry) => entry.name === 'Mythic') || zone.difficulties[0]).id,
          partition: (zone.partitions.find((entry) => entry.default) || zone.partitions[0]).id } });
      return getCatalog();
    } finally { lease.release(); }
  }
  function resolveContext(input = {}) {
    const value = requireCatalog();
    const zone = value.zones.find((entry) => entry.id === Number(input.zoneId ?? value.defaultContext.zoneId));
    if (!zone) throw invalid('Zona de Warcraft Logs no válida.');
    const encounter = zone.encounters.find((entry) => entry.id === Number(input.encounterId ?? zone.encounters[0].id));
    const defaultDifficulty = zone.id === value.defaultContext.zoneId ? value.defaultContext.difficulty
      : (zone.difficulties.find((entry) => entry.name === 'Mythic') || zone.difficulties[0]).id;
    const difficulty = zone.difficulties.find((entry) => entry.id === Number(input.difficulty ?? defaultDifficulty));
    const partition = zone.partitions.find((entry) => entry.id === Number(input.partition ?? (zone.partitions.find((part) => part.default) || zone.partitions[0]).id));
    if (!encounter || !difficulty || !partition) throw invalid('Encuentro, dificultad o partición no válidos para esta zona.');
    return { zoneId: zone.id, zoneName: zone.name, encounterId: encounter.id, encounterName: encounter.name,
      difficulty: difficulty.id, difficultyName: difficulty.name, partition: partition.id, partitionName: partition.name,
      contentType: zone.contentType, region: 'world' };
  }
  function resolveSpec(input) {
    const spec = allSpecs.find((entry) => entry.classId === input.classId && entry.specId === input.specId);
    if (!spec) throw invalid('Clase o especialización no válida.');
    const wclClass = requireCatalog().wclClasses.find((entry) => normalize(entry.name) === normalize(spec.className));
    const wclSpec = wclClass?.specs.find((entry) => normalize(entry.name) === normalize(spec.specName));
    if (!wclSpec) throw new WarcraftLogsError('Warcraft Logs no ofrece esta especialización.', 'SPEC_UNAVAILABLE', 404);
    return { ...spec, wclClassSlug: wclClass.slug, wclSpecSlug: wclSpec.slug };
  }
  function load(key) {
    const value = db.read(`${key}.json`);
    return value?.context && value?.spec && Array.isArray(value.items) && Number.isFinite(Date.parse(value.fetchedAt)) ? value : null;
  }
  function view(snapshot) {
    const { cohort, signals, rawRankings, sourcePages, ...result } = snapshot;
    return { ...result, items: snapshot.items.map((item) => ({ ...item, ...itemDetails(item) })),
      stale: !fresh(snapshot), cached: true, readPolicy: 'cache-only', canRebuild: Array.isArray(rawRankings) };
  }
  async function getPopularity(input = {}) {
    const context = resolveContext(input);
    const spec = resolveSpec(input);
    const snapshot = load(keyFor(context, spec));
    if (!snapshot) throw new WarcraftLogsError('No hay una captura guardada para esta selección. Usa Actualizar para descargarla.', 'CACHE_MISS', 404);
    return view(snapshot);
  }
  function contextSnapshots(input) {
    const context = resolveContext(input);
    const values = allSpecs.flatMap((spec) => { const snapshot = load(keyFor(context, spec)); return snapshot ? [view(snapshot)] : []; });
    return { context, values };
  }
  async function getItems(input = {}) {
    const { context, values } = contextSnapshots(input);
    const validCharacters = values.reduce((total, snapshot) => total + Math.max(0, snapshot.validCharacters || 0), 0);
    const items = new Map();
    values.forEach((snapshot) => snapshot.items.forEach((item) => {
      const entry = items.get(item.itemId) || { ...itemDetails(item), count: 0, validCharacters };
      // Sum observed use, not percentages from differently sized spec samples.
      if (snapshot.validCharacters > 0) entry.count += item.count || 0;
      items.set(item.itemId, entry);
    }));
    const sortedItems = [...items.values()].map((item) => ({ ...item,
      popularity: validCharacters ? item.count / validCharacters * 100 : 0,
    })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name) || a.itemId - b.itemId);
    return { context, items: sortedItems, snapshots: values.length, totalSpecs: allSpecs.length };
  }
  async function getItemPopularity(input = {}) {
    const itemId = Number(input.itemId);
    if (!Number.isSafeInteger(itemId) || itemId <= 0) throw invalid('Item no válido.');
    const { context, values } = contextSnapshots(input);
    const found = values.flatMap((snapshot) => snapshot.items).find((item) => item.itemId === itemId);
    const rankings = values.filter((snapshot) => snapshot.validCharacters > 0).map((snapshot) => {
      const item = snapshot.items.find((entry) => entry.itemId === itemId);
      return { ...snapshot.spec, count: item?.count || 0, popularity: item?.popularity || 0,
        validCharacters: snapshot.validCharacters, sampledCharacters: snapshot.sampledCharacters,
        metric: snapshot.metric, fetchedAt: snapshot.fetchedAt, stale: snapshot.stale, sourceUrl: snapshot.sourceUrl };
    }).sort((a, b) => b.popularity - a.popularity || b.validCharacters - a.validCharacters || a.className.localeCompare(b.className));
    return { item: itemDetails(found || { itemId }), context, rankings,
      coverage: { availableSpecs: values.length, totalSpecs: allSpecs.length, measuredSpecs: rankings.length } };
  }
  function scanManifest() {
    return { schemaVersion: 1, updatedAt: iso(), snapshots: db.listSnapshotKeys().flatMap((key) => {
      const value = load(key);
      return value ? [{ key, context: value.context, spec: value.spec, fetchedAt: value.fetchedAt, expiresAt: value.expiresAt,
        validCharacters: value.validCharacters, itemCount: value.items.length, rawAvailable: Array.isArray(value.rawRankings) }] : [];
    }) };
  }
  function saveSnapshot(key, value) {
    db.write(`${key}.json`, value);
    // The index is derived and repairable; snapshots remain the source of truth.
    const index = db.read('manifest.json') || scanManifest();
    index.snapshots = index.snapshots.filter((entry) => entry.key !== key);
    index.snapshots.push({ key, context: value.context, spec: value.spec, fetchedAt: value.fetchedAt,
      expiresAt: value.expiresAt, validCharacters: value.validCharacters, itemCount: value.items.length, rawAvailable: Array.isArray(value.rawRankings) });
    index.updatedAt = iso();
    db.write('manifest.json', index);
  }
  function publicJob(job) {
    if (!job) return null;
    const { tasks, contexts, leaseOwner, ...result } = structuredClone(job);
    const lease = db.getLease();
    if (result.status === 'running' && (!lease || lease.abandoned || lease.owner !== leaseOwner)) result.status = 'interrupted';
    result.resumable = ['interrupted', 'failed'].includes(result.status) && tasks.some((task) => !['done', 'skipped'].includes(task.status));
    return result;
  }
  function getJob(id) {
    const jobs = state().jobs;
    const job = id ? jobs.find((entry) => entry.id === id) : jobs.at(-1);
    if (id && !job) throw new WarcraftLogsError('Sincronización no encontrada.', 'JOB_NOT_FOUND', 404);
    return publicJob(job);
  }
  function getCacheStatus() {
    const entries = scanManifest().snapshots;
    const groups = new Map();
    for (const entry of entries) {
      const key = contextKey(entry.context);
      const group = groups.get(key) || { context: entry.context, availableSpecs: 0, freshSpecs: 0, totalSpecs: allSpecs.length };
      group.availableSpecs += 1;
      if (fresh(entry)) group.freshSpecs += 1;
      groups.set(key, group);
    }
    const current = state();
    const jobs = current.jobs.map(publicJob);
    return { schemaVersion: 1, cacheHours: 1, readPolicy: 'cache-only', snapshots: entries.length,
      freshSnapshots: entries.filter(fresh).length, staleSnapshots: entries.filter((entry) => !fresh(entry)).length,
      rawSnapshots: entries.filter((entry) => entry.rawAvailable).length, legacySnapshots: entries.filter((entry) => !entry.rawAvailable).length,
      lastUpdatedAt: entries.map((entry) => entry.fetchedAt).sort().at(-1) || null,
      contexts: [...groups.values()], lastJob: jobs.at(-1) || null,
      activeJob: jobs.findLast((job) => job.status === 'running') || null,
      apiUsage: current.apiUsage, providerBackoff: current.providerBackoff?.until > now() ? current.providerBackoff : null, storage: db.stats() };
  }
  const shouldFetch = (snapshot, mode) => mode === 'force' || !snapshot || (mode === 'stale' && !fresh(snapshot));
  function targetsFor(input = {}) {
    const scope = input.scope || 'context';
    const mode = input.mode || 'stale';
    if (!['spec', 'context', 'zone', 'cached', 'all'].includes(scope) || !['stale', 'missing', 'force'].includes(mode)) throw invalid('Alcance o modo de actualización no válido.');
    if (scope === 'cached') return { scope, mode, targets: scanManifest().snapshots.map((entry) => ({ context: entry.context, spec: entry.spec })) };
    const value = requireCatalog();
    const selected = scope === 'all' ? null : resolveContext(input);
    const contexts = scope === 'all' ? value.zones.flatMap((zone) => zone.difficulties.flatMap((difficulty) =>
      zone.encounters.map((encounter) => resolveContext({ zoneId: zone.id, encounterId: encounter.id, difficulty: difficulty.id }))))
      : scope === 'zone' ? value.zones.find((zone) => zone.id === selected.zoneId).encounters.map((encounter) => resolveContext({ ...selected, encounterId: encounter.id }))
        : [selected];
    const specs = scope === 'spec' ? [resolveSpec(input)] : allSpecs.map(resolveSpec);
    return { scope, mode, targets: contexts.flatMap((context) => specs.map((spec) => ({ context, spec }))) };
  }
  function getSyncPlan(input = {}) {
    if (!catalog() && input.scope !== 'cached') return { scope: input.scope || 'context', mode: input.mode || 'stale',
      total: 0, willFetch: 0, fresh: 0, stale: 0, missing: 0, minimumApiQueries: 0, catalogRefreshRequired: true };
    const { scope, mode, targets } = targetsFor(input);
    const snapshots = targets.map(({ context, spec }) => load(keyFor(context, spec)));
    const willFetch = snapshots.filter((snapshot) => shouldFetch(snapshot, mode)).length;
    return { scope, mode, total: targets.length, willFetch, fresh: snapshots.filter(fresh).length,
      missing: snapshots.filter((snapshot) => !snapshot).length, stale: snapshots.filter((snapshot) => snapshot && !fresh(snapshot)).length,
      minimumApiQueries: willFetch, catalogRefreshRequired: false };
  }
  async function downloadSnapshot(context, spec) {
    const rows = [];
    const sourcePages = [];
    for (let page = 1; page <= 5 && rows.length < WCL_SAMPLE_SIZE; page += 1) {
      const data = await query(RANKINGS_QUERY, { encounter: context.encounterId, difficulty: context.difficulty,
        partition: context.partition, className: spec.wclClassSlug, specName: spec.wclSpecSlug,
        metric: metricForSpec(spec, context.contentType), page });
      const payload = data.worldData?.encounter?.characterRankings;
      if (!payload || !Array.isArray(payload.rankings) || typeof payload.hasMorePages !== 'boolean') throw new WarcraftLogsError('Formato de rankings no reconocido. Se conserva la captura anterior.', 'INVALID_RESPONSE');
      if (payload.rankings.some((row) => !row || normalize(row.class) !== normalize(spec.wclClassSlug) || normalize(row.spec) !== normalize(spec.wclSpecSlug))) throw new WarcraftLogsError('La respuesta contiene otra especialización. No se guardaron esos datos.', 'SPEC_MISMATCH');
      const { rankings, ...metadata } = payload;
      sourcePages.push({ page, ...metadata, returnedRows: rankings.length });
      rows.push(...rankings.slice(0, WCL_SAMPLE_SIZE - rows.length));
      if (!payload.hasMorePages) break;
      if (!rankings.length || (page === 5 && rows.length < WCL_SAMPLE_SIZE)) throw new WarcraftLogsError('No se pudo completar la paginación del top 100.', 'INCOMPLETE_PAGINATION');
    }
    const snapshot = aggregateTrinketPopularity(rows, { spec, context, fetchedAt: iso() });
    if (rows.length && snapshot.validCharacters === 0) throw new WarcraftLogsError('El top no incluye equipo interpretable. Se conserva la captura anterior.', 'GEAR_UNAVAILABLE');
    return { ...snapshot, rawRankings: rows, sourcePages, processedAt: iso(), processingVersion: 1, signals: popularitySignals(snapshot) };
  }
  function saveJob(job) {
    job.completed = job.tasks.filter((task) => ['done', 'skipped', 'failed'].includes(task.status)).length;
    job.errors = job.tasks.filter((task) => task.status === 'failed').map((task) => ({ specId: task.spec.id,
      context: job.contexts[task.contextIndex], code: task.errorCode, error: task.error }));
    job.updatedAt = iso();
    changeState((value) => {
      value.jobs = value.jobs.filter((entry) => entry.id !== job.id);
      value.jobs.push(structuredClone(job));
      const completed = value.jobs.filter((entry) => entry.status === 'complete').slice(-10).map((entry) => entry.id);
      value.jobs = value.jobs.filter((entry) => entry.status !== 'complete' || completed.includes(entry.id));
    });
  }
  async function executeJob(job, lease) {
    const before = state().apiUsage.queries;
    const previousQueries = job.apiQueries;
    let cursor = 0;
    let stop = false;
    let consecutiveFailures = 0;
    const worker = async () => {
      while (!stop && cursor < job.tasks.length) {
        const task = job.tasks[cursor++];
        if (['done', 'skipped'].includes(task.status)) continue;
        const context = job.contexts[task.contextIndex];
        const key = keyFor(context, task.spec);
        task.status = 'running';
        try {
          const previous = load(key);
          if (job.kind === 'rebuild') {
            if (!Array.isArray(previous?.rawRankings)) { task.status = 'skipped'; job.skipped += 1; }
            else {
              const derived = aggregateTrinketPopularity(previous.rawRankings, { context, spec: task.spec, fetchedAt: previous.fetchedAt });
              saveSnapshot(key, { ...previous, ...derived, processedAt: iso(), processingVersion: 1, signals: popularitySignals(derived) });
              task.status = 'done'; job.rebuilt += 1;
            }
          } else if (!shouldFetch(previous, job.mode)) { task.status = 'skipped'; job.skipped += 1; }
          else {
            const failure = state().failures[key];
            if (failure?.until > now()) throw new WarcraftLogsError('Esta captura está en pausa tras un fallo. Inténtalo más tarde.', 'RETRY_COOLDOWN', 429);
            saveSnapshot(key, await downloadSnapshot(context, task.spec));
            changeState((value) => { delete value.failures[key]; });
            task.status = 'done'; job.fetched += 1; consecutiveFailures = 0;
          }
          delete task.error; delete task.errorCode;
        } catch (error) {
          const safe = safeError(error);
          task.status = 'failed'; task.errorCode = safe.code; task.error = safe.message;
          if (!['RETRY_COOLDOWN', 'API_BACKOFF'].includes(safe.code)) changeState((value) => {
            const attempts = (value.failures[key]?.attempts || 0) + 1;
            value.failures[key] = { attempts, until: now() + Math.min(WCL_TTL_MS, 60_000 * 2 ** Math.min(attempts - 1, 6)), code: safe.code };
          });
          if (['RATE_LIMITED', 'AUTH_ERROR', 'CREDENTIALS_REQUIRED', 'AUTH_FAILED', 'API_BACKOFF', 'STORAGE_ERROR'].includes(safe.code)) stop = true;
          if (['NETWORK_ERROR', 'GRAPHQL_ERROR', 'INVALID_RESPONSE', 'CACHE_ERROR', 'UPSTREAM_ERROR'].includes(safe.code) && ++consecutiveFailures >= 3) stop = true;
        }
        job.apiQueries = previousQueries + state().apiUsage.queries - before;
        saveJob(job);
      }
    };
    try {
      db.write('manifest.json', scanManifest());
      // A failed persistence operation must stop dispatch, but the lease must
      // remain held until every in-flight request/worker has actually settled.
      const guardedWorker = async () => {
        try { await worker(); } catch (error) { stop = true; throw error; }
      };
      const results = await Promise.allSettled([guardedWorker(), guardedWorker(), guardedWorker()]);
      if (results.some((result) => result.status === 'rejected')) throw new Error('Worker persistence failed');
      job.status = job.tasks.every((task) => ['done', 'skipped'].includes(task.status)) ? 'complete' : 'failed';
      job.finishedAt = iso();
      saveJob(job);
    } catch {
      job.status = 'interrupted';
      try { saveJob(job); } catch { /* A disk failure must not become an unhandled rejection. */ }
    } finally {
      try { lease.release(); } catch {
        job.status = 'interrupted';
        job.storageError = 'No se pudo liberar el bloqueo local de escritura.';
        try { saveJob(job); } catch { /* Preserve the persisted recovery state if storage is unavailable. */ }
      }
    }
    return publicJob(job);
  }
  function launch(job, lease) {
    job.leaseOwner = lease.owner;
    saveJob(job);
    const work = executeJob(job, lease).finally(() => runningJobs.delete(job.id));
    runningJobs.set(job.id, work);
    return publicJob(job);
  }
  function makeJob(kind, scope, mode, targets) {
    const contexts = [];
    const tasks = targets.map(({ context, spec }) => {
      let contextIndex = contexts.findIndex((entry) => contextKey(entry) === contextKey(context));
      if (contextIndex < 0) { contextIndex = contexts.length; contexts.push(context); }
      return { contextIndex, spec, status: 'pending' };
    });
    return { id: randomUUID(), kind, scope, mode, status: 'running', contexts, tasks,
      ...(contexts.length === 1 ? { context: contexts[0] } : {}),
      completed: 0, total: tasks.length, fetched: 0, skipped: 0, rebuilt: 0, errors: [], apiQueries: 0, startedAt: iso() };
  }
  async function startSync(input = {}) {
    const { scope, mode, targets } = targetsFor(input);
    const lease = db.acquireLease({ label: 'sync' });
    try { return launch(makeJob('sync', scope, mode, targets), lease); }
    catch (error) { lease.release(); throw error; }
  }
  async function resumeSync(id) {
    const lease = db.acquireLease({ label: 'resume' });
    try {
      const job = state().jobs.find((entry) => entry.id === id);
      if (!job) throw new WarcraftLogsError('Sincronización no encontrada.', 'JOB_NOT_FOUND', 404);
      if (job.status === 'complete') { lease.release(); return publicJob(job); }
      job.tasks.forEach((task) => { if (!['done', 'skipped'].includes(task.status)) task.status = 'pending'; });
      job.status = 'running'; job.resumedAt = iso(); delete job.finishedAt;
      return launch(job, lease);
    } catch (error) { lease.release(); throw error; }
  }
  async function rebuild() {
    const lease = db.acquireLease({ label: 'rebuild' });
    try {
      const targets = scanManifest().snapshots.map((entry) => ({ context: entry.context, spec: entry.spec }));
      return launch(makeJob('rebuild', 'cached', 'offline', targets), lease);
    } catch (error) { lease.release(); throw error; }
  }
  async function waitForJob(id) {
    if (runningJobs.has(id)) return runningJobs.get(id);
    return getJob(id);
  }
  return { getCatalog, refreshCatalog, getPopularity, getItems, getItemPopularity, getCacheStatus,
    getSyncPlan, startSync, getJob, resumeSync, rebuild, waitForJob };
}

export const warcraftLogsService = createWarcraftLogsService();
