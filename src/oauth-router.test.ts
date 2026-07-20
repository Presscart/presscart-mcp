import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { afterEach, test } from 'node:test';

import express from 'express';

import { createOAuthRouter } from './oauth-router.js';

const servers: Server[] = [];
const canonicalResource = 'https://mcp.presscart.com/mcp';
const publicDcrClientId = 'a7f2616f-caf6-47d6-8f46-fabf13f11397';
const confidentialDcrClientId = '849f3adf-54e5-4fff-936c-5939fe05a666';

type StartRouterOptions = {
  fetchImpl?: typeof fetch;
  remoteAddress?: string;
  translatorEnabled?: boolean;
  now?: () => number;
};

async function startRouter({
  fetchImpl = globalThis.fetch,
  remoteAddress,
  translatorEnabled = true,
  now,
}: StartRouterOptions = {}) {
  const app = express();
  app.set('trust proxy', 1);
  if (remoteAddress !== undefined) {
    app.use((req, _res, next) => {
      Object.defineProperty(req.socket, 'remoteAddress', {
        configurable: true,
        value: remoteAddress,
      });
      next();
    });
  }
  app.use(createOAuthRouter({
    resource: new URL(canonicalResource),
    authorizationServer: new URL('https://mcp.presscart.com'),
    upstreamIssuer: new URL('https://project.supabase.co/auth/v1'),
    translatorEnabled,
    upstreamTimeoutMs: 1_000,
    fetchImpl,
    now,
  }));
  app.get('/unrelated', (_req, res) => {
    res.json({ ok: true });
  });
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server =>
    new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))));
});

function authorizationQuery(overrides: Record<string, string> = {}) {
  return new URLSearchParams({
    response_type: 'code',
    client_id: 'client-1',
    redirect_uri: 'https://client.example/callback?return=%2Fhome',
    code_challenge: 'A'.repeat(43),
    code_challenge_method: 'S256',
    state: 'state-1',
    resource: canonicalResource,
    scope: 'offline_access profile',
    ...overrides,
  });
}

function registrationRequest(tokenEndpointAuthMethod = 'none') {
  return {
    redirect_uris: ['https://client.example/callback'],
    token_endpoint_auth_method: tokenEndpointAuthMethod,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: 'offline_access profile',
    client_name: 'Example client',
  };
}

function registrationResponse(tokenEndpointAuthMethod = 'none') {
  return {
    client_id: tokenEndpointAuthMethod === 'none' ? publicDcrClientId : confidentialDcrClientId,
    client_type: tokenEndpointAuthMethod === 'none' ? 'public' : 'confidential',
    redirect_uris: ['https://client.example/callback'],
    token_endpoint_auth_method: tokenEndpointAuthMethod,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    client_name: 'Example client',
    ...(tokenEndpointAuthMethod === 'none' ? {} : { client_secret: 'registered-secret' }),
    registration_type: 'dynamic',
    created_at: '2026-07-17T09:00:00Z',
    updated_at: '2026-07-17T09:00:00Z',
  };
}

