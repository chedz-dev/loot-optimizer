import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalItemOrigins } from './item-origins.js';

export const SNAPSHOT_TTL_MS = 60 * 60 * 1000;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultStorePath = process.env.EDITORIAL_DATA_PATH || path.join(root, 'data', 'editorial-data.json');
let defaultStore;

const emptyData = () => ({
  schemaVersion: 1,
  generatedAt: new Date(0).toISOString(),
  cacheHours: 1,
  snapshotSequence: 0,
  sources: [],
  items: [],
  guides: { wowhead: [], icyveins: [] },
  signals: [],
  batches: [],
});

const clone = (value) => structuredClone(value);

export function createEditorialStore(initialData = emptyData()) {
  return { filename: null, data: clone(initialData) };
}

export function openEditorialStore(filename = defaultStorePath) {
  if (filename === ':memory:') return createEditorialStore();
  const data = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : emptyData();
  return { filename, data };
}

export function getEditorialStore() {
  if (!defaultStore) defaultStore = openEditorialStore();
  return defaultStore;
}

function persist(store) {
  store.data.generatedAt = new Date().toISOString();
  if (!store.filename) return;
  fs.mkdirSync(path.dirname(store.filename), { recursive: true });
  const temporaryPath = `${store.filename}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(store.data, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, store.filename);
}

function sourceGuides(store, source) {
  if (!store.data.guides[source]) store.data.guides[source] = [];
  return store.data.guides[source];
}

function canonicalItemMap(store) {
  return new Map(store.data.items.map((item) => [item.itemId, item]));
}

function resolveGuide(store, guide) {
  if (!guide) return null;
  const items = canonicalItemMap(store);
  const resolved = clone(guide);
  resolved.cacheExpiresAt = new Date(Date.parse(resolved.fetchedAt) + SNAPSHOT_TTL_MS).toISOString();
  resolved.tiers = resolved.tiers.map((tier) => ({
    ...tier,
    items: tier.items.map((item) => {
      const canonical = items.get(item.itemId);
      const signalContentTypes = item.signalContentTypes || [];
      const originTypes = canonicalItemOrigins.get(item.itemId) || canonical?.originTypes || item.originTypes || [];
      return {
        ...item,
        name: canonical?.name || item.name,
        localizedNames: canonical?.localizedNames || item.localizedNames || { en: canonical?.name || item.name },
        icon: canonical?.icon || item.icon || '',
        wowheadUrl: canonical?.wowheadUrl || item.wowheadUrl || `https://www.wowhead.com/item=${item.itemId}`,
        signalContentTypes,
        originTypes,
        contentTypes: originTypes.length ? originTypes : signalContentTypes,
      };
    }),
  }));
  return resolved;
}

export function hasFreshSnapshot(source, guideId, now = Date.now(), ttlMs = SNAPSHOT_TTL_MS, store = getEditorialStore()) {
  const guide = sourceGuides(store, source).find((entry) => entry.id === guideId);
  return Boolean(guide && Date.parse(guide.fetchedAt) + ttlMs > now);
}

