import assert from 'node:assert/strict';
import { request } from 'node:http';
import { afterEach, test } from 'node:test';

import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

process.env.PRESSCART_API_URL = 'https://api.presscart.test';
process.env.MCP_INTERNAL_AUTH_TOKEN = 'internal-token-placeholder';

const { createHttpApp } = await import('./http-app.js');
const {
  apiJson,
  initializeRequest,
  initializeSession,
  listToolNames,
  listenOnLoopback,
  sendMcp,
  sessionHeaders,
  stubPresscartApi,
  TEST_PRESSCART_API_SETTINGS,
} = await import('./http-app.fixtures.js');

type HttpAppConfig = Parameters<typeof createHttpApp>[0];

const API_TOKEN = 'api-token-placeholder';
const TEAM_ID = '0b6b1a52-7c0e-4a39-9d55-1f6a3c0f0a01';
const MCP_SERVER_URL = new URL('https://mcp.presscart.test/mcp');
const ALLOWED_ORIGIN = 'https://mcp.presscart.test';
const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function baseConfig(overrides: Partial<HttpAppConfig> = {}): HttpAppConfig {
  return {
    host: '127.0.0.1',
    mcpServerUrl: MCP_SERVER_URL,
    allowedOrigins: [ALLOWED_ORIGIN],
    sessionIdleTtlMs: 60_000,
    ...TEST_PRESSCART_API_SETTINGS,
    ...overrides,
  };
}

async function start(config: HttpAppConfig) {
  const httpApp = createHttpApp(config);
  const server = await listenOnLoopback(httpApp.app);
  cleanups.push(async () => {
    await httpApp.closeAllSessions();
    await server.close();
  });
  return { httpApp, base: server.base };
}

function stubApi() {
  const api = stubPresscartApi(call => {
    if (call.url.pathname === '/auth/token') {
      return apiJson({
        source: 'api_token',
        team_id: TEAM_ID,
        token_type: 'api_token',
        scopes: ['teams.lists'],
        pro_pricing_enabled: false,
      });
    }
    if (call.url.pathname === '/teams') return apiJson({ records: [], total_records: 0 });
    return apiJson({ error: 'unexpected' }, 404);
  });
  cleanups.push(api.restore);
  return api;
}

function oauthAuthInfo(token: string): AuthInfo {
  return {
    token,
    clientId: 'client-1',
    scopes: ['profile'],
    expiresAt: Math.floor(Date.now() / 1000) + 3_600,
    extra: { source: 'mcp', sub: 'user-1', oauth_grant_id: 'grant-1' },
  };
}

function oauthConfig(verifiedTokens: string[] = ['access-good']): NonNullable<HttpAppConfig['oauth']> {
  const verifier: OAuthTokenVerifier = {
    async verifyAccessToken(token) {
      if (!verifiedTokens.includes(token)) throw new InvalidTokenError('Invalid or expired token');
      return oauthAuthInfo(token);
    },
  };
  return {
    issuer: new URL('https://project.supabase.co/auth/v1'),
    resource: MCP_SERVER_URL,
    audiences: [MCP_SERVER_URL],
    translatorEnabled: false,
    upstreamTimeoutMs: 1_000,
    createVerifier: () => verifier,
  };
}

test('legacy /mcp initializes, lists 54 tools, calls a tool, streams, and deletes with an API token', async () => {
  const api = stubApi();
  const { base, httpApp } = await start(baseConfig());
  const tokenHeader = { 'x-presscart-api-token': API_TOKEN };

  const sessionId = await initializeSession(base, '/mcp', tokenHeader);
  assert.equal(httpApp.sessions.size, 1);
  assert.equal((await listToolNames(base, '/mcp', sessionId)).length, 54);

  const call = await sendMcp(base, '/mcp', {
    body: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_teams', arguments: {} } },
    headers: sessionHeaders(sessionId),
  });
  assert.equal(call.status, 200);
  const teamsCall = api.calls.find(entry => entry.url.pathname === '/teams');
  assert.ok(teamsCall);
  assert.equal(teamsCall.headers.get('authorization'), `Bearer ${API_TOKEN}`);

  const controller = new AbortController();
  const stream = await fetch(`${base}/mcp`, {
    headers: { accept: 'text/event-stream', ...sessionHeaders(sessionId) },
    signal: controller.signal,
  });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get('content-type') ?? '', /text\/event-stream/);
  controller.abort();

  const deleted = await sendMcp(base, '/mcp', { method: 'DELETE', headers: sessionHeaders(sessionId) });
  assert.equal(deleted.status, 200);
  assert.equal(httpApp.sessions.size, 0);

  const afterDelete = await sendMcp(base, '/mcp', {
    body: { jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} },
    headers: sessionHeaders(sessionId),
  });
  assert.equal(afterDelete.status, 404);
  assert.deepEqual(afterDelete.body, {
    jsonrpc: '2.0',
    error: { code: -32001, message: 'Session not found' },
    id: null,
  });
});