function tokenResponse() {
  return {
    access_token: 'access-next',
    token_type: 'bearer',
    expires_in: 3600,
    refresh_token: 'refresh-next',
    scope: 'profile',
  };
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function assertOAuthJson(response: Response) {
  assert.match(response.headers.get('content-type') ?? '', /^application\/json(?:;|$)/i);
}

test('publishes facade metadata only when enabled and caches both resource routes', async () => {
  const enabled = await startRouter();
  const authorizationMetadata = await fetch(`${enabled}/.well-known/oauth-authorization-server`);
  assert.equal(authorizationMetadata.status, 200);
  assertOAuthJson(authorizationMetadata);
  assert.equal(authorizationMetadata.headers.get('cache-control'), 'public, max-age=300');
  assert.deepEqual(await authorizationMetadata.json(), {
    issuer: 'https://mcp.presscart.com',
    authorization_endpoint: 'https://mcp.presscart.com/oauth/authorize',
    token_endpoint: 'https://mcp.presscart.com/oauth/token',
    registration_endpoint: 'https://mcp.presscart.com/oauth/register',
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    scopes_supported: ['profile', 'offline_access'],
  });

  const resourceResponses = await Promise.all([
    fetch(`${enabled}/.well-known/oauth-protected-resource`),
    fetch(`${enabled}/.well-known/oauth-protected-resource/mcp`),
  ]);
  for (const response of resourceResponses) {
    assertOAuthJson(response);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=300');
    assert.deepEqual(await response.json(), {
      resource: canonicalResource,
      authorization_servers: ['https://mcp.presscart.com'],
      scopes_supported: ['profile', 'offline_access'],
      bearer_methods_supported: ['header'],
      resource_name: 'Presscart MCP',
    });
  }

  const disabled = await startRouter({ translatorEnabled: false });
  assert.equal((await fetch(`${disabled}/.well-known/oauth-authorization-server`)).status, 404);
  assert.equal((await fetch(`${disabled}/oauth/authorize`)).status, 404);
  assert.equal((await fetch(`${disabled}/oauth/register`, { method: 'POST' })).status, 404);
  assert.equal((await fetch(`${disabled}/oauth/token`, { method: 'POST' })).status, 404);
  const direct = await (await fetch(`${disabled}/.well-known/oauth-protected-resource/mcp`)).json();
  assert.deepEqual(direct, {
    resource: canonicalResource,
    authorization_servers: ['https://project.supabase.co/auth/v1'],
    scopes_supported: ['openid', 'profile'],
    bearer_methods_supported: ['header'],
    resource_name: 'Presscart MCP',
  });
});

test('requires HTTPS on every owned route unless the client connection is loopback', async () => {
  let upstreamCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    upstreamCalls += 1;
    return jsonResponse(tokenResponse());
  };
  const insecureBase = await startRouter({ fetchImpl, remoteAddress: '198.51.100.10' });
  const callerHeaders = { host: 'localhost' };
  const requests = [
    fetch(`${insecureBase}/.well-known/oauth-protected-resource`, { headers: callerHeaders }),
    fetch(`${insecureBase}/.well-known/oauth-protected-resource/mcp`, { headers: callerHeaders }),
    fetch(`${insecureBase}/.well-known/oauth-authorization-server`, { headers: callerHeaders }),
    fetch(`${insecureBase}/oauth/authorize?${authorizationQuery()}`, {
      headers: callerHeaders,
      redirect: 'manual',
    }),
    fetch(`${insecureBase}/oauth/register`, {
      method: 'POST',
      headers: { ...callerHeaders, 'content-type': 'application/json' },
      body: JSON.stringify(registrationRequest()),
    }),
    fetch(`${insecureBase}/oauth/token`, {
      method: 'POST',
      headers: { ...callerHeaders, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: 'refresh-current',
        client_id: 'client-1',
      }),
    }),
  ];

  for (const response of await Promise.all(requests)) {
    assert.equal(response.status, 400);
    assertOAuthJson(response);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      error: 'invalid_request',
      error_description: 'HTTPS is required',
    });
  }
  assert.equal(upstreamCalls, 0);

  const secureBase = await startRouter({ remoteAddress: '198.51.100.11' });
  const secure = await fetch(`${secureBase}/.well-known/oauth-protected-resource`, {
    headers: { 'x-forwarded-proto': 'https' },
  });
  assert.equal(secure.status, 200);
  assertOAuthJson(secure);

  const loopbackBase = await startRouter();
  assert.equal((await fetch(`${loopbackBase}/.well-known/oauth-protected-resource`)).status, 200);

  const unrelated = await fetch(`${insecureBase}/unrelated?padding=${'x'.repeat(8 * 1024)}`, {
    headers: callerHeaders,
  });
  assert.equal(unrelated.status, 200);
  assert.deepEqual(await unrelated.json(), { ok: true });
});

test('redirects a valid S256 request to the fixed Supabase authorize endpoint', async () => {
  const base = await startRouter();
  const response = await fetch(`${base}/oauth/authorize?${authorizationQuery()}`, { redirect: 'manual' });
  const locationHeader = response.headers.get('location');
  assert(locationHeader);
  const location = new URL(locationHeader);

  assert.equal(response.status, 302);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(location.origin + location.pathname, 'https://project.supabase.co/auth/v1/oauth/authorize');
  assert.equal(location.searchParams.get('response_type'), 'code');
  assert.equal(location.searchParams.get('client_id'), 'client-1');
  assert.equal(location.searchParams.get('redirect_uri'), 'https://client.example/callback?return=%2Fhome');
  assert.equal(location.searchParams.get('code_challenge'), 'A'.repeat(43));
  assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(location.searchParams.get('scope'), 'profile');
  assert.equal(location.searchParams.get('state'), 'state-1');
  assert.equal(location.searchParams.get('resource'), canonicalResource);
  for (const name of location.searchParams.keys()) {
    assert.equal(location.searchParams.getAll(name).length, 1);
  }
});

