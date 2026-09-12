// Display the calendar day printed by the publisher, not a snapshot timestamp
// or the browser's conversion of a UTC midnight into the previous local day.
export function formatGuideUpdatedDate(value, language = 'es') {
  if (typeof value !== 'string') return null;
  const source = value.trim();
  const match = /^(\d{4})([-/])(\d{2})\2(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(source);
  if (!match) return null;
  const [, year, , month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year)
    || date.getUTCMonth() + 1 !== Number(month)
    || date.getUTCDate() !== Number(day)
    || (source.includes('T') && !Number.isFinite(Date.parse(source)))) return null;
  return {
    iso: `${year}-${month}-${day}`,
    label: new Intl.DateTimeFormat(language === 'es' ? 'es-MX' : 'en-US', {
      year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
    }).format(date),
  };
}

export function guideAuthorName(value) {
  return typeof value === 'string' ? value.trim() : '';
}
