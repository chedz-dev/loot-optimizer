export function localizedItemName(item, language) {
  return item?.localizedNames?.[language] || item?.localizedNames?.en || item?.name || '';
}

export function localizedWowheadUrl(item, language) {
  const host = language === 'es' ? 'https://es.wowhead.com' : 'https://www.wowhead.com';
  return item?.itemId ? `${host}/item=${item.itemId}` : item?.wowheadUrl || host;
}
