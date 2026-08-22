import { useEffect, useMemo, useState } from 'react';
import ItemIcon from '../components/ItemIcon.jsx';
import ClassSpecIcon from '../components/ClassSpecIcon.jsx';
import ContentTypeBadge, { CONTENT_TYPE_LABELS } from '../components/ContentTypeBadge.jsx';
import { dataFetch } from '../data-client.js';

const tierClass = (label) => label.toLocaleLowerCase().replace('+', '-plus').replace(/[^a-z0-9-]/g, '');

export default function WowheadTierlists() {
  const [payload, setPayload] = useState(null);
  const [classId, setClassId] = useState('hunter');
  const [guideId, setGuideId] = useState('hunter-beast-mastery');
  const [source, setSource] = useState('all');
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    dataFetch('/api/wowhead/tierlists').then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setPayload(data);
    }).catch((err) => setError(err.message));
  }, []);

  const classes = useMemo(() => {
    const values = new Map();
    payload?.guides.forEach((entry) => values.set(entry.classId, entry.className));
    return [...values].map(([id, name]) => ({ id, name }));
  }, [payload]);
  const classGuides = useMemo(() => payload?.guides.filter((entry) => entry.classId === classId) || [], [payload, classId]);
  const guide = classGuides.find((entry) => entry.id === guideId) || classGuides[0] || payload?.guides[0];
  const sourceOptions = useMemo(() => {
    if (!guide) return ['all'];
    const values = new Set(guide.tiers.flatMap((tier) => tier.items.flatMap((item) => item.contentTypes)));
    return ['all', ...['raid', 'dungeon', 'delves', 'crafting'].filter((entry) => values.has(entry))];
  }, [guide]);

  const visibleTiers = useMemo(() => {
    if (!guide) return [];
    return guide.tiers.map((tier) => ({
      ...tier,
      items: source === 'all' ? tier.items : tier.items.filter((item) => item.contentTypes.includes(source)),
    }));
  }, [guide, source]);

  const visibleItems = visibleTiers.flatMap((tier) => tier.items);
  const selectedItem = visibleItems.find((item) => item.itemId === selectedItemId) || visibleItems[0];

  useEffect(() => {
    setSource('all');
    setSelectedItemId(null);
  }, [guideId]);

  useEffect(() => {
    window.$WowheadPower?.refreshLinks?.();
  }, [guide, source]);

  if (error) {
    return <div className="spec-module"><header className="rankings-hero"><div><p className="eyebrow">WOWHEAD GUIDE DATA</p><h1>Tierlist Wowhead Trinkets</h1></div></header><div className="error-inline">{error}</div></div>;
  }

  if (!payload || !guide) return <div className="module-loading">Parseando las guías de Wowhead...</div>;

  return (
    <div className="spec-module wowhead-module">
      <header className="rankings-hero">
        <div><p className="eyebrow">DATOS EDITORIALES TRAZABLES</p><h1>Tierlist Wowhead Trinkets</h1><p>Reconstrucción automática del bloque Trinket Tier List publicado en cada guía.</p></div>
        <span className="live-parser-badge">JSON CANÓNICO · CACHE {payload.cacheHours}H</span>
      </header>

      <section className="panel wowhead-guide-selector">
        <div className="selector-title">
          <div><small>GUÍA</small><h2>Selecciona una clase y especialización</h2></div>
          <div className="complete-guide-picker">
            <label><span>CLASE</span><select value={classId} onChange={(event) => { const nextClass = event.target.value; setClassId(nextClass); setGuideId(payload.guides.find((entry) => entry.classId === nextClass)?.id || ''); }}>
              {classes.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select></label>
            <div className="guide-tabs">
              {classGuides.map((entry) => (
                <button key={entry.id} className={entry.id === guide.id ? 'active' : ''} onClick={() => setGuideId(entry.id)}>
                  <ClassSpecIcon classId={entry.classId} specId={entry.specId} label={entry.specName} kind="spec" />
                  <span><b>{entry.specName}</b><small>{entry.className}</small></span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="wowhead-audit-bar">
          <div><span>Fuente</span><a href={guide.url} target="_blank" rel="noreferrer">Abrir guía original</a></div>
          <div><span>Cobertura</span><b>{payload.guideCount}/{payload.guideCount} specs</b></div>
          <div><span>Items parseados</span><b>{guide.itemCount}</b></div>
          <div><span>Tiers detectados</span><b>{guide.tierCount}</b></div>
          <div><span>Snapshot JSON</span><b>#{guide.snapshotId} · {new Date(guide.fetchedAt).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}</b></div>
        </div>
      </section>

      <section className="panel wowhead-tier-panel">
        <div className="panel-head wowhead-tier-head">
          <div><small>TIER LIST ORIGINAL</small><h2>{guide.specName} {guide.className}</h2><p>{guide.pageTitle}</p></div>
          <div className="segment-control wowhead-source-filter">
            {sourceOptions.map((entry) => <button key={entry} className={source === entry ? 'active' : ''} onClick={() => { setSource(entry); setSelectedItemId(null); }}>{CONTENT_TYPE_LABELS[entry]}</button>)}
          </div>
        </div>

        <div className="wowhead-tier-board">
          {visibleTiers.map((tier) => (
            <section className={`wowhead-tier-row tier-source-${tierClass(tier.label)}`} key={tier.label}>
              <div className="wowhead-tier-label"><b>{tier.label}</b><span>{tier.items.length}</span></div>
              <div className="wowhead-tier-items">
                {tier.items.length ? tier.items.map((item) => (
                  <article key={`${item.itemId}-${item.displayOrder}`} className={selectedItem?.itemId === item.itemId ? 'selected' : ''}>
                    <ItemIcon item={item} tooltip />
                    <button onClick={() => setSelectedItemId(item.itemId)}>
                      <ContentTypeBadge types={item.contentTypes} />
                      <b>{item.name}</b>
                      <small>Item {item.itemId}{item.guideNote ? ' · Nota editorial' : ''}</small>
                    </button>
                  </article>
                )) : <span className="empty-tier">Sin items para este filtro</span>}
              </div>
            </section>
          ))}
        </div>
      </section>

      {selectedItem && (
        <section className="panel wowhead-note-panel">
          <ItemIcon item={selectedItem} tooltip />
          <div><small>ITEM SELECCIONADO</small><h2>{selectedItem.name}</h2><ContentTypeBadge types={selectedItem.contentTypes} /></div>
          <div className="guide-note"><small>NOTA DEL AUTOR DE LA GUÍA</small><p>{selectedItem.guideNote || 'Este item no tiene una nota editorial asociada en la tier list.'}</p></div>
          <a href={selectedItem.wowheadUrl} target="_blank" rel="noreferrer">Ver item en Wowhead</a>
        </section>
      )}

      <p className="wowhead-method-note">La letra del tier y el orden de los items se conservan tal como aparecen en el markup de Wowhead. El orden horizontal se muestra como orden visual, no como una diferencia de poder inferida.</p>
    </div>
  );
}
