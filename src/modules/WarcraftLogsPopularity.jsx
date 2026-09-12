import { useEffect, useMemo, useState } from 'react';
import ClassSpecIcon from '../components/ClassSpecIcon.jsx';
import ItemIcon from '../components/ItemIcon.jsx';
import SpecGuideMenu from '../components/SpecGuideMenu.jsx';
import { dataFetch } from '../data-client.js';
import { useI18n } from '../i18n.jsx';
import { localizedItemName } from '../item-localization.js';
import { itemOriginLocation, resolveItemOrigin } from '../item-origin.js';
import { ITEM_SEASON_FILTERS, filterItemsBySeason, itemSeasonStatus, normalizeItemSeasonFilter, selectVisibleSeasonItem } from '../item-season-filter.js';
import { usePersistentState } from '../use-persistent-state.js';
import './warcraftlogs-popularity.css';

async function fetchJson(url, options) {
  const response = await dataFetch(url, options);
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error || `HTTP ${response.status}`);
    error.code = payload.code;
    throw error;
  }
  return payload;
}

const sameId = (left, right) => left != null && right != null && String(left) === String(right);
const choose = (entries = [], preferred, fallback) => entries.find((entry) => sameId(entry.id, preferred))
  || entries.find((entry) => sameId(entry.id, fallback)) || entries.find((entry) => entry.default) || entries[0];