function applyGuideSnapshot(source, guide, store) {
  store.data.snapshotSequence += 1;
  const snapshotId = store.data.snapshotSequence;
  const snapshotKey = `guide:${snapshotId}`;
  const items = canonicalItemMap(store);
  const storedGuide = clone({ ...guide, snapshotId });

  storedGuide.tiers = storedGuide.tiers.map((tier, tierIndex) => ({
    ...tier,
    items: tier.items.map((item) => {
      const signalContentTypes = item.signalContentTypes
        || (source === 'wowhead' ? item.contentTypes || [] : []);
      const existing = items.get(item.itemId);
      const inferredOrigins = signalContentTypes.filter((type) => type && type !== 'unknown');
      const originTypes = canonicalItemOrigins.get(item.itemId)
        || [...new Set([...(existing?.originTypes || []), ...inferredOrigins])].sort();
      const canonical = {
        itemId: item.itemId,
        name: item.name || existing?.name || `Item ${item.itemId}`,
        localizedNames: {
          ...(existing?.localizedNames || {}),
          en: item.localizedNames?.en || item.name || existing?.localizedNames?.en || existing?.name || `Item ${item.itemId}`,
          ...(item.localizedNames?.es ? { es: item.localizedNames.es } : {}),
        },
        icon: item.icon || existing?.icon || '',
        quality: item.quality || existing?.quality || 0,
        wowheadUrl: item.wowheadUrl || existing?.wowheadUrl || `https://www.wowhead.com/item=${item.itemId}`,
        lastSeenAt: guide.fetchedAt,
        originTypes,
      };
      items.set(item.itemId, canonical);
      return {
        ...item,
        signalContentTypes,
        originTypes,
        contentTypes: originTypes.length ? originTypes : signalContentTypes,
        tier: tier.label,
        displayOrder: item.displayOrder || 1,
        tierOrder: tierIndex + 1,
      };
    }),
  }));

  store.data.items = [...items.values()].sort((left, right) => left.itemId - right.itemId);
  const guides = sourceGuides(store, source);
  const existingGuideIndex = guides.findIndex((entry) => entry.id === guide.id);
  if (existingGuideIndex >= 0) guides[existingGuideIndex] = storedGuide;
  else guides.push(storedGuide);

  store.data.signals = store.data.signals.filter((signal) => !(
    signal.source === source && signal.classId === guide.classId && signal.specId === guide.specId
  ));
  storedGuide.tiers.forEach((tier, tierIndex) => tier.items.forEach((item) => {
    const signalContexts = item.signalContentTypes.length ? item.signalContentTypes : ['all'];
    signalContexts.forEach((contentType) => store.data.signals.push({
      source,
      snapshotKey,
      itemId: item.itemId,
      classId: guide.classId,
      specId: guide.specId,
      contentType,
      signalType: 'editorial-tier',
      textValue: tier.label,
      numericValue: null,
      sampleSize: null,
      confidence: null,
      entryKey: `${tierIndex + 1}:${item.displayOrder}`,
      metadata: { tierOrder: tierIndex + 1, displayOrder: item.displayOrder, guideNote: item.guideNote || '' },
      fetchedAt: guide.fetchedAt,
    }));
  }));
  store.data.batches = (store.data.batches || []).filter((batch) => !(
    batch.source === source && batch.classId === guide.classId && batch.specId === guide.specId
  ));
  store.data.batches.push({
    source,
    snapshotKey,
    classId: guide.classId,
    specId: guide.specId,
    contentType: 'all',
    fetchedAt: guide.fetchedAt,
    isComplete: true,
    metadata: { guideId: guide.id, url: guide.url, itemCount: guide.itemCount, tierCount: guide.tierCount },
  });
  if (!store.data.sources.some((entry) => entry.id === source)) {
    store.data.sources.push({ id: source, name: source === 'icyveins' ? 'Icy Veins' : 'Wowhead', kind: 'editorial-guide' });
  }
  return snapshotId;
}

export function saveGuideSnapshot(source, guide, store = getEditorialStore()) {
  const snapshotId = applyGuideSnapshot(source, guide, store);
  persist(store);
  return snapshotId;
}

export function saveGuideSnapshots(source, guides, store = getEditorialStore()) {
  const saved = guides.map((guide) => ({ guideId: guide.id, snapshotId: applyGuideSnapshot(source, guide, store), itemCount: guide.itemCount }));
  if (saved.length) persist(store);
  return saved;
}

export function loadLatestGuide(source, guideId, store = getEditorialStore()) {
  return resolveGuide(store, sourceGuides(store, source).find((entry) => entry.id === guideId));
}

export function loadLatestGuides(source, guideIds, store = getEditorialStore()) {
  return guideIds.map((guideId) => loadLatestGuide(source, guideId, store)).filter(Boolean);
}

