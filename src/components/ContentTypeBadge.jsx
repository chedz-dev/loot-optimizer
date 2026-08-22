export const CONTENT_TYPE_LABELS = {
  all: 'Todos',
  raid: 'Raid',
  dungeon: 'Mythic+',
  delves: 'Delves',
  crafting: 'Crafting',
  unknown: 'Sin categoría',
};

export default function ContentTypeBadge({ types = [] }) {
  const normalizedTypes = types.length ? types : ['unknown'];
  return (
    <span className={`wowhead-source source-${normalizedTypes[0]}`}>
      {normalizedTypes.map((type) => CONTENT_TYPE_LABELS[type] || type).join(' + ')}
    </span>
  );
}

