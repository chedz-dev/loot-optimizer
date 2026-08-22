import { useI18n } from '../i18n.jsx';

const CONTENT_TYPE_KEYS = {
  all: 'common.all',
  raid: 'common.raid',
  dungeon: 'common.mythicPlus',
  delves: 'common.delves',
  crafting: 'common.crafting',
  unknown: 'common.unknown',
};

export default function ContentTypeBadge({ types = [] }) {
  const { t } = useI18n();
  const normalizedTypes = types.length ? types : ['unknown'];
  return (
    <span className={`wowhead-source source-${normalizedTypes[0]}`}>
      {normalizedTypes.map((type) => t(CONTENT_TYPE_KEYS[type] || type)).join(' + ')}
    </span>
  );
}