test('forwards a valid prompt parameter to the upstream authorize endpoint', async () => {
  const base = await startRouter();
  for (const prompt of ['consent', 'login', 'none', 'select_account', 'login consent']) {
    const response = await fetch(
      `${base}/oauth/authorize?${authorizationQuery({ prompt })}`,
      { redirect: 'manual' },
    );
    assert.equal(response.status, 302);
    const location = response.headers.get('location');
    assert(location);
    assert.equal(new URL(location).searchParams.get('prompt'), prompt);
  }
});

test('accepts loopback HTTP authorization redirect URIs', async () => {
  const base = await startRouter();
  for (const redirectUri of [
    'http://localhost/callback',
    'http://127.0.0.42/callback',
    'http://[::1]/callback',
  ]) {
    const response = await fetch(
      `${base}/oauth/authorize?${authorizationQuery({ redirect_uri: redirectUri })}`,
      { redirect: 'manual' },
    );
    assert.equal(response.status, 302);
    const location = response.headers.get('location');
    assert(location);
    assert.equal(new URL(location).searchParams.get('redirect_uri'), redirectUri);
  }
});

test('returns local JSON errors without redirecting invalid authorization requests', async () => {
  const base = await startRouter();
  const cases: Array<{ query: URLSearchParams; error: string; description?: string }> = [];

  const missing = authorizationQuery();
  missing.delete('client_id');
  cases.push({ query: missing, error: 'invalid_request' });

  const duplicate = authorizationQuery();
  duplicate.append('state', 'state-2');
  cases.push({ query: duplicate, error: 'invalid_request' });

  const unknown = authorizationQuery();
  unknown.set('audience', 'https://attacker.example');
  cases.push({ query: unknown, error: 'invalid_request' });

  cases.push({ query: authorizationQuery({ response_type: 'token' }), error: 'invalid_request' });
  cases.push({ query: authorizationQuery({ redirect_uri: 'not-a-uri' }), error: 'invalid_request' });
  cases.push({ query: authorizationQuery({ redirect_uri: 'http://client.example/callback' }), error: 'invalid_request' });
  cases.push({ query: authorizationQuery({ redirect_uri: 'ftp://client.example/callback' }), error: 'invalid_request' });
  cases.push({ query: authorizationQuery({ redirect_uri: 'javascript:alert(1)' }), error: 'invalid_request' });
  cases.push({ query: authorizationQuery({ redirect_uri: 'https://user:password@client.example/callback' }), error: 'invalid_request' });
  cases.push({ query: authorizationQuery({ redirect_uri: 'https://client.example/callback#fragment' }), error: 'invalid_request' });
  cases.push({ query: authorizationQuery({ code_challenge_method: 'plain' }), error: 'invalid_request' });
  cases.push({ query: authorizationQuery({ code_challenge: 'short' }), error: 'invalid_request' });
  cases.push({ query: authorizationQuery({ prompt: 'evil' }), error: 'invalid_request' });
  cases.push({ query: authorizationQuery({ prompt: '' }), error: 'invalid_request' });
  cases.push({ query: authorizationQuery({ prompt: 'consent  login' }), error: 'invalid_request' });
  cases.push({
    query: authorizationQuery({ resource: 'https://attacker.example/mcp' }),
    error: 'invalid_target',
    description: 'resource is not supported',
  });
  cases.push({
    query: authorizationQuery({ scope: 'profile' }),
    error: 'invalid_scope',
    description: 'scope must contain profile and offline_access',
  });

  for (const item of cases) {
    const response = await fetch(`${base}/oauth/authorize?${item.query}`, { redirect: 'manual' });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('location'), null);
    assertOAuthJson(response);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('pragma'), 'no-cache');
    const body = await response.json() as { error: string; error_description: string };
    assert.equal(body.error, item.error);
    if (item.description !== undefined) assert.equal(body.error_description, item.description);
  }
});

