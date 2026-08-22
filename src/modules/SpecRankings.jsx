import { useEffect, useMemo, useState } from 'react';
import ItemIcon, { WowheadLink } from '../components/ItemIcon.jsx';
import ClassSpecIcon from '../components/ClassSpecIcon.jsx';
import { dataFetch } from '../data-client.js';
import { useI18n } from '../i18n.jsx';
import { localizedItemName } from '../item-localization.js';
import { usePersistentState } from '../use-persistent-state.js';

const sourceAbbreviations = { wowhead: 'WH', icyveins: 'IV', warcraftlogs: 'WCL', bloodmallet: 'BM' };

const sourceEvidence = (entry) => Object.values(entry.sourceScores || {}).map((source) => (
  `${sourceAbbreviations[source.source] || source.name} ${source.status === 'observed' ? source.rawValue : 'NR'}`
)).join(' · ');

export default function SpecRankings() {
  const { language, t } = useI18n();
  const [items, setItems] = useState([]);
  const [itemId, setItemId] = usePersistentState('loot-rankings-item', 'gebbo');
  const [content, setContent] = usePersistentState('loot-rankings-content', 'all');
  const [search, setSearch] = usePersistentState('loot-rankings-search', '');
  const [role, setRole] = usePersistentState('loot-rankings-role', 'all');
  const [rankingView, setRankingView] = usePersistentState('loot-rankings-view', 'list');
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

  const visibleRankings = useMemo(() => {
    if (!result) return [];
    if (role === 'all') return result.rankings;
    if (role === 'dps') return result.rankings.filter((entry) => ['dps', 'support'].includes(entry.role));
    return result.rankings.filter((entry) => entry.role === role);
  }, [result, role]);

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
              <span><span className={`source-badge source-${item.category}`}>{item.category === 'raid' ? 'RAID' : 'M+'}</span><b>{localizedItemName(item, language)}</b><small>{item.drop.encounter} · {item.drop.instance}</small></span>
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
            <div className="panel selected-item-summary"><div className="selected-tooltip"><ItemIcon item={result.item} tooltip /><span>{t('rank.hover')}</span></div><div><small>{t('common.selectedItem')}</small><h2>{localizedItemName(result.item, language)}</h2><p><b>{result.item.drop.encounter}</b> · {result.item.drop.instance} · {result.item.drop.sourceType}</p><WowheadLink item={result.item} /></div><div className="evidence-chips">{result.metadata.sources.map((source) => <span key={source.id}>{source.name} {Math.round(source.weight * 100)}%</span>)}</div></div>
            <div className="panel tier-summary"><small>{t('rank.distribution')}</small>{['S', 'A', 'B', 'C'].map((tier) => <span key={tier} className={`tier-count tier-${tier.toLowerCase()}`}><b>{tier}</b>{tierCounts[tier] || 0}</span>)}</div>
          </section>

          <section className="panel engine-summary">
            <div><small>{t('rank.activeSources')}</small><b>{result.metadata.sources.map((source) => `${source.name} ${Math.round(source.weight * 100)}%`).join(' · ')}</b></div>
            <div><small>{t('rank.editorialScale')}</small><b>S 100 · A+ 95 · A 90 · B 75 · C 60 · D 45 · F 30</b></div>
            <div><small>{t('common.coverage')}</small><b>{t('rank.fullCoverage')}</b></div>
            <div><small>{t('rank.eligibility')}</small><b>{t('rank.visible', { visible: result.metadata.eligibleSpecs, excluded: result.metadata.excludedSpecs })}</b></div>
          </section>

          <section className={`panel spec-ranking-table item-to-spec-table ${rankingView === 'tierlist' ? 'tierlist-mode' : ''}`}>
            <div className="panel-head ranking-table-title"><div><h2>{t('rank.tableTitle')}</h2></div><div className="ranking-view-controls"><div className="segment-control view-filter"><button className={rankingView === 'list' ? 'active' : ''} onClick={() => setRankingView('list')}>{t('common.list')}</button><button className={rankingView === 'tierlist' ? 'active' : ''} onClick={() => setRankingView('tierlist')}>{t('common.tierList')}</button></div><div className="segment-control role-filter"><button className={role === 'all' ? 'active' : ''} onClick={() => setRole('all')}>{t('common.all')}</button><button className={role === 'dps' ? 'active' : ''} onClick={() => setRole('dps')}>DPS</button><button className={role === 'healer' ? 'active' : ''} onClick={() => setRole('healer')}>{t('common.healers')}</button><button className={role === 'tank' ? 'active' : ''} onClick={() => setRole('tank')}>{t('common.tanks')}</button></div></div></div>
            {rankingView === 'list' ? <>
              <div className="item-spec-head"><span>#</span><span>{t('common.class')}</span><span>{t('rank.specialization')}</span><span>{t('common.role')}</span><span>{t('rank.relativeValue')}</span><span>{t('common.tier')}</span></div>
              <div className="item-spec-body">
                {visibleRankings.map((entry, index) => (
                  <article key={`${entry.classId}-${entry.specId}`}>
                    <span className="table-rank">{String(entry.rank || index + 1).padStart(2, '0')}</span>
                    <div className="class-cell"><ClassSpecIcon classId={entry.classId} label={entry.className} /><b>{entry.className}</b></div>
                    <div className="spec-cell"><ClassSpecIcon classId={entry.classId} specId={entry.specId} label={entry.specName} kind="spec" /><div><b>{entry.specName}</b><small>{sourceEvidence(entry)} · {t('rank.evidenceCoverage', { value: entry.confidence })}</small></div></div>
                    <span className={`role-chip role-${entry.role}`}>{entry.role === 'support' ? 'Support' : entry.role}</span>
                    <div className="relative-score" title={t('rank.evidenceCoverage', { value: entry.confidence })}><div><i style={{ width: `${entry.score}%` }} /></div><strong>{entry.score}</strong></div>
                    <span className={`tier tier-${entry.tier.toLowerCase()}`}>{entry.tier}</span>
                  </article>
                ))}
              </div>
            </> : <div className="tier-board">
              {['S', 'A', 'B', 'C'].map((tier) => {
                const tierEntries = visibleRankings.filter((entry) => entry.tier === tier);
                return <section className={`tier-row tier-row-${tier.toLowerCase()}`} key={tier}><div className="tier-row-label"><b>{tier}</b><span>{tierEntries.length}</span></div><div className="tier-specs">{tierEntries.length ? tierEntries.map((entry) => <article key={`${entry.classId}-${entry.specId}`}><ClassSpecIcon classId={entry.classId} specId={entry.specId} label={entry.specName} kind="spec" /><div><b>{entry.specName}</b><small>{sourceEvidence(entry)} · {entry.confidence}%</small></div><strong>{entry.score}</strong></article>) : <span className="empty-tier">{t('rank.emptySpecs')}</span>}</div></section>;
              })}
            </div>}
          </section>

          <section className="ranking-footnote"><b>{t('rank.interpretation')}</b><p>{t('rank.explanation')}</p></section>
        </>
      )}
    </div>
  );
}