export function saveRankingSignals({ sourceId, sourceName, sourceKind, snapshotKey, fetchedAt, signals, scopes = [], isComplete = true, batchMetadata = {} }, store = getEditorialStore()) {
  if (!sourceId || !snapshotKey || !fetchedAt || !Array.isArray(signals)) throw new Error('Lote de señales incompleto');
  const scopeMap = new Map();
  scopes.forEach((scope) => scope.classId && scope.specId && scopeMap.set(`${scope.classId}:${scope.specId}`, scope));
  signals.forEach((signal) => signal.classId && signal.specId && scopeMap.set(`${signal.classId}:${signal.specId}`, signal));
  store.data.signals = store.data.signals.filter((signal) => !(
    signal.source === sourceId && scopeMap.has(`${signal.classId}:${signal.specId}`)
  ));
  signals.forEach((signal, index) => {
    if (!signal.itemId || !signal.classId || !signal.specId || !signal.signalType) throw new Error(`Señal ${index} incompleta`);
    if (signal.textValue == null && !Number.isFinite(signal.numericValue)) throw new Error(`Señal ${index} no tiene valor textual ni numérico`);
    store.data.signals.push({
      source: sourceId,
      snapshotKey,
      itemId: signal.itemId,
      classId: signal.classId,
      specId: signal.specId,
      contentType: signal.contentType || 'all',
      signalType: signal.signalType,
      textValue: signal.textValue || '',
      numericValue: Number.isFinite(signal.numericValue) ? signal.numericValue : null,
      sampleSize: Number.isInteger(signal.sampleSize) ? signal.sampleSize : null,
      confidence: Number.isFinite(signal.confidence) ? signal.confidence : null,
      entryKey: signal.entryKey || 'aggregate',
      metadata: signal.metadata || {},
      fetchedAt,
    });
  });
  store.data.batches = (store.data.batches || []).filter((batch) => !(
    batch.source === sourceId && scopeMap.has(`${batch.classId}:${batch.specId}`)
  ));
  scopeMap.forEach((scope) => store.data.batches.push({
    source: sourceId,
    snapshotKey,
    classId: scope.classId,
    specId: scope.specId,
    contentType: scope.batchContentType || 'all',
    fetchedAt,
    isComplete,
    metadata: batchMetadata,
  }));
  const sourceIndex = store.data.sources.findIndex((entry) => entry.id === sourceId);
  const source = { id: sourceId, name: sourceName || sourceId, kind: sourceKind || 'empirical' };
  if (sourceIndex >= 0) store.data.sources[sourceIndex] = source;
  else store.data.sources.push(source);
  persist(store);
}

export function getRankingSignalsForItem(itemId, store = getEditorialStore()) {
  return clone(store.data.signals.filter((signal) => signal.itemId === Number(itemId)));
}

export function getCanonicalItem(itemId, store = getEditorialStore()) {
  const item = store.data.items.find((entry) => entry.itemId === Number(itemId));
  if (!item) return null;
  return clone({ ...item, originTypes: canonicalItemOrigins.get(item.itemId) || item.originTypes || [] });
}

export function getEditorialSignalsForItem(itemId, store = getEditorialStore()) {
  const signals = getRankingSignalsForItem(itemId, store)
    .filter((signal) => signal.signalType === 'editorial-tier')
    .map((signal) => ({
      source: signal.source,
      class_id: signal.classId,
      spec_id: signal.specId,
      tier: signal.textValue,
      content_type: signal.contentType,
      fetched_at: signal.fetchedAt,
    }));
  const uniqueGuides = new Map();
  signals.forEach((signal) => {
    const key = `${signal.source}:${signal.class_id}:${signal.spec_id}`;
    if (!uniqueGuides.has(key)) uniqueGuides.set(key, signal);
  });
  return [...uniqueGuides.values()];
}

export function getEditorialDataStatus(store = getEditorialStore()) {
  const guides = Object.values(store.data.guides).flat();
  const latest = guides.reduce((value, guide) => !value || guide.fetchedAt > value ? guide.fetchedAt : value, null);
  return {
    path: path.relative(root, store.filename || defaultStorePath).replaceAll('\\', '/'),
    schemaVersion: store.data.schemaVersion,
    snapshots: guides.length,
    items: store.data.items.length,
    origins: store.data.items.filter((item) => item.originTypes?.length).length,
    normalizedSignals: store.data.signals.length,
    latestSnapshotAt: latest,
    cacheHours: store.data.cacheHours,
    coverage: Object.entries(store.data.guides).map(([source, entries]) => ({
      source,
      guides: entries.length,
      latest_fetched_at: entries.reduce((value, guide) => !value || guide.fetchedAt > value ? guide.fetchedAt : value, null),
    })).sort((left, right) => left.source.localeCompare(right.source)),
  };
}