test('rejects every overlong OAuth route URL before parsing, rate limiting, or upstream fetches', async () => {
  let upstreamCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    upstreamCalls += 1;
    return jsonResponse(tokenResponse());
  };
  const base = await startRouter({ fetchImpl });
  const oversized = `padding=${'x'.repeat(8 * 1024)}`;
  const requests = [
    fetch(`${base}/.well-known/oauth-protected-resource?${oversized}`),
    fetch(`${base}/.well-known/oauth-protected-resource/mcp?${oversized}`),
    fetch(`${base}/.well-known/oauth-authorization-server?${oversized}`),
    fetch(`${base}/oauth/authorize?${oversized}`, { redirect: 'manual' }),
    fetch(`${base}/oauth/register?${oversized}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(registrationRequest()),
    }),
    fetch(`${base}/oauth/token?${oversized}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: 'refresh-current',
        client_id: 'client-1',
      }),
    }),
  ];

  for (const response of await Promise.all(requests)) {
    assert.equal(response.status, 414);
    assertOAuthJson(response);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json() as { error: string }).error, 'invalid_request');
  }
  assert.equal(upstreamCalls, 0);
});

test('enforces independent fixed-window limits for authorize, registration, and token', async () => {
  const base = await startRouter({ now: () => 0 });
  const endpointCases = [
    { path: '/oauth/authorize', method: 'GET', max: 60 },
    { path: '/oauth/register', method: 'POST', max: 20 },
    { path: '/oauth/token', method: 'POST', max: 120 },
  ] as const;

  for (const endpoint of endpointCases) {
    for (let index = 0; index < endpoint.max; index += 1) {
      const response = await fetch(`${base}${endpoint.path}`, { method: endpoint.method, redirect: 'manual' });
      assert.notEqual(response.status, 429);
      await response.body?.cancel();
    }
    const limited = await fetch(`${base}${endpoint.path}`, { method: endpoint.method, redirect: 'manual' });
    assert.equal(limited.status, 429);
    assertOAuthJson(limited);
    assert.equal(limited.headers.get('retry-after'), '60');
    assert.deepEqual(await limited.json(), {
      error: 'temporarily_unavailable',
      error_description: 'request rate limit exceeded',
    });
  }
});

test('rate limits partition callers by IP and reset after the fixed window', async () => {
  let currentTime = 0;
  const base = await startRouter({ now: () => currentTime });
  const requestFrom = (address: string) => fetch(`${base}/oauth/authorize`, {
    headers: { 'x-forwarded-for': address },
    redirect: 'manual',
  });

  for (let index = 0; index < 60; index += 1) {
    const response = await requestFrom('198.51.100.20');
    assert.equal(response.status, 400);
    await response.body?.cancel();
  }
  assert.equal((await requestFrom('198.51.100.20')).status, 429);
  assert.equal((await requestFrom('198.51.100.21')).status, 400);

  currentTime = 60_000;
  assert.equal((await requestFrom('198.51.100.20')).status, 400);
});

test('forwards a translated registration to the fixed endpoint and sanitizes the response', async () => {
  const upstreamCalls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    upstreamCalls.push({ url: String(input), init });
    return jsonResponse(registrationResponse(), 201);
  };
  const base = await startRouter({ fetchImpl });
  const response = await fetch(`${base}/oauth/register`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer caller-credential-must-not-forward',
      'x-caller-secret': 'must-not-forward',
    },
    body: JSON.stringify({
      ...registrationRequest(),
      contacts: ['ignored@example.com'],
    }),
  });

  assert.equal(response.status, 201);
  assertOAuthJson(response);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('pragma'), 'no-cache');
  assert.equal(upstreamCalls.length, 1);
  const call = upstreamCalls[0];
  assert(call);
  assert.equal(call.url, 'https://project.supabase.co/auth/v1/oauth/clients/register');
  assert.equal(call.init?.method, 'POST');
  assert.equal(call.init?.redirect, 'manual');
  assert(call.init?.signal instanceof AbortSignal);
  const headers = new Headers(call.init?.headers);
  assert.equal(headers.get('content-type'), 'application/json');
  assert.equal(headers.has('authorization'), false);
  assert.equal(headers.has('x-caller-secret'), false);
  assert.deepEqual(JSON.parse(String(call.init?.body)), {
    ...registrationRequest(),
    contacts: ['ignored@example.com'],
    scope: 'profile',
  });

  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.scope, 'profile offline_access');
  assert.equal(body.client_id, publicDcrClientId);
  assert.equal('contacts' in body, false);
  for (const field of ['client_type', 'registration_type', 'created_at', 'updated_at']) {
    assert.equal(field in body, false);
  }
});

