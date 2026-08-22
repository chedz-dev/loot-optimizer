const STATIC_DATA = import.meta.env.VITE_STATIC_DATA === 'true';
const staticBase = `${import.meta.env.BASE_URL}data/`;

function staticPath(input) {
  const url = new URL(input, window.location.origin);
  if (url.pathname === '/api/demo') return 'demo.json';
  if (url.pathname === '/api/sources') return 'sources.json';
  if (url.pathname === '/api/rankings/catalog') return 'catalog.json';
  if (url.pathname === '/api/wowhead/tierlists') return 'tierlists/wowhead.json';
  if (url.pathname === '/api/icyveins/tierlists') return 'tierlists/icyveins.json';
  if (url.pathname === '/api/rankings/item') return `rankings/${url.searchParams.get('item')}.json`;
  return null;
}

export function dataFetch(input, options) {
  if (!STATIC_DATA) return fetch(input, options);
  if (options?.method && options.method !== 'GET') {
    return Promise.reject(new Error('Esta operación requiere la API dinámica.'));
  }
  const path = staticPath(input);
  if (!path) return Promise.reject(new Error(`No existe una vista JSON estática para ${input}`));
  return fetch(`${staticBase}${path}?v=${encodeURIComponent(__DATA_VERSION__)}`);
}
