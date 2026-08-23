import { useEffect, useMemo, useRef, useState } from 'react';
import ClassSpecIcon from '../components/ClassSpecIcon.jsx';
import EditorialItemCard from '../components/EditorialItemCard.jsx';
import { dataFetch } from '../data-client.js';
import { useI18n } from '../i18n.jsx';
import { usePersistentState } from '../use-persistent-state.js';
import { showTechnicalMetadata } from '../build-mode.js';

const tierClass = (label) => label.toLocaleLowerCase().replace('+', '-plus').replace(/[^a-z0-9-]/g, '');

export default function WowheadTierlists() {
  const { language, t } = useI18n();
  const [payload, setPayload] = useState(null);
  const [classId, setClassId] = usePersistentState('loot-wowhead-class', 'hunter');
  const [guideId, setGuideId] = usePersistentState('loot-wowhead-guide', 'hunter-beast-mastery');
  const [source, setSource] = usePersistentState('loot-wowhead-source', 'all');
  const [expandedCard, setExpandedCard] = useState(null);
  const [error, setError] = useState('');
  const previousGuideId = useRef(guideId);

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
    return ['all', ...['raid', 'dungeon', 'delves', 'world', 'crafting'].filter((entry) => values.has(entry))];
  }, [guide]);

  const visibleTiers = useMemo(() => {
    if (!guide) return [];
    return guide.tiers.map((tier) => ({
      ...tier,
      items: source === 'all' ? tier.items : tier.items.filter((item) => item.contentTypes.includes(source)),
    }));
  }, [guide, source]);

  useEffect(() => {
    if (previousGuideId.current !== guideId) {
      setSource('all');
      setExpandedCard(null);
    }
    previousGuideId.current = guideId;
  }, [guideId]);

  useEffect(() => {
    window.$WowheadPower?.refreshLinks?.();
  }, [guide, source]);

  if (error) {
    return <div className="spec-module"><header className="rankings-hero"><div><p className="eyebrow">WOWHEAD</p><h1>{t('guide.wowheadTitle')}</h1></div></header><div className="error-inline">{error}</div></div>;
  }

  if (!payload || !guide) return <div className="module-loading">{t('guide.wowheadLoading')}</div>;

  return (
    <div className="spec-module wowhead-module">
      <header className="rankings-hero">
        <div><p className="eyebrow">{t('guide.eyebrow')}</p><h1>{t('guide.wowheadTitle')}</h1><p>{t('guide.wowheadSubtitle')}</p></div>
        {showTechnicalMetadata && <span className="live-parser-badge">{t('guide.updatedHourly', { hours: payload.cacheHours })}</span>}
      </header>

      <section className="panel wowhead-guide-selector">
        <div className="selector-title">
          <div><small>{t('guide.guide')}</small><h2>{t('guide.select')}</h2></div>
          <div className="complete-guide-picker">
            <label><span>{t('common.class')}</span><select value={classId} onChange={(event) => { const nextClass = event.target.value; setClassId(nextClass); setGuideId(payload.guides.find((entry) => entry.classId === nextClass)?.id || ''); }}>
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
        <div className={`wowhead-audit-bar ${showTechnicalMetadata ? '' : 'source-only'}`}>
          <div><span>{t('common.source')}</span><a href={guide.url} target="_blank" rel="noreferrer">{t('guide.original')}</a></div>
          {showTechnicalMetadata && <>
            <div><span>{t('common.coverage')}</span><b>{payload.guideCount}/{payload.guideCount} specs</b></div>
            <div><span>{t('guide.parsedItems')}</span><b>{guide.itemCount}</b></div>
            <div><span>{t('guide.detectedTiers')}</span><b>{guide.tierCount}</b></div>
            <div><span>{t('guide.snapshot')}</span><b>#{guide.snapshotId} · {new Date(guide.fetchedAt).toLocaleString(language === 'es' ? 'es-MX' : 'en-US', { dateStyle: 'short', timeStyle: 'short' })}</b></div>
          </>}
        </div>
      </section>

      <section className="panel wowhead-tier-panel">
        <div className="panel-head wowhead-tier-head">
          <div><small>{t('guide.originalTierList')}</small><h2>{guide.specName} {guide.className}</h2><p>{guide.pageTitle}</p></div>
          <div className="segment-control wowhead-source-filter">
            {sourceOptions.map((entry) => <button key={entry} className={source === entry ? 'active' : ''} onClick={() => { setSource(entry); setExpandedCard(null); }}>{t({ all: 'common.all', raid: 'common.raid', dungeon: 'common.mythicPlus', delves: 'common.delves', world: 'common.world', crafting: 'common.crafting' }[entry])}</button>)}
          </div>
        </div>

        <div className="wowhead-tier-board">
          {visibleTiers.map((tier) => (
            <section className={`wowhead-tier-row tier-source-${tierClass(tier.label)}`} key={tier.label}>
              <div className="wowhead-tier-label"><b>{tier.label}</b><span>{tier.items.length}</span></div>
              <div className="wowhead-tier-items">
                {tier.items.length ? tier.items.map((item) => {
                  const cardKey = `${guide.id}:${tier.label}:${item.itemId}:${item.displayOrder}`;
                  return <EditorialItemCard key={cardKey} item={item} expanded={expandedCard === cardKey} onToggle={() => setExpandedCard((current) => current === cardKey ? null : cardKey)} />;
                }) : <span className="empty-tier">{t('guide.emptyFilter')}</span>}
              </div>
            </section>
          ))}
        </div>
      </section>

      <p className="wowhead-method-note">{t('guide.wowheadMethod')}</p>
    </div>
  );
}
