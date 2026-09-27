import { publicWclRoutes, staticWclResponse } from './warcraftlogs-static.js';

const STATIC_DATA = import.meta.env.VITE_STATIC_DATA === 'true';
const staticBase = `${import.meta.env.BASE_URL}data/`;
let warcraftLogsData;

// Comparte la descarga entre vistas sin cancelar la lectura de otros componentes.
async function fetchStaticWarcraftLogs(url, options) {
  if (!warcraftLogsData) {
    warcraftLogsData = fetch(`${staticBase}warcraftlogs.json?v=${encodeURIComponent(__DATA_VERSION__)}`)
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return response.json();
      }).catch(error => {
        warcraftLogsData = null;
        throw error;
      });
  }

  const data = await warcraftLogsData;
  options?.signal?.throwIfAborted();
  const { payload, status } = staticWclResponse(data, url);
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

function staticPath(input) {
  const url = new URL(input, window.location.origin);
  if (url.pathname === '/api/rankings/catalog') return 'catalog.json';
  if (url.pathname === '/api/wowhead/tierlists') return 'tierlists/wowhead.json';
  if (url.pathname === '/api/icyveins/tierlists') return 'tierlists/icyveins.json';
  if (url.pathname === '/api/rankings/item') return `rankings/${url.searchParams.get('item')}.json`;
  return null;
}

export function dataFetch(input, options) {
  if (!STATIC_DATA) {
    return fetch(input, options);
  }

  if (options?.method && options.method !== 'GET') {
    return Promise.reject(new Error('Esta operación requiere la API dinámica.'));
  }

  const url = new URL(input, window.location.origin);

  if (publicWclRoutes.some(route => url.pathname === `/api/warcraftlogs/${route}`)) {
    return fetchStaticWarcraftLogs(url, options);
  }

  const path = staticPath(input);
  if (!path) return Promise.reject(new Error(`No existe una vista JSON estática para ${input}`));
  return fetch(`${staticBase}${path}?v=${encodeURIComponent(__DATA_VERSION__)}`);
}
