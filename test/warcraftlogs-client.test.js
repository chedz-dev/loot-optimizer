import test from 'node:test';
import assert from 'node:assert/strict';
import { createWarcraftLogsClient } from '../server/warcraftlogs-client.js';

const credentials = { WARCRAFTLOGS_CLIENT_ID: 'test-client', WARCRAFTLOGS_CLIENT_SECRET: 'test-only-secret' };
const tokenUrl = 'https://www.warcraftlogs.com/oauth/token';
const apiUrl = 'https://www.warcraftlogs.com/api/v2/client';
const response = (body, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers(headers),
  json: async () => structuredClone(body),
});
const oauth = (token = 'test-only-access-token', expires = 3600) => response({ access_token: token, expires_in: expires });
const success = (data = { worldData: { zones: [] } }) => response({ data });

test('WCL client requires server credentials without making a network request', async () => {
  let requests = 0;
  const client = createWarcraftLogsClient({ env: {}, fetchImpl: async () => { requests += 1; } });
  await assert.rejects(client.query('{ worldData { zones { id } } }'), { code: 'CREDENTIALS_REQUIRED', status: 503 });
  assert.equal(requests, 0);
  assert.deepEqual(client.status(), { configured: false, rateLimit: null });
});

test('WCL client shares OAuth requests and keeps credentials out of GraphQL bodies and public status', async () => {
  const calls = [];
  const client = createWarcraftLogsClient({ env: credentials, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    await new Promise((resolve) => setImmediate(resolve));
    return url === tokenUrl ? oauth() : success();
  } });
  const queryText = 'query Example($zone: Int!) { worldData { zone(id: $zone) { id } } }';
  await Promise.all([client.query(queryText, { zone: 42 }), client.query(queryText, { zone: 43 })]);
  await client.query(queryText, { zone: 44 });

  const tokens = calls.filter((call) => call.url === tokenUrl);
  const queries = calls.filter((call) => call.url === apiUrl);
  assert.equal(tokens.length, 1);
  assert.equal(queries.length, 3);
  assert.equal(tokens[0].options.body, 'grant_type=client_credentials');
  assert.equal(tokens[0].options.headers.Authorization, `Basic ${Buffer.from('test-client:test-only-secret').toString('base64')}`);
  for (const call of queries) {
    assert.equal(call.options.headers.Authorization, 'Bearer test-only-access-token');
    assert.equal(JSON.parse(call.options.body).query, queryText);
    assert.equal(call.options.body.includes(credentials.WARCRAFTLOGS_CLIENT_SECRET), false);
  }
  assert.deepEqual(client.status(), { configured: true, rateLimit: null });
});

test('WCL client renews an expiring OAuth token before its advertised expiry', async () => {
  let clock = Date.parse('2026-09-07T00:00:00Z');
  let tokenRequests = 0;
  const client = createWarcraftLogsClient({ env: credentials, now: () => clock, fetchImpl: async (url) => {
    if (url === tokenUrl) { tokenRequests += 1; return oauth(`test-token-${tokenRequests}`, 120); }
    return success();
  } });
  await client.query('{ test }');
  clock += 59_999;
  await client.query('{ test }');
  assert.equal(tokenRequests, 1);
  clock += 1;
  await client.query('{ test }');
  assert.equal(tokenRequests, 2);
});

test('WCL client refreshes OAuth once after HTTP 401 and retries the same query', async () => {
  let tokenRequests = 0;
  const apiCalls = [];
  const client = createWarcraftLogsClient({ env: credentials, fetchImpl: async (url, options) => {
    if (url === tokenUrl) { tokenRequests += 1; return oauth(`test-token-${tokenRequests}`); }
    apiCalls.push(options);
    return apiCalls.length === 1 ? response({}, 401) : success({ result: 'ok' });
  } });
  assert.deepEqual(await client.query('query Test($id: Int!) { test(id: $id) }', { id: 7 }), { result: 'ok' });
  assert.equal(tokenRequests, 2);
  assert.equal(apiCalls.length, 2);
  assert.equal(apiCalls[0].body, apiCalls[1].body);
  assert.equal(apiCalls[0].headers.Authorization, 'Bearer test-token-1');
  assert.equal(apiCalls[1].headers.Authorization, 'Bearer test-token-2');
});

test('WCL client stops after a second HTTP 401', async () => {
  let tokenRequests = 0;
  let apiRequests = 0;
  const client = createWarcraftLogsClient({ env: credentials, fetchImpl: async (url) => {
    if (url === tokenUrl) { tokenRequests += 1; return oauth(); }
    apiRequests += 1;
    return response({ error: credentials.WARCRAFTLOGS_CLIENT_SECRET }, 401);
  } });
  await assert.rejects(client.query('{ test }'), (error) => {
    assert.equal(error.message.includes(credentials.WARCRAFTLOGS_CLIENT_SECRET), false);
    return true;
  });
  assert.equal(tokenRequests, 2);
  assert.equal(apiRequests, 2);
});

