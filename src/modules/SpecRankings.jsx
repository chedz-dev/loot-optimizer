import { useEffect, useMemo, useState } from 'react';
import ItemIcon, { WowheadLink } from '../components/ItemIcon.jsx';
import ClassSpecIcon from '../components/ClassSpecIcon.jsx';
import SpecGuideMenu from '../components/SpecGuideMenu.jsx';
import { dataFetch } from '../data-client.js';
import { useI18n } from '../i18n.jsx';
import { localizedItemName } from '../item-localization.js';
import { usePersistentState } from '../use-persistent-state.js';
import { sourceRankings, tierClassName, visibleTiers } from '../ranking-source-view.js';
import './ranking-evidence.css';
import { showTechnicalMetadata } from '../build-mode.js';

const sourceAbbreviations = { wowhead: 'WH', icyveins: 'IV', warcraftlogs: 'WCL', bloodmallet: 'BM' };

const sourceEvidence = (entry) => Object.values(entry.sourceScores || {}).map((source) => (
  `${sourceAbbreviations[source.source] || source.name} ${source.status === 'observed' ? source.rawValue : source.status === 'unranked' ? 'NR' : '?'}`
)).join(' · ');

const evidenceCoverage = (entry) => entry.evidenceCoverage ?? entry.confidence ?? 0;
const sourceStatusKey = (status) => ({ ambiguous: 'rank.ambiguous', supporting: 'rank.supporting', 'context-required': 'rank.contextRequired' }[status] || 'rank.unranked');

function RankingEvidence({ entry, unified, selectedSource }) {
  const { t } = useI18n();
  if (!showTechnicalMetadata) return null;
  const sources = Object.values(entry.sourceScores || {}).filter((source) => unified || source.source === selectedSource?.id);
  const observed = sources.filter((source) => source.status === 'observed');
  const disagreements = entry.diagnostics?.agreement?.status === 'disagreement'
    || (!entry.diagnostics?.agreement && new Set(observed.map((source) => source.rawValue)).size > 1);
  const ambiguous = sources.some((source) => source.status === 'ambiguous');
  return <details className="ranking-evidence-details">
    <summary>{t('rank.evidence')}</summary>
    {unified && <p>{t('rank.evidenceCoverage', { value: evidenceCoverage(entry) })}</p>}
    {unified && disagreements && <p className="ranking-evidence-warning">{t('rank.sourceConflict')}</p>}
    {unified && evidenceCoverage(entry) < 100 && <p className="ranking-evidence-warning">{t('rank.limitedCoverage')}</p>}
    {ambiguous && <p className="ranking-evidence-warning">{t('rank.ambiguousExcluded')}</p>}
    {sources.map((source) => <div className="ranking-evidence-source" key={source.source}>
      <b>{source.name || source.source}</b>
      <span>{source.status === 'observed' ? source.rawValue : t(sourceStatusKey(source.status))}</span>
      {source.status === 'ambiguous' && source.rawValues?.length > 0 && <span>{source.rawValues.join(' / ')}</span>}
      {unified && <span>{t('rank.effectiveWeight')}: {Math.round((source.effectiveWeight ?? (source.status === 'observed' ? source.weight : 0) ?? 0) * 100)}%</span>}
      {unified && <small>{t('rank.configuredWeight')}: {Math.round((source.configuredWeight ?? source.weight ?? 0) * 100)}%</small>}
    </div>)}
  </details>;
}

