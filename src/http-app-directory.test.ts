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
  audiences?: OAuthConfig['audiences'];
}): OAuthConfig {
  return {
    issuer: new URL('https://project.supabase.co/auth/v1'),
    resource: CANONICAL,
    audiences: args.audiences ?? [CANONICAL],
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
  'canonical-aud-other-grant': { aud: CANONICAL.href, grant: 'grant-2' },
  'origin-aud': { aud: ALLOWED_ORIGIN + '/', grant: 'grant-1' },
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

const IDENTITY_MISMATCH = /Authorization token does not match the OAuth grant bound to the active MCP session/;

async function readMismatch(base: string, path: string, sessionId: string, token: string) {
  return sendMcp(base, path, {
    body: { jsonrpc: '2.0', id: 8, method: 'tools/list', params: {} },
    headers: sessionHeaders(sessionId, { authorization: `Bearer ${token}` }),
  });
}

test('legacy /mcp with OAuth rejects a session reused with a different grant', async () => {
  const { base } = await start({
    directoryProfiles: [],
    oauth: oauthConfig({ acceptCanonical: true, tokens: TOKENS }),
  });
  const sessionId = await initializeSession(base, '/mcp', { authorization: 'Bearer canonical-aud' });

  const reused = await readMismatch(base, '/mcp', sessionId, 'canonical-aud-other-grant');
  assert.equal(reused.status, 401);
  assert.match(reused.headers.get('www-authenticate') ?? '', /resource_metadata="https:\/\/mcp\.presscart\.test\/\.well-known\/oauth-protected-resource\/mcp"/);
  const message = JSON.stringify(reused.body);
  assert.match(message, IDENTITY_MISMATCH);
  assert.equal(
    (await listToolNames(base, '/mcp', sessionId, { authorization: 'Bearer canonical-aud' })).length,
    54,
  );
});

test('directory route with OAuth rejects a session reused with a different grant', async () => {
  const { base } = await start({
    directoryProfiles: [DIRECTORY_PROFILES.openai],
    oauth: oauthConfig({ acceptCanonical: true, tokens: TOKENS }),
  });
  const sessionId = await initializeSession(base, '/mcp/openai', { authorization: 'Bearer openai-aud' });

  const reused = await readMismatch(base, '/mcp/openai', sessionId, 'openai-aud-other-grant');
  assert.equal(reused.status, 401);
  assert.match(reused.headers.get('www-authenticate') ?? '', /resource_metadata="https:\/\/mcp\.presscart\.test\/\.well-known\/oauth-protected-resource\/mcp\/openai"/);
  assert.match(JSON.stringify(reused.body), IDENTITY_MISMATCH);
  assert.deepEqual(
    await listToolNames(base, '/mcp/openai', sessionId, { authorization: 'Bearer openai-aud' }),
    STAGE_A,
  );
});

test('legacy /mcp without OAuth rejects a session reused with a different API token', async () => {
  stubApi();
  const { base } = await start({ directoryProfiles: [] });
  const sessionId = await initializeSession(base, '/mcp', { 'x-presscart-api-token': 'token-one-placeholder' });

  const reused = await sendMcp(base, '/mcp', {
    body: { jsonrpc: '2.0', id: 8, method: 'tools/list', params: {} },
    headers: sessionHeaders(sessionId, { 'x-presscart-api-token': 'token-two-placeholder' }),
  });
  assert.equal(reused.status, 400);
  assert.deepEqual(reused.body, {
    jsonrpc: '2.0',
    error: {
      code: -32000,
      message: 'X-Presscart-API-Token does not match the credential bound to the active MCP session.',
    },
    id: null,
  });
});

test('legacy /mcp verifies a repeated API token once within the cache TTL', async () => {
  const api = stubApi();
  const { base } = await start({ directoryProfiles: [] });
  const headers = { 'x-presscart-api-token': 'cache-token-placeholder' };

  const sessionId = await initializeSession(base, '/mcp', headers);
  await listToolNames(base, '/mcp', sessionId, headers);
  await listToolNames(base, '/mcp', sessionId, headers);
  await initializeSession(base, '/mcp', headers);

  assert.equal(api.calls.filter(call => call.url.pathname === '/auth/token').length, 1);
});

test('a directory route rejects a legacy-origin audience that /mcp still accepts', async () => {
  // Production: oauth.audiences = [resource, origin] when the legacy audience is configured.
  const legacyAudiences: OAuthConfig['audiences'] = [CANONICAL, new URL(ALLOWED_ORIGIN + '/')];
  for (const acceptCanonical of [true, false]) {
    const verifierCalls: Array<{ resource: string; audiences: string[] }> = [];
    const { base } = await start({
      directoryProfiles: [DIRECTORY_PROFILES.openai],
      oauth: oauthConfig({ acceptCanonical, tokens: TOKENS, verifierCalls, audiences: legacyAudiences }),
    });

    assert.deepEqual(verifierCalls, [
      { resource: CANONICAL.href, audiences: [CANONICAL.href, ALLOWED_ORIGIN + '/'] },
      { resource: OPENAI, audiences: acceptCanonical ? [OPENAI, CANONICAL.href] : [OPENAI] },
    ]);

    const legacy = await sendMcp(base, '/mcp', {
      body: initializeRequest(),
      headers: { authorization: 'Bearer origin-aud' },
    });
    assert.equal(legacy.status, 200, `positive control flag=${acceptCanonical}`);

    const rejected = await sendMcp(base, '/mcp/openai', {
      body: initializeRequest(),
      headers: { authorization: 'Bearer origin-aud' },
    });
    assert.equal(rejected.status, 401, `flag=${acceptCanonical}`);
  }
});

test('createHttpApp fails fast when the OAuth resource origin differs from the MCP server origin', () => {
  assert.throws(
    () =>
      createHttpApp({
        host: '127.0.0.1',
        mcpServerUrl: CANONICAL,
        allowedOrigins: [ALLOWED_ORIGIN],
        sessionIdleTtlMs: 60_000,
        directoryProfiles: [DIRECTORY_PROFILES.openai],
        oauth: {
          ...oauthConfig({ acceptCanonical: true, tokens: TOKENS }),
          resource: new URL('https://other.presscart.test/mcp'),
        },
      }),
    /OAuth resource origin https:\/\/other\.presscart\.test must equal the MCP server origin https:\/\/mcp\.presscart\.test/,
  );
});

test('directory session without OAuth rejects reuse with a different API token', async () => {
  stubApi();
  const { base } = await start({ directoryProfiles: [DIRECTORY_PROFILES.openai] });
  const sessionId = await initializeSession(base, '/mcp/openai', { 'x-presscart-api-token': 'token-one-placeholder' });

  const reused = await sendMcp(base, '/mcp/openai', {
    body: { jsonrpc: '2.0', id: 8, method: 'tools/list', params: {} },
    headers: sessionHeaders(sessionId, { 'x-presscart-api-token': 'token-two-placeholder' }),
  });
  assert.equal(reused.status, 400);
  assert.deepEqual(reused.body, {
    jsonrpc: '2.0',
    error: {
      code: -32000,
      message: 'X-Presscart-API-Token does not match the credential bound to the active MCP session.',
    },
    id: null,
  });
});

test('directory MCP paths match exactly: case and trailing-slash variants 404 without creating sessions', async () => {
  stubApi();
  const { base, httpApp } = await start({ directoryProfiles: [DIRECTORY_PROFILES.openai] });
  assert.equal((await sendMcp(base, '/mcp/openai', { body: initializeRequest(), headers: tokenHeader })).status, 200);
  const before = httpApp.sessions.size;

  for (const path of ['/mcp/OpenAI', '/mcp/openai/', '/mcp/OPENAI']) {
    const post = await sendMcp(base, path, { body: initializeRequest(), headers: tokenHeader });
    assert.equal(post.status, 404, `POST ${path}`);
    assert.deepEqual(post.body, { error: 'Not found' }, `POST ${path}`);
    assert.equal((await sendMcp(base, path, { method: 'GET' })).status, 404, `GET ${path}`);
    assert.equal((await sendMcp(base, path, { method: 'DELETE' })).status, 404, `DELETE ${path}`);
    assert.equal((await sendMcp(base, path, { method: 'PUT', body: {} })).status, 404, `PUT ${path}`);
    const preflight = await fetch(`${base}${path}`, {
      method: 'OPTIONS',
      headers: { origin: ALLOWED_ORIGIN, 'access-control-request-method': 'POST' },
    });
    assert.equal(preflight.status, 404, `OPTIONS ${path}`);
  }
  assert.equal(httpApp.sessions.size, before);
});

test('directory metadata and path-inserted AS/OIDC aliases match exactly', async () => {
  const { base } = await start({
    directoryProfiles: [DIRECTORY_PROFILES.openai],
    oauth: oauthConfig({ acceptCanonical: true, tokens: TOKENS }),
  });

  for (const path of [
    '/.well-known/oauth-protected-resource/mcp/openai',
    '/.well-known/oauth-authorization-server/mcp/openai',
    '/.well-known/openid-configuration/mcp/openai',
  ]) {
    assert.equal((await fetch(`${base}${path}`)).status, 200, path);
    for (const variant of [path.replace('openai', 'OpenAI'), path.replace('openai', 'OPENAI'), `${path}/`]) {
      const response = await fetch(`${base}${variant}`);
      assert.equal(response.status, 404, variant);
      assert.deepEqual(await response.json(), { error: 'Not found' }, variant);
    }
  }
});

test('legacy and canonical routes keep their existing case-insensitive, slash-tolerant matching', async () => {
  stubApi();
  const { base } = await start({
    directoryProfiles: [DIRECTORY_PROFILES.openai],
    oauth: oauthConfig({ acceptCanonical: true, tokens: TOKENS }),
  });

  // Pinned from the behavior at 8cd9d33, before directory routes became exact.
  for (const path of ['/mcp/', '/MCP']) {
    const response = await sendMcp(base, path, { body: initializeRequest() });
    assert.equal(response.status, 401, `POST ${path}`);
  }
  for (const path of [
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/',
    '/.well-known/oauth-protected-resource/mcp',
    '/.well-known/oauth-protected-resource/mcp/',
    '/.well-known/oauth-protected-resource/MCP',
    '/.well-known/oauth-authorization-server/mcp/',
    '/.well-known/oauth-authorization-server/MCP',
  ]) {
    assert.equal((await fetch(`${base}${path}`)).status, 200, path);
  }
});
