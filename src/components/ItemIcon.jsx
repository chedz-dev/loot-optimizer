import { useI18n } from '../i18n.jsx';
import { localizedItemName, localizedWowheadUrl } from '../item-localization.js';

const FALLBACK_ICON = 'https://wow.zamimg.com/images/wow/icons/large/inv_misc_questionmark.jpg';

export default function ItemIcon({ item, size = 'normal', tooltip = false }) {
  const { language, t } = useI18n();
  const name = localizedItemName(item, language);
  const src = item?.icon
    ? `https://wow.zamimg.com/images/wow/icons/large/${item.icon}.jpg`
    : FALLBACK_ICON;
  const icon = (
    <span className={`item-icon ${size === 'small' ? 'item-icon-small' : ''}`}>
      <img src={src} alt={t('icon.alt', { name: name || 'trinket' })} onError={(event) => { event.currentTarget.src = FALLBACK_ICON; }} />
    </span>
  );

  if (!tooltip || !item?.itemId) return icon;

  return (
    <a
      className="item-tooltip-anchor"
      href={localizedWowheadUrl(item, language)}
      target="_blank"
      rel="noreferrer"
      data-wowhead={`item=${item.itemId}`}
      aria-label={t('icon.tooltip', { name })}
      title={t('icon.open', { name })}
    >
      {icon}
    </a>
  );
}

export function WowheadLink({ item, children }) {
  const { language, t } = useI18n();
  return <a className="wowhead-link" href={localizedWowheadUrl(item, language)} target="_blank" rel="noreferrer">{children || t('common.openWowhead')}</a>;
}