test('returns the exact official confidential registration as a portable secret response', async () => {
  const fetchImpl: typeof fetch = async () => jsonResponse(
    registrationResponse('client_secret_post'),
    201,
  );
  const base = await startRouter({ fetchImpl });
  const response = await fetch(`${base}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(registrationRequest('client_secret_post')),
  });

  assert.equal(response.status, 201);
  assertOAuthJson(response);
  assert.deepEqual(await response.json(), {
    client_id: confidentialDcrClientId,
    client_secret: 'registered-secret',
    redirect_uris: ['https://client.example/callback'],
    token_endpoint_auth_method: 'client_secret_post',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    client_name: 'Example client',
    scope: 'profile offline_access',
  });
});

test('registers omitted grant_types as the exact authorization-code and refresh-token pair', async () => {
  let forwardedBody: Record<string, unknown> | undefined;
  const fetchImpl: typeof fetch = async (_input, init) => {
    forwardedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return jsonResponse({
      ...forwardedBody,
      client_id: publicDcrClientId,
      client_type: 'public',
      registration_type: 'dynamic',
      created_at: '2026-07-17T09:00:00Z',
      updated_at: '2026-07-17T09:00:00Z',
    }, 201);
  };
  const base = await startRouter({ fetchImpl });
  const response = await fetch(`${base}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: ['https://client.example/callback'],
      token_endpoint_auth_method: 'none',
    }),
  });

  assert.equal(response.status, 201);
  assert.deepEqual(forwardedBody?.grant_types, ['authorization_code', 'refresh_token']);
  assert.deepEqual(
    (await response.json() as { grant_types: string[] }).grant_types,
    ['authorization_code', 'refresh_token'],
  );
});

test('rejects invalid registration requests and parser/body limits without contacting upstream', async () => {
  let upstreamCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    upstreamCalls += 1;
    return jsonResponse(registrationResponse());
  };
  const base = await startRouter({ fetchImpl });

  const invalidMethod = await fetch(`${base}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(registrationRequest('private_key_jwt')),
  });
  assert.equal(invalidMethod.status, 400);

  const insecureRedirect = await fetch(`${base}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...registrationRequest(),
      redirect_uris: ['http://client.example/callback'],
    }),
  });
  assert.equal(insecureRedirect.status, 400);

  const partialGrants = await fetch(`${base}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...registrationRequest(),
      grant_types: ['authorization_code'],
    }),
  });
  assert.equal(partialGrants.status, 400);

  const malformed = await fetch(`${base}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"redirect_uris":',
  });
  assert.equal(malformed.status, 400);
  assertOAuthJson(malformed);
  assert.deepEqual(await malformed.json(), {
    error: 'invalid_request',
    error_description: 'request body is invalid',
  });

  const oversized = await fetch(`${base}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...registrationRequest(), client_name: 'x'.repeat(33 * 1024) }),
  });
  assert.equal(oversized.status, 413);
  assertOAuthJson(oversized);
  assert.equal((await oversized.json() as { error: string }).error, 'invalid_request');
  assert.equal(upstreamCalls, 0);
});

test('rejects malformed and oversized registration responses without exposing upstream text', async () => {
  const rawSentinel = 'raw-upstream-registration-secret';
  const responses = [
    new Response(rawSentinel, { status: 201, headers: { 'content-type': 'text/plain' } }),
    new Response('{not-json', { status: 201, headers: { 'content-type': 'application/json' } }),
    jsonResponse({ ...registrationResponse(), unexpected: rawSentinel }, 201),
    jsonResponse({ ...registrationResponse(), client_id: 'not-a-uuid' }, 201),
    jsonResponse({ ...registrationResponse(), client_type: undefined }, 201),
    jsonResponse({ ...registrationResponse(), registration_type: 'manual' }, 201),
    jsonResponse({ ...registrationResponse(), client_name: 'Different client' }, 201),
    jsonResponse({ ...registrationResponse(), client_uri: 'https://unexpected.example' }, 201),
    jsonResponse({ ...registrationResponse(), padding: 'x'.repeat(65 * 1024) }, 201),
  ];
  const fetchImpl: typeof fetch = async () => {
    const response = responses.shift();
    assert(response);
    return response;
  };
  const base = await startRouter({ fetchImpl });

  for (let index = 0; index < 9; index += 1) {
    const response = await fetch(`${base}/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(registrationRequest()),
    });
    assert.equal(response.status, 502);
    const text = await response.text();
    assert.match(text, /"error":"server_error"/);
    assert.equal(text.includes(rawSentinel), false);
  }
});