test('legacy /mcp keeps its request validation errors', async () => {
  stubApi();
  const { base } = await start(baseConfig());

  const noSession = await sendMcp(base, '/mcp', {
    body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  });
  assert.equal(noSession.status, 400);
  assert.deepEqual(noSession.body, {
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Bad Request: Mcp-Session-Id header is required' },
    id: null,
  });

  const unknownSession = await sendMcp(base, '/mcp', {
    body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    headers: sessionHeaders('00000000-0000-4000-8000-000000000000'),
  });
  assert.equal(unknownSession.status, 404);

  const bearerWithoutOAuth = await sendMcp(base, '/mcp', {
    body: initializeRequest(),
    headers: { authorization: 'Bearer something' },
  });
  assert.equal(bearerWithoutOAuth.status, 400);
  assert.deepEqual(bearerWithoutOAuth.body, {
    jsonrpc: '2.0',
    error: {
      code: -32000,
      message:
        'Authorization is reserved for MCP OAuth. Use X-Presscart-API-Token to provide the upstream Presscart credential.',
    },
    id: null,
  });

  const getWithoutSession = await sendMcp(base, '/mcp', { method: 'GET' });
  assert.equal(getWithoutSession.status, 400);

  const put = await sendMcp(base, '/mcp', { method: 'PUT', body: {} });
  assert.equal(put.status, 405);
  assert.deepEqual(put.body, {
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed' },
    id: null,
  });

  const health = await fetch(`${base}/health`);
  assert.deepEqual(await health.json(), { ok: true });
  assert.equal((await fetch(`${base}/elsewhere`)).status, 404);
});

