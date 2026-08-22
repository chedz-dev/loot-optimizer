import { useEffect, useMemo, useState } from 'react';
import ClassSpecIcon from '../components/ClassSpecIcon.jsx';
import EditorialItemCard from '../components/EditorialItemCard.jsx';
import { dataFetch } from '../data-client.js';
import { useI18n } from '../i18n.jsx';
import { usePersistentState } from '../use-persistent-state.js';
import { showTechnicalMetadata } from '../build-mode.js';

const tierClass = (label) => label.toLocaleLowerCase().replace('+', '-plus').replace(/[^a-z0-9-]/g, '');

export default function IcyVeinsTierlists() {
  const { language, t } = useI18n();
  const [payload, setPayload] = useState(null);
  const [classId, setClassId] = usePersistentState('loot-icyveins-class', 'hunter');
  const [guideId, setGuideId] = usePersistentState('loot-icyveins-guide', 'hunter-beast-mastery');
  const [expandedCard, setExpandedCard] = useState(null);
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
  useEffect(() => { setExpandedCard(null); }, [guideId]);
  useEffect(() => { window.$WowheadPower?.refreshLinks?.(); }, [guide]);

  if (error) {
    return <div className="spec-module"><header className="rankings-hero"><div><p className="eyebrow">ICY VEINS</p><h1>{t('guide.icyTitle')}</h1></div></header><div className="error-inline">{error}</div></div>;
  }
  if (!payload || !guide) return <div className="module-loading">{t('guide.icyLoading')}</div>;

  return (
    <div className="spec-module wowhead-module icyveins-module">
      <header className="rankings-hero">
        <div><p className="eyebrow">{t('guide.eyebrow')}</p><h1>{t('guide.icyTitle')}</h1><p>{t('guide.icySubtitle')}</p></div>
        {showTechnicalMetadata && <span className="live-parser-badge icy-badge">{t('guide.updatedHourly', { hours: payload.cacheHours })}</span>}
      </header>

      <section className="panel wowhead-guide-selector">
        <div className="selector-title">
          <div><small>{t('guide.guide')}</small><h2>{t('guide.select')}</h2></div>
          <div className="complete-guide-picker">
            <label><span>{t('common.class')}</span><select value={classId} onChange={(event) => { const nextClass = event.target.value; setClassId(nextClass); setGuideId(payload.guides.find((entry) => entry.classId === nextClass)?.id || ''); }}>
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
        <div className={`wowhead-audit-bar ${showTechnicalMetadata ? '' : 'source-only'}`}>
          <div><span>{t('common.source')}</span><a href={guide.url} target="_blank" rel="noreferrer">{t('guide.original')}</a></div>
          {showTechnicalMetadata && <>
            <div><span>{t('common.coverage')}</span><b>{payload.guideCount}/{payload.guideCount} specs</b></div>
            <div><span>{t('guide.parsedItems')}</span><b>{guide.itemCount}</b></div>
            <div><span>{t('guide.detectedTiers')}</span><b>{guide.tierCount}</b></div>
            <div><span>{t('guide.snapshot')}</span><b>#{guide.snapshotId} · {t('guide.updatedHourly', { hours: payload.cacheHours })}</b></div>
          </>}
        </div>
      </section>

      <section className="panel wowhead-tier-panel">
        <div className="panel-head wowhead-tier-head">
          <div><small>{t('guide.originalTierList')}</small><h2>{guide.specName} {guide.className}</h2><p>{guide.pageTitle}</p></div>
          <div className="icy-guide-meta"><span>{t('guide.author')}</span><b>{guide.author || t('guide.unknownAuthor')}</b><span>{t('guide.updated')}</span><b>{guide.pageUpdatedAt ? new Date(guide.pageUpdatedAt).toLocaleDateString(language === 'es' ? 'es-MX' : 'en-US') : t('guide.unknownDate')}</b></div>
        </div>

        <div className="wowhead-tier-board">
          {guide.tiers.map((tier) => (
            <section className={`wowhead-tier-row tier-source-${tierClass(tier.label)}`} key={tier.label}>
              <div className="wowhead-tier-label"><b>{tier.label}</b><span>{tier.items.length}</span></div>
              <div className="wowhead-tier-items">
                {tier.items.map((item) => {
                  const cardKey = `${guide.id}:${tier.label}:${item.itemId}:${item.displayOrder}`;
                  return <EditorialItemCard key={cardKey} item={item} expanded={expandedCard === cardKey} onToggle={() => setExpandedCard((current) => current === cardKey ? null : cardKey)} />;
                })}
              </div>
            </section>
          ))}
        </div>
      </section>

      <p className="wowhead-method-note">{t('guide.icyMethod')}</p>
    </div>
  );
}