test('translates only exact Supabase DCR validation failures without leaking upstream text', async () => {
  const rawSentinel = 'raw-supabase-validation-detail-must-not-escape';
  const responses = [
    jsonResponse({
      code: 400,
      error_code: 'validation_failed',
      msg: rawSentinel,
    }, 400),
    jsonResponse({
      error_code: 'validation_failed',
      msg: rawSentinel,
    }, 400),
    jsonResponse({
      code: 400,
      error_code: 'unexpected_error',
      msg: rawSentinel,
    }, 400),
  ];
  const fetchImpl: typeof fetch = async () => {
    const response = responses.shift();
    assert(response);
    return response;
  };
  const base = await startRouter({ fetchImpl });

  const translated = await fetch(`${base}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(registrationRequest()),
  });
  assert.equal(translated.status, 400);
  assertOAuthJson(translated);
  assert.deepEqual(await translated.json(), {
    error: 'invalid_client_metadata',
    error_description: 'client registration metadata is invalid',
  });

  for (let index = 0; index < 2; index += 1) {
    const malformed = await fetch(`${base}/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(registrationRequest()),
    });
    assert.equal(malformed.status, 502);
    const text = await malformed.text();
    assert.match(text, /"error":"server_error"/);
    assert.equal(text.includes(rawSentinel), false);
  }
});

test('forwards authorization-code fields once and no caller headers', async () => {
  const upstreamCalls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    upstreamCalls.push({ url: String(input), init });
    return jsonResponse(tokenResponse());
  };
  const base = await startRouter({ fetchImpl });
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: 'authorization-code-sentinel',
    code_verifier: 'v'.repeat(43),
    redirect_uri: 'https://client.example/callback?return=%2Fexact path',
    client_id: 'public-client-1',
    resource: canonicalResource,
    scope: 'profile offline_access',
  });
  const response = await fetch(`${base}/oauth/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-caller-secret': 'must-not-forward',
    },
    body: form,
  });

  assert.equal(response.status, 200);
  assertOAuthJson(response);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('pragma'), 'no-cache');
  assert.equal(upstreamCalls.length, 1);
  const call = upstreamCalls[0];
  assert(call);
  assert.equal(call.url, 'https://project.supabase.co/auth/v1/oauth/token');
  assert.equal(call.init?.redirect, 'manual');
  assert(call.init?.signal instanceof AbortSignal);
  const headers = new Headers(call.init?.headers);
  assert.equal(headers.get('content-type'), 'application/x-www-form-urlencoded');
  assert.equal(headers.has('x-caller-secret'), false);
  assert.equal(headers.has('authorization'), false);
  const forwarded = new URLSearchParams(String(call.init?.body));
  assert.equal(forwarded.get('grant_type'), 'authorization_code');
  assert.equal(forwarded.get('code'), 'authorization-code-sentinel');
  assert.equal(forwarded.get('code_verifier'), 'v'.repeat(43));
  assert.equal(forwarded.get('redirect_uri'), 'https://client.example/callback?return=%2Fexact path');
  assert.equal(forwarded.get('client_id'), 'public-client-1');
  assert.equal(forwarded.has('client_secret'), false);
  assert.equal(forwarded.get('resource'), canonicalResource);
  assert.equal(forwarded.get('scope'), 'profile');
  for (const name of forwarded.keys()) assert.equal(forwarded.getAll(name).length, 1);
});

test('preserves refresh rotation and client_secret_post credentials', async () => {
  const upstreamCalls: RequestInit[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    assert(init);
    upstreamCalls.push(init);
    return jsonResponse(tokenResponse());
  };
  const base = await startRouter({ fetchImpl });
  const response = await fetch(`${base}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: 'refresh-current-sentinel',
      client_id: 'confidential-client-1',
      client_secret: 'client-secret-post-sentinel',
      resource: canonicalResource,
    }),
  });

  assert.equal(response.status, 200);
  assertOAuthJson(response);
  assert.deepEqual(await response.json(), {
    access_token: 'access-next',
    token_type: 'bearer',
    expires_in: 3600,
    refresh_token: 'refresh-next',
    scope: 'profile offline_access',
  });
  const forwarded = new URLSearchParams(String(upstreamCalls[0]?.body));
  assert.equal(forwarded.get('refresh_token'), 'refresh-current-sentinel');
  assert.equal(forwarded.getAll('refresh_token').length, 1);
  assert.equal(forwarded.get('client_id'), 'confidential-client-1');
  assert.equal(forwarded.get('client_secret'), 'client-secret-post-sentinel');
});