test('WCL client rejects partial GraphQL results without returning upstream error text', async () => {
  const client = createWarcraftLogsClient({ env: credentials, fetchImpl: async (url) => url === tokenUrl ? oauth() : response({
    data: { worldData: { zones: [] } },
    errors: [{ message: `A server echoed ${credentials.WARCRAFTLOGS_CLIENT_SECRET}` }],
  }) });
  await assert.rejects(client.query('{ test }'), (error) => {
    assert.equal(error.code, 'GRAPHQL_ERROR');
    assert.equal(error.message.includes(credentials.WARCRAFTLOGS_CLIENT_SECRET), false);
    assert.equal(error.message.includes('A server echoed'), false);
    return true;
  });
});

test('WCL client sanitizes network and OAuth failures', async (t) => {
  await t.test('network exception', async () => {
    const client = createWarcraftLogsClient({ env: credentials, fetchImpl: async () => {
      throw new Error(`URL contained ${credentials.WARCRAFTLOGS_CLIENT_SECRET}`);
    } });
    await assert.rejects(client.query('{ test }'), (error) => {
      assert.equal(error.code, 'NETWORK_ERROR');
      assert.equal(error.message.includes(credentials.WARCRAFTLOGS_CLIENT_SECRET), false);
      return true;
    });
  });
  await t.test('OAuth refusal', async () => {
    let bodyRead = false;
    const client = createWarcraftLogsClient({ env: credentials, fetchImpl: async () => ({
      ok: false, status: 401,
      json: async () => { bodyRead = true; return { message: credentials.WARCRAFTLOGS_CLIENT_SECRET }; },
    }) });
    await assert.rejects(client.query('{ test }'), { code: 'AUTH_FAILED' });
    assert.equal(bodyRead, false);
  });
});

test('WCL client reports malformed OAuth and API JSON as invalid responses', async (t) => {
  await t.test('OAuth body', async () => {
    const client = createWarcraftLogsClient({ env: credentials, fetchImpl: async () => response({ token: 'wrong-field' }) });
    await assert.rejects(client.query('{ test }'), { code: 'INVALID_RESPONSE' });
  });
  await t.test('API JSON parse', async () => {
    const client = createWarcraftLogsClient({ env: credentials, fetchImpl: async (url) => url === tokenUrl ? oauth() : {
      ok: true, status: 200, json: async () => { throw new SyntaxError('invalid json'); },
    } });
    await assert.rejects(client.query('{ test }'), { code: 'INVALID_RESPONSE' });
  });
  await t.test('missing API data', async () => {
    const client = createWarcraftLogsClient({ env: credentials, fetchImpl: async (url) => url === tokenUrl ? oauth() : response({}) });
    await assert.rejects(client.query('{ test }'), { code: 'INVALID_RESPONSE' });
  });
});

test('WCL HTTP 429 cooldown respects Retry-After and avoids repeated requests', async () => {
  let clock = 0;
  let apiRequests = 0;
  const client = createWarcraftLogsClient({ env: credentials, now: () => clock, fetchImpl: async (url) => {
    if (url === tokenUrl) return oauth();
    apiRequests += 1;
    return apiRequests === 1 ? response({}, 429, { 'retry-after': '120' }) : success();
  } });
  await assert.rejects(client.query('{ test }'), { code: 'RATE_LIMITED', status: 429, retryAt: 120_000 });
  clock = 119_999;
  await assert.rejects(client.query('{ test }'), { code: 'RATE_LIMITED', status: 429 });
  assert.equal(apiRequests, 1);
  clock = 120_000;
  await client.query('{ test }');
  assert.equal(apiRequests, 2);
});

test('WCL client uses returned point budget and waits for its reset when exhausted', async () => {
  let clock = 0;
  let apiRequests = 0;
  const limit = { limitPerHour: 12, pointsSpentThisHour: 12, pointsResetIn: 30 };
  const client = createWarcraftLogsClient({ env: credentials, now: () => clock, fetchImpl: async (url) => {
    if (url === tokenUrl) return oauth();
    apiRequests += 1;
    return apiRequests === 1 ? success({ rateLimitData: limit }) : success();
  } });
  await client.query('{ rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn } }');
  assert.deepEqual(client.status(), { configured: true, rateLimit: limit });
  clock = 29_999;
  await assert.rejects(client.query('{ test }'), { code: 'RATE_LIMITED' });
  assert.equal(apiRequests, 1);
  clock = 30_000;
  await client.query('{ test }');
  assert.equal(apiRequests, 2);
});

test('WCL HTTP-date Retry-After is propagated for durable provider backoff', async () => {
  const clock = Date.parse('2026-09-07T19:00:00.000Z');
  const retryAt = clock + 3_600_000;
  const client = createWarcraftLogsClient({ env: credentials, now: () => clock, fetchImpl: async (url) =>
    url === tokenUrl ? oauth() : response({}, 429, { 'retry-after': new Date(retryAt).toUTCString() }) });
  await assert.rejects(client.query('{ test }'), { code: 'RATE_LIMITED', retryAt });
});
