import { useId, useRef } from 'react';
import ClassSpecIcon from './ClassSpecIcon.jsx';
import { specGuideUrls } from '../guide-links.js';
import { useI18n } from '../i18n.jsx';

export default function SpecGuideMenu({ classId, specId, role, label }) {
  const { t } = useI18n();
  const popoverId = useId().replaceAll(':', '');
  const popoverRef = useRef(null);
  const urls = specGuideUrls({ classId, specId, role });

  const toggleMenu = (event) => {
    const popover = popoverRef.current;
    if (!popover) return;
    if (popover.matches(':popover-open')) {
      popover.hidePopover();
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    popover.style.left = `${Math.max(10, Math.min(rect.left, window.innerWidth - 230))}px`;
    popover.style.top = `${Math.min(rect.bottom + 7, window.innerHeight - 150)}px`;
    popover.showPopover();
  };

  return (
    <>
      <button type="button" className="spec-guide-trigger" onClick={toggleMenu} aria-label={t('guide.openSpecGuides', { spec: label })} aria-haspopup="menu" aria-controls={popoverId}>
        <ClassSpecIcon classId={classId} specId={specId} label={label} kind="spec" />
      </button>
      <div ref={popoverRef} id={popoverId} className="spec-guide-popover" popover="auto" role="menu" aria-label={t('guide.chooseSource')}>
        <small>{t('guide.chooseSource')}</small>
        <b>{label}</b>
        <a href={urls.wowhead} target="_blank" rel="noreferrer" role="menuitem" onClick={() => popoverRef.current?.hidePopover()}>Wowhead</a>
        <a href={urls.icyveins} target="_blank" rel="noreferrer" role="menuitem" onClick={() => popoverRef.current?.hidePopover()}>Icy Veins</a>
      </div>
    </>
  );
}