test('forwards only syntactically valid Basic authorization to the token endpoint', async () => {
  const forwardedAuthorization: Array<string | null> = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    forwardedAuthorization.push(new Headers(init?.headers).get('authorization'));
    return jsonResponse(tokenResponse());
  };
  const base = await startRouter({ fetchImpl });
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: 'refresh-current',
  });
  const validBasic = `Basic ${Buffer.from('client-1:client-secret').toString('base64')}`;
  const accepted = await fetch(`${base}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: validBasic },
    body,
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual(forwardedAuthorization, [validBasic]);

  const caseVariantBasic = `bAsIc ${Buffer.from('client-2:case-sensitive-upstream').toString('base64')}`;
  const caseVariantAccepted = await fetch(`${base}/oauth/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: caseVariantBasic,
    },
    body,
  });
  assert.equal(caseVariantAccepted.status, 200);
  assert.deepEqual(forwardedAuthorization, [
    validBasic,
    `Basic ${Buffer.from('client-2:case-sensitive-upstream').toString('base64')}`,
  ]);

  for (const { authorization, expectsChallenge } of [
    { authorization: 'Bearer caller-token', expectsChallenge: false },
    { authorization: 'Digest opaque', expectsChallenge: false },
    { authorization: 'Basic !!!', expectsChallenge: true },
  ]) {
    const rejected = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization },
      body,
    });
    assert.equal(rejected.status, 401);
    assert.equal(
      rejected.headers.get('www-authenticate'),
      expectsChallenge ? 'Basic realm="oauth/token"' : null,
    );
    assert.equal((await rejected.json() as { error: string }).error, 'invalid_client');
  }
  assert.deepEqual(forwardedAuthorization, [
    validBasic,
    `Basic ${Buffer.from('client-2:case-sensitive-upstream').toString('base64')}`,
  ]);
});

test('challenges a Basic-authenticated client when upstream rejects its credentials', async () => {
  const fetchImpl: typeof fetch = async () => jsonResponse({
    error: 'invalid_client',
    error_description: 'client authentication failed',
  }, 401);
  const base = await startRouter({ fetchImpl });
  const authorization = `Basic ${Buffer.from('client-1:wrong-secret').toString('base64')}`;
  const response = await fetch(`${base}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: 'refresh-current',
    }),
  });

  assert.equal(response.status, 401);
  assert.equal(response.headers.get('www-authenticate'), 'Basic realm="oauth/token"');
  assert.equal((await response.json() as { error: string }).error, 'invalid_client');
});

test('rejects duplicate, unsupported, and oversized token form fields locally', async () => {
  let upstreamCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    upstreamCalls += 1;
    return jsonResponse(tokenResponse());
  };
  const base = await startRouter({ fetchImpl });
  const cases = [
    'grant_type=refresh_token&refresh_token=one&refresh_token=two&client_id=client-1',
    'grant_type=client_credentials&client_id=client-1',
    'grant_type=refresh_token&refresh_token=one&client_id=client-1&audience=https%3A%2F%2Fattacker.example',
    `grant_type=refresh_token&refresh_token=one&client_id=client-1&resource=${encodeURIComponent('https://attacker.example/mcp')}`,
    new URLSearchParams({
      grant_type: 'authorization_code',
      code: 'authorization-code',
      code_verifier: 'v'.repeat(43),
      redirect_uri: 'http://client.example/callback',
      client_id: 'client-1',
    }).toString(),
  ];
  for (const body of cases) {
    const response = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    assert.equal(response.status, 400);
  }

  const oversized = await fetch(`${base}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: 'x'.repeat(17 * 1024),
      client_id: 'client-1',
    }),
  });
  assert.equal(oversized.status, 413);
  assert.equal(upstreamCalls, 0);
});

