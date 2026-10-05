import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

process.env.PRESSCART_API_URL = 'https://api.presscart.test';
process.env.MCP_INTERNAL_AUTH_TOKEN = 'internal-token-placeholder';
delete process.env.PRESSCART_APP_URL;

const { createHttpApp } = await import('./http-app.js');
const { DIRECTORY_PROFILES, STAGE_A_TOOLS } = await import('./directory/policy.js');
const {
  apiJson,
  initializeRequest,
  initializeSession,
  listToolNames,
  listenOnLoopback,
  sendMcp,
  sessionHeaders,
  stubPresscartApi,
} = await import('./http-app.fixtures.js');

type HttpAppConfig = Parameters<typeof createHttpApp>[0];
type OAuthConfig = NonNullable<HttpAppConfig['oauth']>;

const API_TOKEN = 'api-token-placeholder';
const TEAM_ID = '0b6b1a52-7c0e-4a39-9d55-1f6a3c0f0a01';
const CANONICAL = new URL('https://mcp.presscart.test/mcp');
const OPENAI = 'https://mcp.presscart.test/mcp/openai';
const ALLOWED_ORIGIN = 'https://mcp.presscart.test';
const tokenHeader = { 'x-presscart-api-token': API_TOKEN };
const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function start(overrides: Partial<HttpAppConfig> = {}) {
  const httpApp = createHttpApp({
    host: '127.0.0.1',
    mcpServerUrl: CANONICAL,
    allowedOrigins: [ALLOWED_ORIGIN],
    sessionIdleTtlMs: 60_000,
    directoryProfiles: [DIRECTORY_PROFILES.openai, DIRECTORY_PROFILES['claude-directory']],
    ...overrides,
  });
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
    if (call.url.pathname === '/teams') {
      return apiJson({
        records: [{ id: TEAM_ID, name: 'Acme Media', slug: 'acme-media', billing_email: 'billing@example.com' }],
        total_records: 1,
        total_pages: 1,
        current_page: 1,
        next_page: null,
        previous_page: null,
      });
    }
    return apiJson({ error: 'unexpected' }, 404);
  });
  cleanups.push(api.restore);
  return api;
}

const STAGE_A = [...STAGE_A_TOOLS];

test('each route lists only its own tool surface', async () => {
  stubApi();
  const { base, httpApp } = await start();

  const legacy = await initializeSession(base, '/mcp', tokenHeader);
  const openai = await initializeSession(base, '/mcp/openai', tokenHeader);
  const claude = await initializeSession(base, '/mcp/claude-directory', tokenHeader);

  assert.equal((await listToolNames(base, '/mcp', legacy)).length, 54);
  assert.deepEqual(await listToolNames(base, '/mcp/openai', openai), STAGE_A);
  assert.deepEqual(await listToolNames(base, '/mcp/claude-directory', claude), STAGE_A);
  assert.equal(httpApp.sessions.get(legacy)?.profile, 'legacy');
  assert.equal(httpApp.sessions.get(openai)?.profile, 'openai');
  assert.equal(httpApp.sessions.get(claude)?.profile, 'claude-directory');
});

test('a session cannot be driven through another route in any direction', async () => {
  stubApi();
  const { base, httpApp } = await start();
  const sessions = {
    '/mcp': await initializeSession(base, '/mcp', tokenHeader),
    '/mcp/openai': await initializeSession(base, '/mcp/openai', tokenHeader),
    '/mcp/claude-directory': await initializeSession(base, '/mcp/claude-directory', tokenHeader),
  };
  const paths = Object.keys(sessions) as Array<keyof typeof sessions>;

  for (const owner of paths) {
    for (const target of paths) {
      if (owner === target) continue;
      const sessionId = sessions[owner];
      const label = `${owner} session on ${target}`;

      const post = await sendMcp(base, target, {
        body: { jsonrpc: '2.0', id: 9, method: 'tools/list', params: {} },
        headers: sessionHeaders(sessionId),
      });
      assert.equal(post.status, 404, `POST ${label}`);
      assert.deepEqual(post.body, {
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Session not found' },
        id: null,
      });
      assert.equal((await sendMcp(base, target, { method: 'GET', headers: sessionHeaders(sessionId) })).status, 404, `GET ${label}`);
      assert.equal((await sendMcp(base, target, { method: 'DELETE', headers: sessionHeaders(sessionId) })).status, 404, `DELETE ${label}`);
    }
  }

  assert.equal(httpApp.sessions.size, 3);
  assert.equal((await listToolNames(base, '/mcp', sessions['/mcp'])).length, 54);
  assert.deepEqual(await listToolNames(base, '/mcp/openai', sessions['/mcp/openai']), STAGE_A);
});

test('a disabled profile path is not mounted', async () => {
  stubApi();
  const { base } = await start({ directoryProfiles: [DIRECTORY_PROFILES.openai] });

  const initialize = await sendMcp(base, '/mcp/claude-directory', {
    body: initializeRequest(),
    headers: tokenHeader,
  });
  assert.equal(initialize.status, 404);
  assert.deepEqual(initialize.body, { error: 'Not found' });
  assert.equal((await sendMcp(base, '/mcp/claude-directory', { method: 'GET' })).status, 404);
  assert.equal((await sendMcp(base, '/mcp/claude-directory', { method: 'DELETE' })).status, 404);

  const none = await start({ directoryProfiles: [] });
  assert.equal(
    (await sendMcp(none.base, '/mcp/openai', { body: initializeRequest(), headers: tokenHeader })).status,
    404,
  );
});