export default function SpecRankings() {
  const { language, t } = useI18n();
  const [items, setItems] = useState([]);
  const [itemId, setItemId] = usePersistentState('loot-rankings-item', 'gebbo');
  const [content, setContent] = usePersistentState('loot-rankings-content', 'all');
  const [search, setSearch] = usePersistentState('loot-rankings-search', '');
  const [role, setRole] = usePersistentState('loot-rankings-role', 'all');
  const [rankingView, setRankingView] = usePersistentState('loot-rankings-view', 'tierlist');
  const [rankingSource, setRankingSource] = usePersistentState('loot-rankings-source', 'unified');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    dataFetch('/api/rankings/catalog').then((response) => response.json()).then((payload) => setItems(payload.items));
  }, []);

  useEffect(() => {
    setLoading(true);
    setError('');
    const selectedItem = items.find((item) => item.id === itemId);
    const rankingContent = selectedItem?.category === 'mythic-plus' ? 'mythic-plus' : 'raid';
    const params = new URLSearchParams({ item: itemId, content: rankingContent });
    dataFetch(`/api/rankings/item?${params}`).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setResult(payload);
    }).catch((err) => setError(err.message)).finally(() => setLoading(false));
  }, [itemId, items]);

  useEffect(() => {
    window.$WowheadPower?.refreshLinks?.();
  }, [result]);

  const visibleItems = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return items.filter((item) => {
      const matchesSource = content === 'all' || item.category === content;
      const matchesSearch = !normalizedSearch || `${localizedItemName(item, language)} ${item.name} ${item.drop.encounter} ${item.drop.instance}`.toLocaleLowerCase().includes(normalizedSearch);
      return matchesSource && matchesSearch;
    });
  }, [content, items, language, search]);

  const availableRankings = useMemo(() => result ? sourceRankings(result.rankings, rankingSource) : [], [result, rankingSource]);
  const visibleRankings = useMemo(() => {
    const rankings = availableRankings;
    if (role === 'all') return rankings;
    if (role === 'dps') return rankings.filter((entry) => ['dps', 'support'].includes(entry.role));
    return rankings.filter((entry) => entry.role === role);
  }, [availableRankings, role]);

  const tiers = useMemo(() => visibleTiers(visibleRankings, rankingSource), [visibleRankings, rankingSource]);
  const isUnified = rankingSource === 'unified';
  const selectedSource = result?.metadata.sources.find((source) => source.id === rankingSource);
  const ambiguityCounts = useMemo(() => {
    const evidence = result?.metadata.ambiguousEvidence || [];
    return (result?.metadata.sources || []).flatMap((source) => {
      if (rankingSource !== 'unified' && rankingSource !== source.id) return [];
      const affected = new Set(evidence.filter((entry) => entry.source === source.id).map((entry) => `${entry.classId}-${entry.specId}`));
      return affected.size ? [{ source: source.name, count: affected.size }] : [];
    });
  }, [result, rankingSource]);

  const tierCounts = useMemo(() => visibleRankings.reduce((counts, entry) => ({ ...counts, [entry.tier]: (counts[entry.tier] || 0) + 1 }), {}), [visibleRankings]);

  return (
    <div className="spec-module">
      <header className="rankings-hero">
        <div><p className="eyebrow">{t('rank.eyebrow')}</p><h1>{t('rank.title')}</h1><p>{t('rank.subtitle')}</p></div>
      </header>

      <section className="panel item-selector-panel">
        <div className="selector-title"><div><h2>{t('rank.select')} <span>{visibleItems.length} / {items.length}</span></h2></div><div className="selector-tools"><label className="item-search"><span>{t('rank.search')}</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('rank.searchPlaceholder')} /></label><div className="segment-control"><button className={content === 'all' ? 'active' : ''} onClick={() => setContent('all')}>{t('common.all')}</button><button className={content === 'raid' ? 'active' : ''} onClick={() => setContent('raid')}>{t('common.raid')}</button><button className={content === 'mythic-plus' ? 'active' : ''} onClick={() => setContent('mythic-plus')}>{t('common.mythicPlus')}</button></div></div></div>
        <div className="item-picker">
          {visibleItems.map((item) => (
            <button key={item.id} className={itemId === item.id ? 'active' : ''} onClick={() => setItemId(item.id)}>
              <ItemIcon item={item} />
              <span><span className={`source-badge source-${item.drop.sourceType === 'Lair' ? 'lair' : item.category}`}>{item.drop.sourceType === 'Lair' ? 'LAIR' : item.category === 'raid' ? 'RAID' : 'M+'}</span><b>{localizedItemName(item, language)}</b><small>{item.drop.encounter} · {item.drop.instance}</small></span>
              <i />
            </button>
          ))}
          {!visibleItems.length && <p className="empty-items">{t('rank.emptyItems')}</p>}
        </div>
      </section>

      {error && <div className="error-inline">{error}</div>}
      {loading || !result ? <div className="module-loading">{t('rank.loading')}</div> : (
        <>
          <section className="item-ranking-summary">
            <div className="panel selected-item-summary"><div className="selected-tooltip"><ItemIcon item={result.item} tooltip /><span>{t('rank.hover')}</span></div><div><small>{t('common.selectedItem')}</small><h2>{localizedItemName(result.item, language)}</h2><p><b>{result.item.drop.encounter}</b> · {result.item.drop.instance} · {result.item.drop.sourceType}</p><WowheadLink item={result.item} /></div><div className="evidence-chips" aria-label={t('common.source')}>{isUnified ? result.metadata.sources.map((source) => <span key={source.id}>{source.name}{showTechnicalMetadata && <> · {t('rank.configuredWeight')} {Math.round(source.weight * 100)}%</>}</span>) : <span>{selectedSource?.name}</span>}</div></div>
            <div className="panel tier-summary"><small>{t('rank.distribution')}</small>{tiers.map((tier) => <span key={tier} className={`tier-count tier-${tierClassName(tier)}`}><b>{tier}</b>{tierCounts[tier] || 0}</span>)}</div>
          </section>

          {showTechnicalMetadata && <section className="panel engine-summary">
            <div><small>{t('rank.activeSources')}</small><b>{isUnified ? result.metadata.sources.map((source) => `${source.name} ${Math.round(source.weight * 100)}%`).join(' · ') : selectedSource?.name}</b></div>
            <div><small>{t('rank.weightedEvidence')}</small><b title={t('rank.weightPolicy')}>{isUnified ? t('rank.observedOnly') : t('rank.originalTier')}</b></div>
            <div><small>{t('common.coverage')}</small><b>{isUnified ? t('rank.coverageMeaning') : t('rank.sourceCoverage', { source: selectedSource?.name })}</b></div>
            <div><small>{t('rank.eligibility')}</small><b>{t('rank.shown', { visible: visibleRankings.length, available: availableRankings.length })}</b></div>
          </section>}

          {ambiguityCounts.length > 0 && <div className="ranking-ambiguity-notice" role="status">{ambiguityCounts.map((entry) => <p key={entry.source}>{t('rank.ambiguityNotice', entry)}</p>)}</div>}

          <section className={`panel spec-ranking-table item-to-spec-table ${rankingView === 'tierlist' ? 'tierlist-mode' : ''}`}>
            <div className="panel-head ranking-table-title"><div><h2>{t('rank.tableTitle')}</h2><small>{t('rank.sourceMode')}</small><div className="segment-control ranking-source-filter"><button className={rankingSource === 'unified' ? 'active' : ''} onClick={() => setRankingSource('unified')}>{t('rank.unified')}</button><button className={rankingSource === 'wowhead' ? 'active' : ''} onClick={() => setRankingSource('wowhead')}>Wowhead</button><button className={rankingSource === 'icyveins' ? 'active' : ''} onClick={() => setRankingSource('icyveins')}>Icy Veins</button></div></div><div className="ranking-view-controls"><div className="segment-control view-filter"><button className={rankingView === 'list' ? 'active' : ''} onClick={() => setRankingView('list')}>{t('common.list')}</button><button className={rankingView === 'tierlist' ? 'active' : ''} onClick={() => setRankingView('tierlist')}>{t('common.tierList')}</button></div><div className="segment-control role-filter"><button className={role === 'all' ? 'active' : ''} onClick={() => setRole('all')}>{t('common.all')}</button><button className={role === 'dps' ? 'active' : ''} onClick={() => setRole('dps')}>DPS</button><button className={role === 'healer' ? 'active' : ''} onClick={() => setRole('healer')}>{t('common.healers')}</button><button className={role === 'tank' ? 'active' : ''} onClick={() => setRole('tank')}>{t('common.tanks')}</button></div></div></div>
            {rankingView === 'list' ? <>
              <div className="item-spec-head source-ranking-row"><span>{t('common.class')}</span><span>{t('rank.specialization')}</span><span>{t('common.role')}</span><span>{t('common.tier')}</span></div>
              <div className="item-spec-body">
                {visibleRankings.map((entry) => (
                  <article key={`${entry.classId}-${entry.specId}`} className="source-ranking-row">
                    <div className="class-cell"><ClassSpecIcon classId={entry.classId} label={entry.className} /><b>{entry.className}</b></div>
                    <div className="spec-cell"><SpecGuideMenu classId={entry.classId} specId={entry.specId} role={entry.role} label={entry.specName} /><div><b>{entry.specName}</b><small>{isUnified ? `${sourceEvidence(entry)}${showTechnicalMetadata ? ` · ${t('rank.evidenceCoverage', { value: evidenceCoverage(entry) })}` : ''}` : `${selectedSource?.name} ${entry.tier}`}</small><RankingEvidence entry={entry} unified={isUnified} selectedSource={selectedSource} /></div></div>
                    <span className={`role-chip role-${entry.role}`}>{entry.role === 'support' ? 'Support' : entry.role}</span>
                    <span className={`tier tier-${tierClassName(entry.tier)}`}>{entry.tier}</span>
                  </article>
                ))}
              </div>
            </> : <div className="tier-board">
              {tiers.map((tier) => {
                const tierEntries = visibleRankings.filter((entry) => entry.tier === tier);
                return <section className={`tier-row tier-row-${tierClassName(tier)}`} key={tier}><div className="tier-row-label"><b>{tier}</b><span>{tierEntries.length}</span></div><div className="tier-specs">{tierEntries.length ? tierEntries.map((entry) => <article className="ranking-tier-entry" key={`${entry.classId}-${entry.specId}`}><SpecGuideMenu classId={entry.classId} specId={entry.specId} role={entry.role} label={entry.specName} /><div><b>{entry.specName}</b><small>{isUnified ? sourceEvidence(entry) : selectedSource?.name}</small></div><RankingEvidence entry={entry} unified={isUnified} selectedSource={selectedSource} /></article>) : <span className="empty-tier">{t('rank.emptySpecs')}</span>}</div></section>;
              })}
            </div>}
          </section>

          <section className="ranking-footnote"><b>{t('rank.interpretation')}</b><p>{isUnified ? t(showTechnicalMetadata ? 'rank.explanation' : 'rank.publicExplanation') : t('rank.sourceExplanation', { source: selectedSource?.name })}</p></section>
        </>
      )}
    </div>
  );
}
