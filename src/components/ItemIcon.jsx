const FALLBACK_ICON = 'https://wow.zamimg.com/images/wow/icons/large/inv_misc_questionmark.jpg';

export default function ItemIcon({ item, size = 'normal', tooltip = false }) {
  const src = item?.icon
    ? `https://wow.zamimg.com/images/wow/icons/large/${item.icon}.jpg`
    : FALLBACK_ICON;
  const icon = (
    <span className={`item-icon ${size === 'small' ? 'item-icon-small' : ''}`}>
      <img src={src} alt={`Icono de ${item?.name || 'trinket'}`} onError={(event) => { event.currentTarget.src = FALLBACK_ICON; }} />
    </span>
  );

  if (!tooltip || !item?.itemId) return icon;

  return (
    <a
      className="item-tooltip-anchor"
      href={`https://www.wowhead.com/item=${item.itemId}`}
      data-wowhead={`item=${item.itemId}`}
      aria-label={`Ver tooltip de ${item.name}`}
      title={`Abrir ${item.name} en Wowhead`}
    >
      {icon}
    </a>
  );
}

export function WowheadLink({ item, children = 'Ver en Wowhead' }) {
  return <a className="wowhead-link" href={`https://www.wowhead.com/item=${item.itemId}`} target="_blank" rel="noreferrer">{children}</a>;
}
