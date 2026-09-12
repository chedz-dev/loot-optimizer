import { useEffect, useMemo, useState } from 'react';
import SpecRankings from './modules/SpecRankings.jsx';
import WowheadTierlists from './modules/WowheadTierlists.jsx';
import IcyVeinsTierlists from './modules/IcyVeinsTierlists.jsx';
import WarcraftLogsPopularity from './modules/WarcraftLogsPopularity.jsx';
import ItemIcon from './components/ItemIcon.jsx';
import { dataFetch } from './data-client.js';
import { useI18n } from './i18n.jsx';
import { usePersistentState } from './use-persistent-state.js';
import { isStaticBuild } from './build-mode.js';

const publicViews = ['rankings', 'wowhead', 'icyveins'];

const sourceLabelKeys = {
  ready: 'source.connected',
  dataset: 'source.dataset',
  'credentials-required': 'source.credentials',
  'reference-only': 'source.reference',
  configured: 'source.configured',
};

function SourcePill({ source, t }) {
  return (
    <a className={`source-pill ${source.status}`} href={source.url} target="_blank" rel="noreferrer" title={source.detail}>
      <span className="source-mark">{source.name.slice(0, 2).toUpperCase()}</span>
      <span><b>{source.name}</b><small>{t(sourceLabelKeys[source.status])}</small></span>
    </a>
  );
}

function ScoreBar({ label, value, tint = 'gold' }) {
  return (
    <div className="score-row">
      <span>{label}</span>
      <div className="bar"><i className={tint} style={{ width: `${value}%` }} /></div>
      <strong>{value}</strong>
    </div>
  );
}