test('no header, query parameter, user agent, or body field changes the session profile', async () => {
  stubApi();
  const { base, httpApp } = await start();
  const spoofHeaders = {
    ...tokenHeader,
    'x-presscart-profile': 'legacy',
    'x-mcp-profile': 'legacy',
    'user-agent': 'presscart-legacy-client profile=legacy',
  };
  const spoofedInitialize = {
    ...initializeRequest(),
    params: { ...initializeRequest().params, profile: 'legacy', _meta: { profile: 'legacy' } },
  };

  const directory = await sendMcp(base, '/mcp/openai?profile=legacy', {
    body: spoofedInitialize,
    headers: spoofHeaders,
  });
  assert.equal(directory.status, 200);
  const directorySession = directory.headers.get('mcp-session-id');
  assert.ok(directorySession);
  assert.equal(httpApp.sessions.get(directorySession)?.profile, 'openai');
  assert.deepEqual(
    await listToolNames(base, '/mcp/openai', directorySession, { 'x-presscart-profile': 'legacy' }),
    STAGE_A,
  );

  const legacy = await sendMcp(base, '/mcp?profile=openai', {
    body: { ...initializeRequest(), params: { ...initializeRequest().params, profile: 'openai' } },
    headers: { ...tokenHeader, 'x-presscart-profile': 'openai' },
  });
  const legacySession = legacy.headers.get('mcp-session-id');
  assert.ok(legacySession);
  assert.equal(httpApp.sessions.get(legacySession)?.profile, 'legacy');
  assert.equal((await listToolNames(base, '/mcp', legacySession)).length, 54);
});

test('directory tools run through HTTP and excluded tools never reach the API', async () => {
  const api = stubApi();
  const { base } = await start();
  const sessionId = await initializeSession(base, '/mcp/openai', tokenHeader);

  const listTeams = await sendMcp(base, '/mcp/openai', {
    body: { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'list_teams', arguments: {} } },
    headers: sessionHeaders(sessionId),
  });
  assert.equal(listTeams.status, 200);
  assert.deepEqual((listTeams.body as { result: { structuredContent: unknown } }).result.structuredContent, {
    records: [
      { id: TEAM_ID, name: 'Acme Media', slug: 'acme-media', type: null, is_publisher: null, role: null, profiles: null },
    ],
    total_records: 1,
    total_pages: 1,
    current_page: 1,
    next_page: null,
    previous_page: null,
  });

  const callsBefore = api.calls.length;
  const createOrder = await sendMcp(base, '/mcp/openai', {
    body: { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'create_order', arguments: {} } },
    headers: sessionHeaders(sessionId),
  });
  assert.equal(createOrder.status, 200);
  const result = (createOrder.body as { result: { isError: boolean; content: Array<{ text: string }> } }).result;
  assert.equal(result.isError, true);
  assert.match(result.content[0]?.text ?? '', /Tool create_order not found/);
  assert.equal(api.calls.length, callsBefore);
});

