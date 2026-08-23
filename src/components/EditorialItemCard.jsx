import ItemIcon from './ItemIcon.jsx';
import ContentTypeBadge from './ContentTypeBadge.jsx';
import { useI18n } from '../i18n.jsx';
import { localizedItemName } from '../item-localization.js';

const COLLAPSED_NOTE_LENGTH = 125;

export default function EditorialItemCard({ item, expanded, onToggle }) {
  const { language, t } = useI18n();
  const name = localizedItemName(item, language);
  const note = item.guideNote?.trim() || '';
  const hasDropDetails = Boolean(item.drop?.instance || item.drop?.encounter);
  const canExpand = hasDropDetails || note.length > COLLAPSED_NOTE_LENGTH;
  const primaryType = item.contentTypes?.[0];
  const inlineOrigin = primaryType === 'dungeon'
    ? item.drop?.instance
    : primaryType === 'raid'
      ? item.drop?.encounter
      : '';

  return (
    <article className={`editorial-item-card ${canExpand ? 'expandable' : 'static'} ${expanded ? 'expanded' : ''}`}>
      <ItemIcon item={item} tooltip onClick={(event) => event.stopPropagation()} />
      {canExpand ? (
        <button
          className="editorial-card-body"
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? t('guide.showLess') : t('guide.showMore')}: ${name}`}
          onClick={onToggle}
        >
          <span className="editorial-card-heading">
            <span className="editorial-card-badges">
              <ContentTypeBadge types={item.contentTypes} />
              {inlineOrigin && <span className="editorial-origin-inline">{inlineOrigin}</span>}
              {item.season?.label && <span className="editorial-season-badge">{item.season.label}</span>}
            </span>
            <b>{name}</b>
          </span>
          {note && <span className={`editorial-description ${expanded ? 'full' : ''}`}>{note}</span>}
          {expanded && hasDropDetails && (
            <span className="editorial-drop-details">
              <span className="editorial-details-title">{t('guide.itemDetails')}</span>
              {item.season?.label && <span><small>{t('guide.season')}</small><b>{item.season.label}</b></span>}
              {item.drop.instance && <span><small>{t('guide.instance')}</small><b>{item.drop.instance}</b></span>}
              {item.drop.encounter && <span><small>{t('guide.encounter')}</small><b>{item.drop.encounter}</b></span>}
            </span>
          )}
          <span className="editorial-expand-control">
            {expanded ? t('guide.showLess') : t('guide.showMore')}
            <span className="editorial-chevron" aria-hidden="true" />
          </span>
        </button>
      ) : (
        <span className="editorial-card-body editorial-card-static">
          <span className="editorial-card-heading">
            <span className="editorial-card-badges">
              <ContentTypeBadge types={item.contentTypes} />
              {inlineOrigin && <span className="editorial-origin-inline">{inlineOrigin}</span>}
              {item.season?.label && <span className="editorial-season-badge">{item.season.label}</span>}
            </span>
            <b>{name}</b>
          </span>
          {note && <span className="editorial-description full">{note}</span>}
        </span>
      )}
    </article>
  );
}
