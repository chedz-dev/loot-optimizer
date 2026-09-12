import { warcraftLogsClient } from './warcraftlogs-client.js';

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
      : source.id === 'warcraftlogs' && hasWcl ? 'configured'
      : source.id === 'bloodmallet' ? 'dataset'
      : source.id === 'warcraftlogs' ? 'credentials-required'
      : 'reference-only',
  }));
}

export async function getRaiderIoCharacter({ region, realm, name }) {
  const params = new URLSearchParams({ region, realm, name, fields: 'gear,raid_progression,mythic_plus_scores_by_season:current' });
  return jsonFetch(`https://raider.io/api/v1/characters/profile?${params}`);
}

export async function queryWarcraftLogs(query, variables = {}) {
  return { data: await warcraftLogsClient.query(query, variables) };
}