test('directory paths get CORS preflight, origin validation, and the 405 fallback', async () => {
  stubApi();
  const { base } = await start();

  const preflight = await fetch(`${base}/mcp/openai`, {
    method: 'OPTIONS',
    headers: { origin: ALLOWED_ORIGIN, 'access-control-request-method': 'POST' },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);
  assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET, POST, DELETE, OPTIONS');

  const blocked = await sendMcp(base, '/mcp/claude-directory', {
    body: initializeRequest(),
    headers: { ...tokenHeader, origin: 'https://attacker.example' },
  });
  assert.equal(blocked.status, 403);

  const put = await sendMcp(base, '/mcp/openai', { method: 'PUT', body: {} });
  assert.equal(put.status, 405);
  assert.deepEqual(put.body, {
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed' },
    id: null,
  });
});

type TokenClaims = { aud: string; grant: string };

function oauthConfig(args: {
  acceptCanonical: boolean;
  tokens: Record<string, TokenClaims>;
  verifierCalls?: Array<{ resource: string; audiences: string[] }>;
}): OAuthConfig {
  return {
    issuer: new URL('https://project.supabase.co/auth/v1'),
    resource: CANONICAL,
    audiences: [CANONICAL],
    translatorEnabled: true,
    upstreamTimeoutMs: 1_000,
    acceptCanonicalAudienceOnDirectoryRoutes: args.acceptCanonical,
    // Fake verifier that enforces audiences the way the JWT verifier does.
    createVerifier: ({ resource, audiences }) => {
      args.verifierCalls?.push({ resource: resource.href, audiences: audiences.map(value => value.href) });
      return {
        async verifyAccessToken(token): Promise<AuthInfo> {
          const claims = args.tokens[token];
          if (claims === undefined || !audiences.some(audience => audience.href === claims.aud)) {
            throw new InvalidTokenError('Invalid or expired token');
          }
          return {
            token,
            clientId: 'client-1',
            scopes: ['profile'],
            expiresAt: Math.floor(Date.now() / 1000) + 3_600,
            resource,
            extra: { source: 'mcp', sub: 'user-1', oauth_grant_id: claims.grant },
          };
        },
      };
    },
  };
}

const TOKENS: Record<string, TokenClaims> = {
  'canonical-aud': { aud: CANONICAL.href, grant: 'grant-1' },
  'openai-aud': { aud: OPENAI, grant: 'grant-1' },
  'openai-aud-other-grant': { aud: OPENAI, grant: 'grant-2' },
};

test('each directory route challenges with its own protected-resource metadata', async () => {
  const { base } = await start({
    directoryProfiles: [DIRECTORY_PROFILES.openai],
    oauth: oauthConfig({ acceptCanonical: true, tokens: TOKENS }),
  });

  const directory = await sendMcp(base, '/mcp/openai', { body: initializeRequest() });
  assert.equal(directory.status, 401);
  assert.match(
    directory.headers.get('www-authenticate') ?? '',
    /resource_metadata="https:\/\/mcp\.presscart\.test\/\.well-known\/oauth-protected-resource\/mcp\/openai"/,
  );
  const legacy = await sendMcp(base, '/mcp', { body: initializeRequest() });
  assert.match(
    legacy.headers.get('www-authenticate') ?? '',
    /resource_metadata="https:\/\/mcp\.presscart\.test\/\.well-known\/oauth-protected-resource\/mcp"/,
  );

  const metadata = await fetch(`${base}/.well-known/oauth-protected-resource/mcp/openai`);
  assert.equal(metadata.status, 200);
  assert.equal(((await metadata.json()) as { resource: string }).resource, OPENAI);
  assert.equal((await fetch(`${base}/.well-known/oauth-protected-resource/mcp/claude-directory`)).status, 404);
  assert.equal((await fetch(`${base}/.well-known/oauth-authorization-server/mcp/openai`)).status, 200);
  assert.equal((await fetch(`${base}/.well-known/oauth-authorization-server/mcp/claude-directory`)).status, 404);
});

test('directory verifiers get their own audience plus the canonical one only while the flag is on', async () => {
  for (const acceptCanonical of [true, false]) {
    const verifierCalls: Array<{ resource: string; audiences: string[] }> = [];
    const { base } = await start({
      directoryProfiles: [DIRECTORY_PROFILES.openai],
      oauth: oauthConfig({ acceptCanonical, tokens: TOKENS, verifierCalls }),
    });

    assert.deepEqual(verifierCalls, [
      { resource: CANONICAL.href, audiences: [CANONICAL.href] },
      { resource: OPENAI, audiences: acceptCanonical ? [OPENAI, CANONICAL.href] : [OPENAI] },
    ]);

    const canonicalTokenOnDirectory = await sendMcp(base, '/mcp/openai', {
      body: initializeRequest(),
      headers: { authorization: 'Bearer canonical-aud' },
    });
    assert.equal(canonicalTokenOnDirectory.status, acceptCanonical ? 200 : 401, `flag=${acceptCanonical}`);

    const directoryTokenOnLegacy = await sendMcp(base, '/mcp', {
      body: initializeRequest(),
      headers: { authorization: 'Bearer openai-aud' },
    });
    assert.equal(directoryTokenOnLegacy.status, 401, `flag=${acceptCanonical}`);
  }
});

test('an OAuth directory session rejects API-token headers and names its own metadata on grant mismatch', async () => {
  const { base } = await start({
    directoryProfiles: [DIRECTORY_PROFILES.openai],
    oauth: oauthConfig({ acceptCanonical: true, tokens: TOKENS }),
  });

  const withApiToken = await sendMcp(base, '/mcp/openai', {
    body: initializeRequest(),
    headers: { authorization: 'Bearer openai-aud', ...tokenHeader },
  });
  assert.equal(withApiToken.status, 400);
  assert.deepEqual(withApiToken.body, {
    jsonrpc: '2.0',
    error: {
      code: -32000,
      message: 'X-Presscart-API-Token is not accepted on /mcp/openai when MCP OAuth is enabled.',
    },
    id: null,
  });

  const sessionId = await initializeSession(base, '/mcp/openai', { authorization: 'Bearer openai-aud' });
  assert.deepEqual(
    await listToolNames(base, '/mcp/openai', sessionId, { authorization: 'Bearer openai-aud' }),
    STAGE_A,
  );

  const mismatch = await sendMcp(base, '/mcp/openai', {
    body: { jsonrpc: '2.0', id: 7, method: 'tools/list', params: {} },
    headers: sessionHeaders(sessionId, { authorization: 'Bearer openai-aud-other-grant' }),
  });
  assert.equal(mismatch.status, 401);
  assert.match(
    mismatch.headers.get('www-authenticate') ?? '',
    /resource_metadata="https:\/\/mcp\.presscart\.test\/\.well-known\/oauth-protected-resource\/mcp\/openai"/,
  );
});
