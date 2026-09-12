const API_URL = 'https://www.warcraftlogs.com/api/v2/client';
const TOKEN_URL = 'https://www.warcraftlogs.com/oauth/token';

export class WarcraftLogsError extends Error {
  constructor(message, code = 'UPSTREAM_ERROR', status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function createWarcraftLogsClient({ fetchImpl = fetch, env = process.env, now = Date.now } = {}) {
  let token;
  let expiresAt = 0;
  let tokenRequest;
  let rateLimit = null;
  let quotaResetsAt = 0;

  const configured = () => Boolean(env.WARCRAFTLOGS_CLIENT_ID?.trim() && env.WARCRAFTLOGS_CLIENT_SECRET?.trim());
  const rateLimitError = (message) => Object.assign(new WarcraftLogsError(message, 'RATE_LIMITED', 429), { retryAt: quotaResetsAt });
  async function request(url, options) {
    try {
      return await fetchImpl(url, { ...options, signal: AbortSignal.timeout(30_000) });
    } catch {
      throw new WarcraftLogsError('No se pudo conectar con Warcraft Logs. Inténtalo de nuevo.', 'NETWORK_ERROR');
    }
  }

  async function authorize() {
    if (!configured()) throw new WarcraftLogsError('Configura las credenciales de Warcraft Logs en el archivo local .env.', 'CREDENTIALS_REQUIRED', 503);
    if (token && now() < expiresAt) return token;
    if (tokenRequest) return tokenRequest;
    tokenRequest = (async () => {
      const authorization = Buffer.from(`${env.WARCRAFTLOGS_CLIENT_ID}:${env.WARCRAFTLOGS_CLIENT_SECRET}`).toString('base64');
      const response = await request(TOKEN_URL, {
        method: 'POST', headers: { Authorization: `Basic ${authorization}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
      });
      if (!response.ok) throw new WarcraftLogsError('Warcraft Logs no pudo autorizar las credenciales locales.', 'AUTH_FAILED', 502);
      let data;
      try { data = await response.json(); } catch { throw new WarcraftLogsError('Respuesta OAuth no válida de Warcraft Logs.', 'INVALID_RESPONSE'); }
      if (!data.access_token || !Number.isFinite(Number(data.expires_in))) throw new WarcraftLogsError('Respuesta OAuth no válida de Warcraft Logs.', 'INVALID_RESPONSE');
      token = data.access_token;
      expiresAt = now() + Math.max(0, Number(data.expires_in) - 60) * 1000;
      return token;
    })();
    try { return await tokenRequest; } finally { tokenRequest = null; }
  }

  async function query(queryText, variables = {}) {
    if (now() < quotaResetsAt) throw rateLimitError('Se agotó la cuota de Warcraft Logs. Se conserva la última captura disponible.');
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const accessToken = await authorize();
      const response = await request(API_URL, {
        method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: queryText, variables }),
      });
      if (response.status === 401 && attempt === 0) { token = null; expiresAt = 0; continue; }
      if (response.status === 429) {
        const retryAfter = response.headers?.get('retry-after');
        const seconds = Number(retryAfter);
        const retryDate = Date.parse(retryAfter);
        const resetAt = retryAfter && Number.isFinite(seconds) ? now() + Math.max(1, seconds) * 1000
          : Number.isFinite(retryDate) ? retryDate : now() + 60_000;
        quotaResetsAt = Math.max(quotaResetsAt, now() + 1000, resetAt);
        throw rateLimitError('Se alcanzó el límite de consultas de Warcraft Logs.');
      }
      if (!response.ok) throw new WarcraftLogsError(`Warcraft Logs respondió con HTTP ${response.status}.`, 'UPSTREAM_ERROR');
      let payload;
      try { payload = await response.json(); } catch { throw new WarcraftLogsError('Warcraft Logs devolvió una respuesta no válida.', 'INVALID_RESPONSE'); }
      // Never return partial GraphQL data as a successful capture or expose upstream error bodies.
      if (payload.errors?.length) throw new WarcraftLogsError('Warcraft Logs rechazó la consulta. No se reemplazó la captura anterior.', 'GRAPHQL_ERROR');
      if (!payload.data) throw new WarcraftLogsError('Warcraft Logs no devolvió datos.', 'INVALID_RESPONSE');
      if (payload.data.rateLimitData) {
        rateLimit = payload.data.rateLimitData;
        if (rateLimit.pointsSpentThisHour >= rateLimit.limitPerHour) quotaResetsAt = now() + rateLimit.pointsResetIn * 1000;
      }
      return payload.data;
    }
    throw new WarcraftLogsError('Warcraft Logs rechazó la autenticación.', 'AUTH_FAILED');
  }
  return { query, configured, status: () => ({ configured: configured(), rateLimit }) };
}

export const warcraftLogsClient = createWarcraftLogsClient();