test('legacy /mcp keeps CORS preflight and origin validation', async () => {
  stubApi();
  const { base } = await start(baseConfig());

  const preflight = await fetch(`${base}/mcp`, {
    method: 'OPTIONS',
    headers: {
      origin: ALLOWED_ORIGIN,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type, mcp-session-id',
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);
  assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET, POST, DELETE, OPTIONS');
  assert.equal(preflight.headers.get('access-control-allow-headers'), 'content-type, mcp-session-id');

  const blocked = await sendMcp(base, '/mcp', {
    body: initializeRequest(),
    headers: { origin: 'https://attacker.example', 'x-presscart-api-token': API_TOKEN },
  });
  assert.equal(blocked.status, 403);
  assert.deepEqual(blocked.body, {
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Invalid Origin header' },
    id: null,
  });
});

test('cleanupExpiredState closes sessions idle past the TTL', async () => {
  stubApi();
  const { base, httpApp } = await start(baseConfig({ sessionIdleTtlMs: 1_000 }));
  await initializeSession(base, '/mcp', { 'x-presscart-api-token': API_TOKEN });
  assert.equal(httpApp.sessions.size, 1);

  httpApp.cleanupExpiredState(Date.now() + 500);
  assert.equal(httpApp.sessions.size, 1);
  httpApp.cleanupExpiredState(Date.now() + 5_000);
  assert.equal(httpApp.sessions.size, 0);
});

test('legacy /mcp with OAuth challenges with the canonical metadata URL and accepts verified tokens', async () => {
  stubApi();
  const { base } = await start(baseConfig({ oauth: oauthConfig() }));

  const unauthenticated = await sendMcp(base, '/mcp', { body: initializeRequest() });
  assert.equal(unauthenticated.status, 401);
  assert.match(
    unauthenticated.headers.get('www-authenticate') ?? '',
    /resource_metadata="https:\/\/mcp\.presscart\.test\/\.well-known\/oauth-protected-resource\/mcp"/,
  );

  const legacyHeader = await sendMcp(base, '/mcp', {
    body: initializeRequest(),
    headers: { authorization: 'Bearer access-good', 'x-presscart-api-token': API_TOKEN },
  });
  assert.equal(legacyHeader.status, 400);

  const sessionId = await initializeSession(base, '/mcp', { authorization: 'Bearer access-good' });
  assert.equal(
    (await listToolNames(base, '/mcp', sessionId, { authorization: 'Bearer access-good' })).length,
    54,
  );

  const metadata = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);
  assert.equal(metadata.status, 200);
  assert.equal(((await metadata.json()) as { resource: string }).resource, MCP_SERVER_URL.href);
});

const CHALLENGE_PATH = '/.well-known/openai-apps-challenge';
const CHALLENGE_TOKEN = 'openai-challenge-placeholder';

// fetch ignores a caller-supplied Host header, so host-allowlist checks go through node:http.
function getWithHeaders(url: string, headers: Record<string, string>) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(url, { headers }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('serves the OpenAI apps challenge token as exact plain text without OAuth', async () => {
  const { base } = await start(baseConfig({ oauth: oauthConfig(), openaiAppsChallengeToken: CHALLENGE_TOKEN }));

  const challenge = await fetch(`${base}${CHALLENGE_PATH}`);
  assert.equal(challenge.status, 200);
  assert.equal(challenge.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(challenge.headers.get('cache-control'), 'no-store');
  assert.equal(challenge.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(await challenge.text(), CHALLENGE_TOKEN);

  const head = await fetch(`${base}${CHALLENGE_PATH}`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(head.headers.get('content-length'), String(CHALLENGE_TOKEN.length));
  assert.equal(await head.text(), '');
});

test('serves the OpenAI apps challenge on allowlisted hosts regardless of Origin', async () => {
  const { base } = await start(baseConfig({
    allowedHosts: ['mcp.presscart.test'],
    openaiAppsChallengeToken: CHALLENGE_TOKEN,
  }));

  const publicHost = await getWithHeaders(`${base}${CHALLENGE_PATH}`, {
    host: 'mcp.presscart.test',
    origin: 'https://platform.openai.com',
  });
  assert.equal(publicHost.status, 200);
  assert.equal(publicHost.body, CHALLENGE_TOKEN);

  const otherHost = await getWithHeaders(`${base}${CHALLENGE_PATH}`, { host: 'other.presscart.test' });
  assert.equal(otherHost.status, 403);
});

test('returns 404 for the OpenAI apps challenge when no token is configured', async () => {
  for (const openaiAppsChallengeToken of [undefined, '']) {
    const { base } = await start(baseConfig({ openaiAppsChallengeToken }));
    const challenge = await fetch(`${base}${CHALLENGE_PATH}`);
    assert.equal(challenge.status, 404, `token=${JSON.stringify(openaiAppsChallengeToken)}`);
    assert.deepEqual(await challenge.json(), { error: 'Not found' });
  }
});

test('serves the OpenAI apps challenge only on GET and HEAD at the exact path', async () => {
  const { base } = await start(baseConfig({ openaiAppsChallengeToken: CHALLENGE_TOKEN }));

  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    const response = await fetch(`${base}${CHALLENGE_PATH}`, { method });
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get('allow'), 'GET, HEAD', method);
    assert.deepEqual(await response.json(), { error: 'Method not allowed' }, method);
  }

  for (const variant of [`${CHALLENGE_PATH}/`, CHALLENGE_PATH.toUpperCase()]) {
    assert.equal((await fetch(`${base}${variant}`)).status, 404, variant);
  }
});

test('serves the MCP Server Card publicly at /mcp/server-card, with caching and open CORS, even with OAuth on', async () => {
  const { base } = await start(baseConfig({ oauth: oauthConfig() }));

  const response = await fetch(`${base}/mcp/server-card`, {
    headers: { accept: 'application/mcp-server-card+json', origin: 'https://not-allowed.example' },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^application\/mcp-server-card\+json/);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=3600');
  const card = (await response.json()) as { name: string; remotes: Array<{ url: string }> };
  assert.equal(card.name, 'com.presscart/presscart');
  assert.deepEqual(card.remotes.map(remote => remote.url), [MCP_SERVER_URL.href]);

  const etag = response.headers.get('etag');
  assert.ok(etag);
  const revalidated = await fetch(`${base}/mcp/server-card`, { headers: { 'if-none-match': etag } });
  assert.equal(revalidated.status, 304);

  const preflight = await fetch(`${base}/mcp/server-card`, { method: 'OPTIONS', headers: { origin: 'https://not-allowed.example' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
});

test('the Server Card route does not open the MCP endpoint itself', async () => {
  const { base } = await start(baseConfig({ oauth: oauthConfig() }));
  const response = await sendMcp(base, '/mcp', { method: 'POST', body: initializeRequest() });
  assert.equal(response.status, 401);
});