function Popularity({ entry, language, t }) {
  const popularity = Number(entry.popularity) || 0;
  return <div className="wcl-popularity">
    <div><strong>{popularity.toLocaleString(language, { maximumFractionDigits: 1 })}%</strong><span>{entry.count} / {entry.validCharacters}</span></div>
    <div className="wcl-popularity-track" role="meter" aria-label={t('wcl.popularity')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={popularity}><i style={{ width: `${Math.max(0, Math.min(100, popularity))}%` }} /></div>
  </div>;
}

function ItemSeasonBadge({ item, currentSeason, t }) {
  const status = itemSeasonStatus(item);
  const label = status === 'unknown' ? t('wcl.season.unknown')
    : t(`wcl.seasonBadge.${status}`, { season: item.seasonClassification?.label || (status === 'current' ? currentSeason?.label : '') || t(`wcl.season.${status}`) });
  return <span className={`wcl-season-badge wcl-season-${status}`}>{label}</span>;
}

function SpecRankingLink({ url, spec, context, t }) {
  if (!url) return null;
  const description = [spec.specName, spec.className, context?.encounterName, context?.difficultyName, context?.partitionName].filter(Boolean).join(' · ');
  return <a className="wcl-source-link" href={url} target="_blank" rel="noopener noreferrer"
    aria-label={`${t('wcl.source')}: ${description}`} title={description}>{t('wcl.source')}</a>;
}

const ORIGIN_LABELS = {
  raid: 'common.raid', dungeon: 'common.mythicPlus', delves: 'common.delves',
  lair: 'common.lair', world: 'common.world', crafting: 'common.crafting',
  pvp: 'common.pvp', unknown: 'wcl.originUnknown',
};

function ItemAcquisition({ item, currentSeason, t, detailed = false }) {
  const origin = resolveItemOrigin(item);
  const location = itemOriginLocation(item, { detailed });
  return <span className="wcl-item-acquisition">
    <span className="wcl-item-badges"><span className={`wcl-origin-badge wcl-origin-${origin}`}>{t(ORIGIN_LABELS[origin])}</span><ItemSeasonBadge item={item} currentSeason={currentSeason} t={t} /></span>
    {location && <span className="wcl-origin-location">{location}</span>}
  </span>;
}

export default function WarcraftLogsPopularity({ active }) {
  const { language, t } = useI18n();
  const [catalog, setCatalog] = useState(null);
  const [catalogError, setCatalogError] = useState('');
  const [retry, setRetry] = useState(0);
  const [selection, setSelection] = usePersistentState('loot-wcl-context', {});
  const [classId, setClassId] = usePersistentState('loot-wcl-class', 'hunter');
  const [specId, setSpecId] = usePersistentState('loot-wcl-spec', 'beast-mastery');
  const [mode, setMode] = usePersistentState('loot-wcl-mode', 'spec');
  const [itemId, setItemId] = usePersistentState('loot-wcl-item', null);
  const [search, setSearch] = usePersistentState('loot-wcl-search', '');
  const [savedItemSeason, setItemSeason] = usePersistentState('loot-wcl-item-season', 'current');
  const itemSeason = normalizeItemSeasonFilter(savedItemSeason);
  const [snapshots, setSnapshots] = useState({});
  const [itemCatalog, setItemCatalog] = useState(null);
  const [itemResult, setItemResult] = useState(null);
  const [requestError, setRequestError] = useState(null);
  const [loadingKey, setLoadingKey] = useState('');
  const [revision, setRevision] = useState(0);
  const [job, setJob] = useState(null);
  const [startingSync, setStartingSync] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [cache, setCache] = useState(null);
  const [cacheError, setCacheError] = useState('');
  const [syncScope, setSyncScope] = usePersistentState('loot-wcl-sync-scope', 'context');
  const [forceUpdate, setForceUpdate] = useState(false);
  const [planResult, setPlanResult] = useState(null);
  const [planError, setPlanError] = useState('');
  const [pollRevision, setPollRevision] = useState(0);

  useEffect(() => {
    if (!active) return undefined;
    const controller = new AbortController();
    setCatalogError('');
    fetchJson('/api/warcraftlogs/catalog', { signal: controller.signal }).then(setCatalog)
      .catch((error) => { if (!controller.signal.aborted) setCatalogError(error.message); });
    return () => controller.abort();
  }, [active, retry, revision]);

  useEffect(() => {
    if (!active) return undefined;
    const controller = new AbortController();
    setCacheError('');
    fetchJson('/api/warcraftlogs/cache', { signal: controller.signal }).then((payload) => {
      setCache(payload);
      setJob(payload.activeJob || payload.lastJob || null);
    }).catch((error) => { if (!controller.signal.aborted) setCacheError(error.message); });
    return () => controller.abort();
  }, [active, retry, revision]);

  const zone = choose(catalog?.zones, selection?.zoneId, catalog?.defaultContext?.zoneId);
  const useDefaults = sameId(zone?.id, catalog?.defaultContext?.zoneId);
  const encounter = choose(zone?.encounters, selection?.encounterId, useDefaults ? catalog?.defaultContext?.encounterId : undefined);
  const defaultDifficulty = useDefaults ? catalog?.defaultContext?.difficulty
    : zone?.difficulties?.find((entry) => entry.name?.toLowerCase() === 'mythic')?.id;
  const difficulty = choose(zone?.difficulties, selection?.difficulty, defaultDifficulty);
  const partition = choose(zone?.partitions, selection?.partition, useDefaults ? catalog?.defaultContext?.partition : undefined);
  const contextQuery = useMemo(() => {
    if (!zone || !encounter) return '';
    return new URLSearchParams({ zoneId: zone.id, encounterId: encounter.id, difficulty: difficulty?.id ?? 0, partition: partition?.id ?? 0 }).toString();
  }, [zone?.id, encounter?.id, difficulty?.id, partition?.id]);
  const selectedClass = choose(catalog?.classes, classId);
  const selectedSpec = choose(selectedClass?.specs, specId);
  const specKey = contextQuery && selectedClass && selectedSpec ? `${contextQuery}&classId=${selectedClass.id}&specId=${selectedSpec.id}` : '';
  const result = snapshots[specKey];
  const cachedCatalog = itemCatalog?.key === contextQuery ? itemCatalog.data : null;
  const seasonItems = useMemo(() => filterItemsBySeason(cachedCatalog?.items, itemSeason), [cachedCatalog, itemSeason]);
  const specSeasonItems = useMemo(() => filterItemsBySeason(result?.items, itemSeason), [result, itemSeason]);
  const selectedItem = selectVisibleSeasonItem(seasonItems, itemId);
  const itemKey = selectedItem ? `${contextQuery}&itemId=${selectedItem.itemId}` : '';
  const comparison = itemResult?.key === itemKey ? itemResult.data : null;
  const canQuery = active && Boolean(contextQuery);
  const effectiveScope = mode === 'item' && syncScope === 'spec' ? 'context' : syncScope;
  const syncQuery = useMemo(() => {
    if (!contextQuery && ['spec', 'context', 'zone'].includes(effectiveScope)) return '';
    const query = new URLSearchParams(contextQuery);
    query.set('scope', effectiveScope);
    query.set('mode', forceUpdate ? 'force' : 'stale');
    if (effectiveScope === 'spec') {
      if (!selectedClass || !selectedSpec) return '';
      query.set('classId', selectedClass.id);
      query.set('specId', selectedSpec.id);
    }
    return query.toString();
  }, [contextQuery, effectiveScope, forceUpdate, selectedClass?.id, selectedSpec?.id]);
  const plan = planResult?.key === syncQuery ? planResult.data : null;

  useEffect(() => {
    if (!active || !syncQuery) return undefined;
    const controller = new AbortController();
    setPlanError('');
    fetchJson(`/api/warcraftlogs/sync/plan?${syncQuery}`, { signal: controller.signal }).then((payload) => {
      setPlanResult({ key: syncQuery, data: payload });
    }).catch((error) => { if (!controller.signal.aborted) setPlanError(error.message); });
    return () => controller.abort();
  }, [active, syncQuery, retry, revision]);

  useEffect(() => {
    if (!canQuery || mode !== 'spec' || !specKey) return undefined;
    const controller = new AbortController();
    setLoadingKey(specKey);
    setRequestError(null);
    fetchJson(`/api/warcraftlogs/popularity?${specKey}`, { signal: controller.signal }).then((payload) => {
      setSnapshots((current) => ({ ...current, [specKey]: payload }));
    }).catch((error) => {
      if (!controller.signal.aborted) setRequestError({ key: specKey, message: error.message, code: error.code });
    }).finally(() => {
      if (!controller.signal.aborted) setLoadingKey('');
    });
    return () => controller.abort();
  }, [canQuery, mode, specKey, retry, revision]);

  useEffect(() => {
    if (!canQuery || mode !== 'item') return undefined;
    const controller = new AbortController();
    setLoadingKey(contextQuery);
    setRequestError(null);
    fetchJson(`/api/warcraftlogs/items?${contextQuery}`, { signal: controller.signal }).then((payload) => {
      setItemCatalog({ key: contextQuery, data: payload });
    }).catch((error) => {
      if (!controller.signal.aborted) setRequestError({ key: contextQuery, message: error.message });
    }).finally(() => {
      if (!controller.signal.aborted) setLoadingKey('');
    });
    return () => controller.abort();
  }, [canQuery, mode, contextQuery, retry, revision]);

  useEffect(() => {
    if (!canQuery || mode !== 'item' || !itemKey) return undefined;
    const controller = new AbortController();
    setRequestError(null);
    fetchJson(`/api/warcraftlogs/item?${itemKey}`, { signal: controller.signal }).then((payload) => {
      setItemResult({ key: itemKey, data: payload });
    }).catch((error) => {
      if (!controller.signal.aborted) setRequestError({ key: itemKey, message: error.message });
    });
    return () => controller.abort();
  }, [canQuery, mode, itemKey, retry, revision]);

  useEffect(() => {
    if (!active || job?.status !== 'running') return undefined;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      fetchJson(`/api/warcraftlogs/sync?id=${encodeURIComponent(job.id)}`, { signal: controller.signal }).then((next) => {
        setJob(next);
        if (next.status !== 'running') setRevision((current) => current + 1);
      }).catch((error) => {
        if (!controller.signal.aborted) {
          setSyncError(error.message);
          setPollRevision((current) => current + 1);
        }
      });
    }, 2000);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [active, job, pollRevision]);

  useEffect(() => {
    if (active) window.$WowheadPower?.refreshLinks?.();
  }, [active, result, cachedCatalog, comparison, language, itemSeason]);

  const runCacheAction = async (url, body = {}) => {
    setStartingSync(true);
    setSyncError('');
    try {
      const next = await fetchJson(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (next.id && next.status) setJob(next);
      if (next.status !== 'running') setRevision((current) => current + 1);
    } catch (error) { setSyncError(error.message); }
    finally { setStartingSync(false); }
  };

  const visibleItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return seasonItems.filter((item) => !query || `${Object.values(item.localizedNames || {}).join(' ')} ${item.name} ${item.drop?.encounter || ''} ${item.drop?.instance || ''}`.toLocaleLowerCase().includes(query));
  }, [seasonItems, language, search]);
  const syncBusy = startingSync || job?.status === 'running';
  const errorKeys = mode === 'spec' ? [specKey] : [contextQuery, itemKey];
  const error = requestError && errorKeys.includes(requestError.key) ? (requestError.code === 'CACHE_MISS' ? t('wcl.cacheMiss') : requestError.message) : '';
  const formatDate = (value) => value ? new Date(value).toLocaleString(language === 'es' ? 'es-MX' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }) : '-';
  const metricName = (metric) => metric === 'playerscore' ? t('wcl.metric.playerscore') : String(metric || '').toUpperCase();
  const updateContext = (key, value) => setSelection({ zoneId: zone?.id, encounterId: encounter?.id, difficulty: difficulty?.id, partition: partition?.id, [key]: value });
  const contextCoverage = cache?.contexts?.find((entry) => {
    const saved = entry.context || entry;
    return sameId(saved.zoneId, zone?.id) && sameId(saved.encounterId, encounter?.id)
      && sameId(saved.difficulty ?? 0, difficulty?.id ?? 0) && sameId(saved.partition ?? 0, partition?.id ?? 0);
  });
  const lastUpdatedAt = cache?.lastUpdatedAt || cache?.lastSnapshotAt || cache?.updatedAt;
  const isRebuildJob = job?.kind === 'rebuild';
  const jobStatusKey = isRebuildJob
    ? (job?.status === 'running' ? 'wcl.rebuilding' : job?.status === 'interrupted' ? 'wcl.rebuildInterrupted' : job?.status === 'failed' ? 'wcl.rebuildFailed' : 'wcl.rebuildComplete')
    : (job?.status === 'running' ? 'wcl.syncing' : job?.status === 'interrupted' ? 'wcl.syncInterrupted' : job?.status === 'failed' ? 'wcl.syncFailed' : 'wcl.syncComplete');

  return <div className="spec-module wcl-module">
    <header className="rankings-hero"><div><p className="eyebrow">{t('wcl.eyebrow')}</p><h1>{t('wcl.title')}</h1><p>{t('wcl.subtitle')}</p></div><span className="wcl-local-badge">{t('wcl.local')}</span></header>

    {catalogError && <div className="error-inline" role="alert">{catalogError} <button className="wcl-secondary" onClick={() => setRetry((current) => current + 1)}>{t('wcl.retry')}</button></div>}
    {!catalog && !catalogError && <div className="module-loading" role="status">{t('wcl.loading')}</div>}
    {catalog && !catalog.configured && <div className="wcl-notice">{t('wcl.notConfigured')}</div>}
    {catalog && !zone && <div className="wcl-notice">{t('wcl.noZones')}</div>}

    <section className="panel wcl-cache-panel">
      <div className="panel-head"><div><h2>{t('wcl.database')}</h2><p>{t('wcl.databaseNote')}</p></div><button className="wcl-secondary" onClick={() => setRevision((current) => current + 1)} disabled={startingSync}>{t('wcl.reloadLocal')}</button></div>
      <div className="wcl-cache-stats"><div><span>{t('wcl.savedSnapshots')}</span><strong>{cache?.snapshots ?? 0}</strong></div><div><span>{t('wcl.freshSnapshots')}</span><strong>{cache?.freshSnapshots ?? 0}</strong></div><div><span>{t('wcl.staleSnapshots')}</span><strong>{cache?.staleSnapshots ?? 0}</strong></div><div><span>{t('wcl.lastUpdate')}</span><strong>{formatDate(lastUpdatedAt)}</strong></div></div>
      {zone && <p className="wcl-context-coverage"><strong>{encounter?.name} · {difficulty?.name}</strong><br />{t('wcl.coverage', { available: contextCoverage?.availableSpecs ?? 0, total: contextCoverage?.totalSpecs ?? 40 })} · {t('wcl.freshCoverage', { count: contextCoverage?.freshSpecs ?? 0 })}</p>}
      <div className="wcl-cache-update">
        <label><span>{t('wcl.updateScope')}</span><select value={effectiveScope} onChange={(event) => setSyncScope(event.target.value)} disabled={syncBusy}>
          {mode === 'spec' && <option value="spec" disabled={!contextQuery}>{t('wcl.scope.spec')}</option>}
          <option value="context" disabled={!contextQuery}>{t('wcl.scope.context')}</option><option value="zone" disabled={!contextQuery}>{t('wcl.scope.zone')}</option><option value="cached">{t('wcl.scope.cached')}</option><option value="all">{t('wcl.scope.all')}</option>
        </select></label>
        <div className="wcl-update-description"><p>{t('wcl.updatePolicy', { hours: cache?.cacheHours || 1 })}</p><label className="wcl-force-option"><input type="checkbox" checked={forceUpdate} onChange={(event) => setForceUpdate(event.target.checked)} disabled={syncBusy} /><span>{t('wcl.forceUpdate')}</span></label></div>
      </div>
      <div className="wcl-plan" aria-live="polite">
        {plan ? <><p>{t('wcl.plan', { total: plan.total, fetch: plan.willFetch, fresh: plan.fresh })}</p><p>{t('wcl.planQueries', { queries: plan.minimumApiQueries })}</p>{plan.catalogRefreshRequired && <p>{t('wcl.catalogRequired')}</p>}</> : <p>{planError || t(contextQuery || syncQuery ? 'wcl.planning' : 'wcl.catalogRequired')}</p>}
      </div>
      <div className="wcl-cache-actions"><button className="primary" disabled={syncBusy || !catalog?.configured || !plan || !plan.willFetch || plan.catalogRefreshRequired} onClick={() => runCacheAction('/api/warcraftlogs/sync', Object.fromEntries(new URLSearchParams(syncQuery)))}>{startingSync ? t('wcl.starting') : t('wcl.updateDatabase')}</button><button className="wcl-secondary" disabled={syncBusy || !catalog?.configured} onClick={() => runCacheAction('/api/warcraftlogs/catalog/refresh')}>{t('wcl.updateCatalog')}</button></div>
      {job && <div className="wcl-job" role="status"><p>{t(jobStatusKey, { completed: job.completed || 0, total: job.total || 0 })}</p><progress value={job.completed || 0} max={job.total || 1} /><p>{t(isRebuildJob ? 'wcl.rebuildSummary' : 'wcl.jobSummary', { rebuilt: job.rebuilt || 0, fetched: job.fetched || 0, skipped: job.skipped || 0, queries: job.apiQueries || 0 })}</p>{job.errors?.length > 0 && <p>{t('wcl.syncErrors', { count: job.errors.length })}</p>}{job.resumable && <button className="wcl-secondary" disabled={syncBusy || (!isRebuildJob && !catalog?.configured)} onClick={() => runCacheAction(`/api/warcraftlogs/sync/${encodeURIComponent(job.id)}/resume`)}>{t('wcl.resume')}</button>}</div>}
      {(syncError || cacheError) && <p className="error-inline" role="alert">{syncError || cacheError}</p>}
      <details className="wcl-cache-maintenance"><summary>{t('wcl.maintenance')}</summary><p>{t('wcl.rebuildNote', { count: cache?.rawSnapshots ?? 0 })}</p>{cache?.legacySnapshots > 0 && <p>{t('wcl.legacySnapshots', { count: cache.legacySnapshots })}</p>}<button className="wcl-secondary" disabled={syncBusy || !cache?.rawSnapshots} onClick={() => runCacheAction('/api/warcraftlogs/rebuild')}>{t('wcl.rebuild')}</button><p>{t('wcl.apiUsage', { queries: cache?.apiUsage?.queries ?? 0, date: formatDate(cache?.apiUsage?.lastRequestAt) })}</p></details>
    </section>

    {zone && <>
      <section className="panel wcl-context-panel">
        <div className="panel-head"><h2>{t('wcl.context')}</h2><span className="wcl-cache-label">{t('wcl.cached', { hours: catalog.cacheHours || 1 })}</span></div>
        <div className="wcl-context-fields">
          <label><span>{t('wcl.zone')}</span><select value={zone.id} onChange={(event) => setSelection({ zoneId: event.target.value })}>{catalog.zones.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
          <label><span>{t('wcl.encounter')}</span><select value={encounter?.id ?? ''} onChange={(event) => updateContext('encounterId', event.target.value)}>{(zone.encounters || []).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
          <label><span>{t('wcl.difficulty')}</span><select value={difficulty?.id ?? ''} disabled={!zone.difficulties?.length} onChange={(event) => updateContext('difficulty', event.target.value)}>{(zone.difficulties || []).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
          <label><span>{t('wcl.partition')}</span><select value={partition?.id ?? ''} disabled={!zone.partitions?.length} onChange={(event) => updateContext('partition', event.target.value)}>{(zone.partitions || []).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
        </div>
      </section>

      <div className="wcl-mode-row"><div className="segment-control" role="group" aria-label={t('rank.sourceMode')}><button className={mode === 'spec' ? 'active' : ''} aria-pressed={mode === 'spec'} onClick={() => setMode('spec')}>{t('wcl.specMode')}</button><button className={mode === 'item' ? 'active' : ''} aria-pressed={mode === 'item'} onClick={() => setMode('item')}>{t('wcl.itemMode')}</button></div><label className="wcl-season-filter"><span>{t('wcl.itemSeason')}</span><select value={itemSeason} onChange={(event) => setItemSeason(event.target.value)}>{ITEM_SEASON_FILTERS.map((value) => <option key={value} value={value}>{t(`wcl.season.${value}`)}{value === 'current' && catalog.currentItemSeason?.label ? ` (${catalog.currentItemSeason.label})` : ''}</option>)}</select></label></div>
      <p className="wcl-season-explanation">{t('wcl.seasonNote', { season: catalog.currentItemSeason?.name || catalog.currentItemSeason?.label || t('wcl.season.current') })} {t('wcl.seasonDenominator')}</p>

      {mode === 'spec' && selectedClass && selectedSpec && <section className="panel wcl-spec-selector">
        <h2>{t('wcl.selectSpec')}</h2>
        <div className="wcl-class-select"><ClassSpecIcon classId={selectedClass.id} label={selectedClass.name} /><label><span>{t('common.class')}</span><select value={selectedClass.id} onChange={(event) => { setClassId(event.target.value); setSpecId(catalog.classes.find((entry) => entry.id === event.target.value)?.specs[0]?.id || ''); }}>{catalog.classes.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label></div>
        <div className="guide-tabs">{selectedClass.specs.map((entry) => <button className={selectedSpec.id === entry.id ? 'active' : ''} key={entry.id} onClick={() => setSpecId(entry.id)} aria-pressed={selectedSpec.id === entry.id}><ClassSpecIcon kind="spec" classId={selectedClass.id} specId={entry.id} label={entry.name} /><span><b>{entry.name}</b><small>{selectedClass.name}</small></span></button>)}</div>
      </section>}

      {mode === 'item' && <section className="panel wcl-item-selector">
        <div className="panel-head"><div><h2>{t('wcl.selectItem')}</h2><p>{t('wcl.coverage', { available: cachedCatalog?.snapshots || 0, total: cachedCatalog?.totalSpecs || catalog.classes.reduce((sum, entry) => sum + entry.specs.length, 0) })}</p></div><label className="wcl-search"><span>{t('rank.search')}</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('rank.searchPlaceholder')} /></label></div>
        {cachedCatalog && <p className="wcl-season-count" role="status">{t('wcl.seasonCount', { visible: visibleItems.length, total: cachedCatalog.items.length })}</p>}
        <div className="wcl-item-picker">{visibleItems.map((item) => <article className={sameId(selectedItem?.itemId, item.itemId) ? 'active' : ''} key={item.itemId}><ItemIcon item={item} tooltip /><button onClick={() => setItemId(item.itemId)} aria-pressed={sameId(selectedItem?.itemId, item.itemId)}><span>{localizedItemName(item, language)}</span><ItemAcquisition item={item} currentSeason={catalog.currentItemSeason} t={t} /></button></article>)}</div>
        {!cachedCatalog && loadingKey === contextQuery && <p className="wcl-empty" role="status">{t('wcl.loading')}</p>}
        {cachedCatalog && !visibleItems.length && <p className="wcl-empty">{t(!cachedCatalog.items.length ? 'wcl.noItems' : !seasonItems.length ? 'wcl.noSeasonItems' : 'wcl.noMatch')}</p>}
        <div className="wcl-sync"><div><p>{t('wcl.coverageNote')}</p></div></div>
      </section>}

      {error && <div className="error-inline" role="alert">{error} <button className="wcl-secondary" onClick={() => setRetry((current) => current + 1)}>{t('wcl.retry')}</button></div>}
      {mode === 'spec' && !result && loadingKey === specKey && <div className="module-loading" role="status">{t('wcl.loadingSpec')}</div>}

      {mode === 'spec' && result && <>
        <div className="wcl-sample-summary"><div><span>{t('wcl.metric')}</span><strong>{metricName(result.metric)}</strong></div><div><span>{t('wcl.sample')}</span><strong>{result.rankingRows ?? result.sampledCharacters} / {result.targetSampleSize || 100}</strong></div><div><span>{t('wcl.validGear')}</span><strong>{result.validCharacters}</strong></div><div><span>{t('wcl.missingGear')}</span><strong>{result.missingGear}</strong></div><div><span>{t('wcl.duplicates')}</span><strong>{result.duplicateCharacters || 0}</strong></div><div><span>{t('wcl.invalidIdentity')}</span><strong>{result.invalidIdentity || 0}</strong></div></div>
        {result.stale && <div className="wcl-notice" role="status">{t('wcl.stale')}{result.error && <p>{result.error}</p>}</div>}
        {result.status === 'incomplete' && <div className="wcl-notice">{t('wcl.incomplete')}</div>}
        <section className="panel wcl-results" aria-busy={loadingKey === specKey}>
          <div className="panel-head"><div className="wcl-spec-heading"><ClassSpecIcon kind="spec" classId={result.spec.classId} specId={result.spec.specId} label={result.spec.specName} /><div><h2>{result.spec.specName} {result.spec.className}</h2><p>{result.context.encounterName} · {result.context.difficultyName}</p></div></div><SpecRankingLink url={result.sourceUrl} spec={result.spec} context={result.context} t={t} /></div>
          <p className="wcl-season-count" role="status">{t('wcl.seasonCount', { visible: specSeasonItems.length, total: result.items.length })}</p>
          <div className="wcl-table-head"><span>Trinket</span><span>{t('wcl.popularity')} · {t('wcl.players')}</span><span>{t('wcl.itemLevel')}</span></div>
          <div className="wcl-rows">{specSeasonItems.map((item) => <article key={item.itemId}><div className="wcl-item-identity"><ItemIcon item={item} tooltip /><div><b>{localizedItemName(item, language)}</b><ItemAcquisition item={item} currentSeason={catalog.currentItemSeason} t={t} /></div></div><Popularity entry={{ ...item, validCharacters: result.validCharacters }} language={language} t={t} /><span className="wcl-ilvl">{item.averageItemLevel == null ? '-' : Number(item.averageItemLevel).toLocaleString(language, { maximumFractionDigits: 1 })}</span></article>)}</div>
          {!specSeasonItems.length && <p className="wcl-empty">{t(result.items.length ? 'wcl.noSeasonItems' : 'wcl.noSample')}</p>}
          <div className="wcl-freshness"><span>{t('wcl.snapshot')}: {formatDate(result.fetchedAt)}</span><span>{t('wcl.expires')}: {formatDate(result.expiresAt)}</span></div>
        </section>
      </>}

      {mode === 'item' && selectedItem && <section className="panel wcl-results wcl-comparison">
        <div className="panel-head"><div className="wcl-item-identity"><ItemIcon item={comparison?.item || selectedItem} tooltip /><div><h2>{localizedItemName(comparison?.item || selectedItem, language)}</h2><ItemAcquisition item={comparison?.item || selectedItem} currentSeason={catalog.currentItemSeason} t={t} detailed /><p>{t('wcl.observedIn')}: {encounter?.name} · {difficulty?.name}</p></div></div><span className="wcl-cache-label">{t('wcl.coverage', { available: comparison?.coverage?.availableSpecs ?? cachedCatalog?.snapshots ?? 0, total: comparison?.coverage?.totalSpecs ?? cachedCatalog?.totalSpecs ?? 40 })}</span></div>
        <div className="wcl-table-head"><span>{t('rank.specialization')}</span><span>{t('wcl.popularity')} · {t('wcl.players')}</span><span>{t('wcl.metric')}</span></div>
        <div className="wcl-rows">{comparison?.rankings.map((entry) => <article key={`${entry.classId}-${entry.specId}`}><div className="wcl-item-identity"><ClassSpecIcon classId={entry.classId} label={entry.className} /><SpecGuideMenu classId={entry.classId} specId={entry.specId} role={entry.role} label={entry.specName} /><div><b>{entry.specName}</b><small>{entry.className}</small><SpecRankingLink url={entry.sourceUrl} spec={entry} context={comparison.context} t={t} />{entry.stale && <small className="wcl-stale-label">{t('wcl.stale')}</small>}</div></div><Popularity entry={entry} language={language} t={t} /><span className="wcl-metric">{metricName(entry.metric)}</span></article>)}</div>
        {!comparison && !error && <p className="wcl-empty" role="status">{t('wcl.loading')}</p>}
        {comparison && !comparison.rankings.length && <p className="wcl-empty">{t('wcl.noRankings')}</p>}
      </section>}

      <section className="wcl-method"><h2>{t('wcl.methodTitle')}</h2><p>{t('wcl.method')}</p><p>{t('wcl.interpretation')}</p></section>
    </>}
  </div>;
}
