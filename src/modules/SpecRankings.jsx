import { useEffect, useMemo, useState } from 'react';
import ItemIcon, { WowheadLink } from '../components/ItemIcon.jsx';
import ClassSpecIcon from '../components/ClassSpecIcon.jsx';
import { dataFetch } from '../data-client.js';

const sourceAbbreviations = { wowhead: 'WH', icyveins: 'IV', warcraftlogs: 'WCL', bloodmallet: 'BM' };

const sourceEvidence = (entry) => Object.values(entry.sourceScores || {}).map((source) => (
  `${sourceAbbreviations[source.source] || source.name} ${source.status === 'observed' ? source.rawValue : 'NR'}`
)).join(' · ');

export default function SpecRankings() {
  const [items, setItems] = useState([]);
  const [itemId, setItemId] = useState('gebbo');
  const [content, setContent] = useState('all');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('all');
  const [rankingView, setRankingView] = useState('list');
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
      const matchesSearch = !normalizedSearch || `${item.name} ${item.drop.encounter} ${item.drop.instance}`.toLocaleLowerCase().includes(normalizedSearch);
      return matchesSource && matchesSearch;
    });
  }, [content, items, search]);

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
        <div><p className="eyebrow">BIBLIOTECA DE LOOT</p><h1>¿Para quién es este trinket?</h1><p>Selecciona un item y compara su valor para todas las clases y especializaciones.</p></div>
        <span className="demo-badge engine-live-badge">MOTOR DE FUENTES NORMALIZADAS</span>
      </header>

      <section className="panel item-selector-panel">
        <div className="selector-title"><div><small>PASO 1</small><h2>Selecciona un trinket <span>{visibleItems.length} de {items.length}</span></h2></div><div className="selector-tools"><label className="item-search"><span>Buscar</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre, boss o dungeon" /></label><div className="segment-control"><button className={content === 'all' ? 'active' : ''} onClick={() => setContent('all')}>Todos</button><button className={content === 'raid' ? 'active' : ''} onClick={() => setContent('raid')}>Raid</button><button className={content === 'mythic-plus' ? 'active' : ''} onClick={() => setContent('mythic-plus')}>Mythic+</button></div></div></div>
        <div className="item-picker">
          {visibleItems.map((item) => (
            <button key={item.id} className={itemId === item.id ? 'active' : ''} onClick={() => setItemId(item.id)}>
              <ItemIcon item={item} />
              <span><span className={`source-badge source-${item.category}`}>{item.category === 'raid' ? 'RAID' : 'M+'}</span><b>{item.name}</b><small>{item.drop.encounter} · {item.drop.instance}</small></span>
              <i />
            </button>
          ))}
          {!visibleItems.length && <p className="empty-items">No hay trinkets que coincidan con este filtro.</p>}
        </div>
      </section>

      {error && <div className="error-inline">{error}</div>}
      {loading || !result ? <div className="module-loading">Comparando clases y specs...</div> : (
        <>
          <section className="item-ranking-summary">
            <div className="panel selected-item-summary"><div className="selected-tooltip"><ItemIcon item={result.item} tooltip /><span>Pasa el ratón para ver el efecto</span></div><div><small>ITEM SELECCIONADO</small><h2>{result.item.name}</h2><p><b>{result.item.drop.encounter}</b> · {result.item.drop.instance} · {result.item.drop.sourceType}</p><WowheadLink item={result.item} /></div><div className="evidence-chips">{result.metadata.sources.map((source) => <span key={source.id}>{source.name} {Math.round(source.weight * 100)}%</span>)}</div></div>
            <div className="panel tier-summary"><small>DISTRIBUCIÓN</small>{['S', 'A', 'B', 'C'].map((tier) => <span key={tier} className={`tier-count tier-${tier.toLowerCase()}`}><b>{tier}</b>{tierCounts[tier] || 0}</span>)}</div>
          </section>

          <section className="panel engine-summary">
            <div><small>FUENTES ACTIVAS</small><b>{result.metadata.sources.map((source) => `${source.name} ${Math.round(source.weight * 100)}%`).join(' · ')}</b></div>
            <div><small>ESCALA EDITORIAL</small><b>S 100 · A+ 95 · A 90 · B 75 · C 60 · D 45 · F 30</b></div>
            <div><small>COBERTURA</small><b>100% cuando ambas fuentes rankean la spec</b></div>
            <div><small>ELEGIBILIDAD</small><b>{result.metadata.eligibleSpecs} visibles · {result.metadata.excludedSpecs} sin evidencia</b></div>
          </section>

          <section className={`panel spec-ranking-table item-to-spec-table ${rankingView === 'tierlist' ? 'tierlist-mode' : ''}`}>
            <div className="panel-head ranking-table-title"><div><small>PASO 2</small><h2>Ranking de clases y specs</h2></div><div className="ranking-view-controls"><div className="segment-control view-filter"><button className={rankingView === 'list' ? 'active' : ''} onClick={() => setRankingView('list')}>Lista</button><button className={rankingView === 'tierlist' ? 'active' : ''} onClick={() => setRankingView('tierlist')}>Tier list</button></div><div className="segment-control role-filter"><button className={role === 'all' ? 'active' : ''} onClick={() => setRole('all')}>Todos</button><button className={role === 'dps' ? 'active' : ''} onClick={() => setRole('dps')}>DPS</button><button className={role === 'healer' ? 'active' : ''} onClick={() => setRole('healer')}>Healers</button><button className={role === 'tank' ? 'active' : ''} onClick={() => setRole('tank')}>Tanks</button></div></div></div>
            {rankingView === 'list' ? <>
              <div className="item-spec-head"><span>#</span><span>Clase</span><span>Especialización</span><span>Rol</span><span>Valor relativo</span><span>Tier</span></div>
              <div className="item-spec-body">
                {visibleRankings.map((entry, index) => (
                  <article key={`${entry.classId}-${entry.specId}`}>
                    <span className="table-rank">{String(entry.rank || index + 1).padStart(2, '0')}</span>
                    <div className="class-cell"><ClassSpecIcon classId={entry.classId} label={entry.className} /><b>{entry.className}</b></div>
                    <div className="spec-cell"><ClassSpecIcon classId={entry.classId} specId={entry.specId} label={entry.specName} kind="spec" /><div><b>{entry.specName}</b><small>{sourceEvidence(entry)} · cobertura {entry.confidence}%</small></div></div>
                    <span className={`role-chip role-${entry.role}`}>{entry.role === 'support' ? 'Support' : entry.role}</span>
                    <div className="relative-score" title={`Cobertura ${entry.confidence}%`}><div><i style={{ width: `${entry.score}%` }} /></div><strong>{entry.score}</strong></div>
                    <span className={`tier tier-${entry.tier.toLowerCase()}`}>{entry.tier}</span>
                  </article>
                ))}
              </div>
            </> : <div className="tier-board">
              {['S', 'A', 'B', 'C'].map((tier) => {
                const tierEntries = visibleRankings.filter((entry) => entry.tier === tier);
                return <section className={`tier-row tier-row-${tier.toLowerCase()}`} key={tier}><div className="tier-row-label"><b>{tier}</b><span>{tierEntries.length}</span></div><div className="tier-specs">{tierEntries.length ? tierEntries.map((entry) => <article key={`${entry.classId}-${entry.specId}`}><ClassSpecIcon classId={entry.classId} specId={entry.specId} label={entry.specName} kind="spec" /><div><b>{entry.specName}</b><small>{sourceEvidence(entry)} · {entry.confidence}%</small></div><strong>{entry.score}</strong></article>) : <span className="empty-tier">Sin especializaciones</span>}</div></section>;
              })}
            </div>}
          </section>

          <section className="ranking-footnote"><b>Interpretación</b><p>Solo aparecen specs con evidencia en al menos una fuente. NR significa que la otra fuente no rankeó el item y aporta 35 puntos. La cobertura indica cuánto del peso total está respaldado por una señal observada.</p></section>
        </>
      )}
    </div>
  );
}