function App() {
  const { language, setLanguage, t } = useI18n();
  const [view, setView] = usePersistentState('loot-view', 'rankings');
  const activeView = isStaticBuild && !publicViews.includes(view) ? 'rankings' : view;
  const [warcraftLogsVisited, setWarcraftLogsVisited] = useState(!isStaticBuild && view === 'warcraftlogs');
  const [data, setData] = useState(null);
  const [sources, setSources] = useState([]);
  const [selected, setSelected] = useState('gebbo');
  const [drops, setDrops] = useState(['gebbo', 'vial']);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isStaticBuild && view === 'warcraftlogs') setWarcraftLogsVisited(true);
  }, [view]);

  useEffect(() => {
    if (isStaticBuild) return;
    Promise.all([
      dataFetch('/api/demo').then((res) => res.json()),
      dataFetch('/api/sources').then((res) => res.json()),
    ]).then(([demo, sourceData]) => {
      setData(demo);
      setSources(sourceData.sources);
    }).catch(() => setError('No se pudo conectar con la API local.'));
  }, []);

  const ranking = useMemo(() => {
    if (!data) return [];
    const weights = data.weights;
    return data.candidates
      .filter((candidate) => candidate.trinketId === selected)
      .map((candidate) => {
        const total = Object.entries(weights).reduce((sum, [key, weight]) => sum + candidate[key] * weight, 0);
        return { ...candidate, total: Math.round(total * 10) / 10, player: data.players.find((p) => p.id === candidate.playerId) };
      })
      .sort((a, b) => b.total - a.total);
  }, [data, selected]);

  const optimize = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await dataFetch('/api/optimize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          drops: drops.map((trinketId, index) => ({ id: `drop-${index}`, trinketId })),
          players: data.players, candidates: data.candidates, weights: data.weights, onePerPlayer: true,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setResult(payload);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const toggleDrop = (id) => setDrops((current) => current.includes(id)
    ? current.filter((item) => item !== id)
    : [...current, id]);

  if (!isStaticBuild && !data) return <div className="loading">{t('loading.app')}</div>;
  const currentTrinket = data?.trinkets.find((item) => item.id === selected);

  return (
    <div className="app-shell">
      <aside>
        <div className="brand"><span className="brand-rune">LC</span><div><b>Loot Council</b><small>Optimizer</small></div></div>
        <div className="language-switcher" role="group" aria-label={t('language.label')}>
          <span>{t('language.label')}</span>
          <div><button className={language === 'es' ? 'active' : ''} onClick={() => setLanguage('es')}>ES</button><button className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')}>EN</button></div>
        </div>
        <nav>
          <button className="disabled" disabled title={t('nav.soon')}><span>01</span> {t('nav.optimization')}</button>
          <button className={activeView === 'rankings' ? 'active' : ''} onClick={() => setView('rankings')}><span>02</span> {t('nav.rankings')}</button>
          <button className={view === 'wowhead' ? 'active' : ''} onClick={() => setView('wowhead')}><span>03</span> {t('nav.wowhead')}</button>
          <button className={view === 'icyveins' ? 'active' : ''} onClick={() => setView('icyveins')}><span>04</span> {t('nav.icyveins')}</button>
          {!isStaticBuild && <button className={activeView === 'warcraftlogs' ? 'active' : ''} onClick={() => setView('warcraftlogs')}><span>05</span> Warcraft Logs</button>}
          <button className="disabled" disabled title={t('nav.soon')}><span>{isStaticBuild ? '05' : '06'}</span> {t('nav.roster')}</button>
          <button className="disabled" disabled title={t('nav.soon')}><span>{isStaticBuild ? '06' : '07'}</span> {t('nav.history')}</button>
        </nav>
        <div className="season-card">
          <small>{t('season.active')}</small>
          <strong>Midnight S2</strong>
          <p>{t('season.model')}</p>
        </div>
      </aside>

      <main>
        <div className="language-switcher mobile-language-switcher" role="group" aria-label={t('language.label')}>
          <span>{t('language.label')}</span>
          <div><button className={language === 'es' ? 'active' : ''} onClick={() => setLanguage('es')}>ES</button><button className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')}>EN</button></div>
        </div>
        <div className="module-view" hidden={activeView !== 'rankings'}><SpecRankings /></div>
        <div className="module-view" hidden={activeView !== 'wowhead'}><WowheadTierlists /></div>
        <div className="module-view" hidden={activeView !== 'icyveins'}><IcyVeinsTierlists /></div>
        {!isStaticBuild && warcraftLogsVisited && <div className="module-view" hidden={activeView !== 'warcraftlogs'}><WarcraftLogsPopularity active={activeView === 'warcraftlogs'} /></div>}
        {!isStaticBuild && !['rankings', 'wowhead', 'icyveins', 'warcraftlogs'].includes(activeView) && <>
        <header>
          <div><p className="eyebrow">DECISIÓN BASADA EN DATOS</p><h1>Optimización de trinkets</h1><p>Cruza simulaciones, rendimiento real, guías y necesidad de mejora.</p></div>
          <button className="primary" onClick={optimize} disabled={!drops.length || busy}>{busy ? 'Calculando...' : 'Optimizar asignación'}</button>
        </header>

        <section className="source-strip">
          <div><small>FUENTES</small><b>{sources.filter((source) => ['ready', 'dataset'].includes(source.status)).length} disponibles</b></div>
          {sources.map((source) => <SourcePill key={source.id} source={source} t={t} />)}
        </section>

        <div className="workspace-grid">
          <section className="panel loot-panel">
            <div className="panel-head"><div><h2>Loot disponible</h2></div><span className="count">{drops.length} drops</span></div>
            <div className="trinket-list">
              {data.trinkets.map((trinket) => (
                <button key={trinket.id} className={`trinket ${selected === trinket.id ? 'selected' : ''}`} onClick={() => setSelected(trinket.id)}>
                  <ItemIcon item={trinket} />
                  <span className="item-copy"><b>{trinket.name}</b><small>{trinket.source} · ilvl {trinket.ilvl}</small></span>
                  <label className="check" onClick={(event) => event.stopPropagation()}>
                    <input type="checkbox" checked={drops.includes(trinket.id)} onChange={() => toggleDrop(trinket.id)} /><i />
                  </label>
                </button>
              ))}
            </div>
            <div className="model-note"><b>Modelo global</b><p>Busca la combinación con mayor valor total y limita a un trinket por jugador en esta ronda.</p></div>
          </section>

          <section className="panel ranking-panel">
            <div className="panel-head"><div><h2>Ranking para {currentTrinket.name}</h2></div><span className="fresh">Muestra de UI</span></div>
            <div className="ranking-head"><span>Jugador</span><span>Señales</span><span>Score</span></div>
            <div className="ranking-list">
              {ranking.map((entry, index) => (
                <article key={entry.playerId} className={index === 0 ? 'winner' : ''}>
                  <div className="rank-person"><span className="place">{index + 1}</span><span className={`avatar a${index}`}>{entry.player.name.slice(0, 2).toUpperCase()}</span><div><b>{entry.player.name}</b><small>{entry.player.spec} · ilvl {entry.player.equipped}</small></div></div>
                  <div className="mini-signals"><span title="Simulation">SIM {entry.simulation}</span><span title="Logs">LOG {entry.logs}</span><span title="Editorial">GUI {entry.editorial}</span><span title="Need">NEC {entry.need}</span></div>
                  <div className="total-score"><strong>{entry.total}</strong><small>/ 100</small></div>
                </article>
              ))}
            </div>
          </section>
        </div>

        {result && (
          <section className="panel result-panel">
            <div className="panel-head"><div><small>RESULTADO</small><h2>Asignación recomendada</h2></div><span className="total">Valor total {result.totalScore}</span></div>
            <div className="result-grid">
              {result.assignments.map((assignment) => {
                const trinket = data.trinkets.find((item) => item.id === assignment.trinketId);
                return <article key={assignment.dropId}><ItemIcon item={trinket} /><div><small>ASIGNAR</small><b>{trinket?.name}</b><p>a <strong>{assignment.player?.name}</strong> · {assignment.player?.spec}</p></div><div className="result-score">{assignment.total}</div></article>;
              })}
            </div>
          </section>
        )}

        <section className="method-grid">
          <div className="panel method-card"><small>PESO DEL MODELO</small><h2>Cómo se calcula</h2><ScoreBar label="Simulación" value={40} /><ScoreBar label="Warcraft Logs" value={25} tint="purple" /><ScoreBar label="Guías expertas" value={18} tint="blue" /><ScoreBar label="Necesidad" value={12} tint="green" /><ScoreBar label="Progresión" value={5} tint="slate" /></div>
          <div className="panel disclaimer"><small>LÍMITE DEL MVP</small><h2>Datos verificables, no magia</h2><p>Raider.IO se puede consultar en vivo. Warcraft Logs necesita credenciales OAuth. Bloodmallet se trata como dataset de simulación. Wowhead e Icy Veins quedan como evidencia editorial trazable hasta contar con una fuente autorizada.</p><p className="warning">Los valores visibles son datos demostrativos, no recomendaciones reales para tu roster.</p></div>
        </section>
        {error && <div className="error">{error}</div>}
        </>}
      </main>
    </div>
  );
}

export default App;
