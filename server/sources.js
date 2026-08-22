const jsonFetch = async (url, options = {}) => {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};

export const sourceCatalog = [
  {
    id: 'warcraftlogs', name: 'Warcraft Logs', kind: 'API GraphQL',
    url: 'https://www.warcraftlogs.com/api/docs',
    detail: 'Uso real del trinket, rendimiento por encuentro y percentiles.',
  },
  {
    id: 'raiderio', name: 'Raider.IO', kind: 'API pública',
    url: 'https://raider.io/api',
    detail: 'Perfil, equipo, especialización y progreso del personaje.',
  },
  {
    id: 'bloodmallet', name: 'Bloodmallet', kind: 'Dataset de simulación',
    url: 'https://bloodmallet.com',
    detail: 'Rendimiento relativo de trinkets por spec y perfil de combate.',
  },
  {
    id: 'wowhead', name: 'Wowhead', kind: 'Referencia editorial',
    url: 'https://www.wowhead.com/guides/classes',
    detail: 'Datos del objeto y recomendaciones de guías por especialización.',
  },
  {
    id: 'icyveins', name: 'Icy Veins', kind: 'Referencia editorial',
    url: 'https://www.icy-veins.com/wow/class-guides',
    detail: 'Tier lists, BiS contextual y notas de uso.',
  },
];

export function getSourceStatus() {
  const hasWcl = Boolean(process.env.WARCRAFTLOGS_CLIENT_ID && process.env.WARCRAFTLOGS_CLIENT_SECRET);
  return sourceCatalog.map((source) => ({
    ...source,
    status: source.id === 'raiderio' ? 'ready'
      : source.id === 'warcraftlogs' && hasWcl ? 'ready'
      : source.id === 'bloodmallet' ? 'dataset'
      : source.id === 'warcraftlogs' ? 'credentials-required'
      : 'reference-only',
  }));
}

export async function getRaiderIoCharacter({ region, realm, name }) {
  const params = new URLSearchParams({ region, realm, name, fields: 'gear,raid_progression,mythic_plus_scores_by_season:current' });
  return jsonFetch(`https://raider.io/api/v1/characters/profile?${params}`);
}

let wclToken = null;
let wclTokenExpiry = 0;
async function getWarcraftLogsToken() {
  if (wclToken && Date.now() < wclTokenExpiry) return wclToken;
  const id = process.env.WARCRAFTLOGS_CLIENT_ID;
  const secret = process.env.WARCRAFTLOGS_CLIENT_SECRET;
  if (!id || !secret) throw new Error('Faltan credenciales de Warcraft Logs');
  const auth = Buffer.from(`${id}:${secret}`).toString('base64');
  const data = await jsonFetch('https://www.warcraftlogs.com/oauth/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  wclToken = data.access_token;
  wclTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return wclToken;
}

export async function queryWarcraftLogs(query, variables = {}) {
  const token = await getWarcraftLogsToken();
  return jsonFetch('https://www.warcraftlogs.com/api/v2/client', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
}
