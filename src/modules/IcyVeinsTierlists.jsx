import { useEffect, useMemo, useState } from 'react';
import ItemIcon from '../components/ItemIcon.jsx';
import ClassSpecIcon from '../components/ClassSpecIcon.jsx';
import ContentTypeBadge from '../components/ContentTypeBadge.jsx';
import { dataFetch } from '../data-client.js';

const tierClass = (label) => label.toLocaleLowerCase().replace('+', '-plus').replace(/[^a-z0-9-]/g, '');

export default function IcyVeinsTierlists() {
  const [payload, setPayload] = useState(null);
  const [classId, setClassId] = useState('hunter');
  const [guideId, setGuideId] = useState('hunter-beast-mastery');
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    dataFetch('/api/icyveins/tierlists').then(async (response) => {
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
  const items = guide?.tiers.flatMap((tier) => tier.items) || [];
  const selectedItem = items.find((item) => item.itemId === selectedItemId) || items[0];

  useEffect(() => setSelectedItemId(null), [guideId]);
  useEffect(() => { window.$WowheadPower?.refreshLinks?.(); }, [guide]);

  if (error) {
    return <div className="spec-module"><header className="rankings-hero"><div><p className="eyebrow">ICY VEINS GUIDE DATA</p><h1>Tierlist Icy Veins Trinkets</h1></div></header><div className="error-inline">{error}</div></div>;
  }
  if (!payload || !guide) return <div className="module-loading">Parseando las guías de Icy Veins...</div>;

  return (
    <div className="spec-module wowhead-module icyveins-module">
      <header className="rankings-hero">
        <div><p className="eyebrow">DATOS EDITORIALES TRAZABLES</p><h1>Tierlist Icy Veins Trinkets</h1><p>Reconstrucción automática de la tabla de recomendaciones publicada en cada guía.</p></div>
        <span className="live-parser-badge icy-badge">JSON CANÓNICO · CACHE {payload.cacheHours}H</span>
      </header>

      <section className="panel wowhead-guide-selector">
        <div className="selector-title">
          <div><small>GUÍA</small><h2>Selecciona una clase y especialización</h2></div>
          <div className="complete-guide-picker">
            <label><span>CLASE</span><select value={classId} onChange={(event) => { const nextClass = event.target.value; setClassId(nextClass); setGuideId(payload.guides.find((entry) => entry.classId === nextClass)?.id || ''); }}>
              {classes.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select></label>
            <div className="guide-tabs icy-guide-tabs">
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
          <div><span>Snapshot JSON</span><b>#{guide.snapshotId} · cache {payload.cacheHours}h</b></div>
        </div>
      </section>

      <section className="panel wowhead-tier-panel">
        <div className="panel-head wowhead-tier-head">
          <div><small>TIER LIST ORIGINAL</small><h2>{guide.specName} {guide.className}</h2><p>{guide.pageTitle}</p></div>
          <div className="icy-guide-meta"><span>Autor</span><b>{guide.author || 'No identificado'}</b><span>Actualización</span><b>{guide.pageUpdatedAt ? new Date(guide.pageUpdatedAt).toLocaleDateString('es-MX') : 'No identificada'}</b></div>
        </div>

        <div className="wowhead-tier-board">
          {guide.tiers.map((tier) => (
            <section className={`wowhead-tier-row tier-source-${tierClass(tier.label)}`} key={tier.label}>
              <div className="wowhead-tier-label"><b>{tier.label}</b><span>{tier.items.length}</span></div>
              <div className="wowhead-tier-items">
                {tier.items.map((item) => (
                  <article key={`${item.itemId}-${item.displayOrder}`} className={selectedItem?.itemId === item.itemId ? 'selected' : ''}>
                    <ItemIcon item={item} tooltip />
                    <button onClick={() => setSelectedItemId(item.itemId)}>
                      <ContentTypeBadge types={item.contentTypes} />
                      <b>{item.name}</b>
                      <small>{item.guideNote || `Item ${item.itemId}`}</small>
                    </button>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>

      {selectedItem && (
        <section className="panel wowhead-note-panel icy-note-panel">
          <ItemIcon item={selectedItem} tooltip />
          <div><small>ITEM SELECCIONADO</small><h2>{selectedItem.name}</h2><ContentTypeBadge types={selectedItem.contentTypes} /></div>
          <div className="guide-note"><small>COMENTARIO DE LA GUÍA</small><p>{selectedItem.guideNote || 'Icy Veins no agregó un comentario adicional para este item.'}</p></div>
          <a href={guide.url} target="_blank" rel="noreferrer">Comparar con Icy Veins</a>
        </section>
      )}

      <p className="wowhead-method-note">La tabla se identifica por su encabezado de trinkets. El tier, el orden, el item ID y el comentario se guardan sin reinterpretar el texto editorial. La procedencia Raid, Mythic+, Delves o Crafting se resuelve desde el catálogo canónico compartido.</p>
    </div>
  );
}