test('preserves validated upstream OAuth errors and strips nonstandard fields', async () => {
  const upstreamErrors = [
    { status: 400, error: 'invalid_grant' },
    { status: 401, error: 'invalid_client' },
    { status: 403, error: 'invalid_scope' },
  ];
  const fetchImpl: typeof fetch = async () => {
    const next = upstreamErrors.shift();
    assert(next);
    return jsonResponse({
      error: next.error,
      error_description: `${next.error} description`,
      error_uri: 'https://project.supabase.co/docs/oauth-errors',
      internal_detail: 'must-not-escape',
    }, next.status);
  };
  const base = await startRouter({ fetchImpl });
  for (const expected of [
    { status: 400, error: 'invalid_grant' },
    { status: 401, error: 'invalid_client' },
    { status: 403, error: 'invalid_scope' },
  ]) {
    const response = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: 'rejected-refresh-token',
        client_id: 'client-1',
      }),
    });
    assert.equal(response.status, expected.status);
    assert.equal(response.headers.get('www-authenticate'), null);
    assertOAuthJson(response);
    assert.deepEqual(await response.json(), {
      error: expected.error,
      error_description: `${expected.error} description`,
      error_uri: 'https://project.supabase.co/docs/oauth-errors',
    });
  }
});

test('maps timeout/network, redirects, and malformed successes to safe facade errors', async () => {
  const rawSentinel = 'raw-upstream-token-secret';
  const outcomes: Array<Response | Error> = [
    new DOMException('timed out', 'TimeoutError'),
    new Error('network includes raw secret'),
    new Response(null, { status: 302, headers: { location: `https://attacker.example/${rawSentinel}` } }),
    new Response(rawSentinel, { status: 200, headers: { 'content-type': 'text/plain' } }),
    jsonResponse({ ...tokenResponse(), id_token: rawSentinel }),
  ];
  const fetchImpl: typeof fetch = async () => {
    const outcome = outcomes.shift();
    assert(outcome);
    if (outcome instanceof Error) throw outcome;
    return outcome;
  };
  const base = await startRouter({ fetchImpl });
  for (const expectedError of [
    'temporarily_unavailable',
    'temporarily_unavailable',
    'server_error',
    'server_error',
    'server_error',
  ]) {
    const response = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: 'refresh-current',
        client_id: 'client-1',
      }),
    });
    assert.equal(response.status, expectedError === 'temporarily_unavailable' ? 503 : 502);
    const text = await response.text();
    assert.match(text, new RegExp(`"error":"${expectedError}"`));
    assert.equal(text.includes(rawSentinel), false);
    assert.equal(text.includes('network includes raw secret'), false);
  }
});

test('never writes codes, tokens, secrets, or registration credentials to console', async () => {
  const sentinels = [
    'authorization-code-console-sentinel',
    'refresh-token-console-sentinel',
    'client-secret-console-sentinel',
    'registration-token-console-sentinel',
  ];
  const output: string[] = [];
  const original = {
    error: console.error,
    info: console.info,
    log: console.log,
    warn: console.warn,
  };
  console.error = (...values: unknown[]) => { output.push(values.map(String).join(' ')); };
  console.info = (...values: unknown[]) => { output.push(values.map(String).join(' ')); };
  console.log = (...values: unknown[]) => { output.push(values.map(String).join(' ')); };
  console.warn = (...values: unknown[]) => { output.push(values.map(String).join(' ')); };

  try {
    const fetchImpl: typeof fetch = async (input) => String(input).endsWith('/oauth/token')
      ? jsonResponse(tokenResponse())
      : jsonResponse({
        ...registrationResponse('client_secret_post'),
        client_secret: sentinels[2],
        registration_access_token: sentinels[3],
      }, 201);
    const base = await startRouter({ fetchImpl });
    await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: sentinels[0],
        code_verifier: 'v'.repeat(43),
        redirect_uri: 'https://client.example/callback',
        client_id: 'client-1',
      }),
    });
    await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: sentinels[1],
        client_id: 'client-1',
        client_secret: sentinels[2],
      }),
    });
    await fetch(`${base}/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(registrationRequest('client_secret_post')),
    });
  } finally {
    console.error = original.error;
    console.info = original.info;
    console.log = original.log;
    console.warn = original.warn;
  }

  const combined = output.join('\n');
  for (const sentinel of sentinels) assert.equal(combined.includes(sentinel), false);
});
