# MCP OAuth Refresh Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standards-based, stateless OAuth compatibility layer that lets remote MCP clients automatically refresh Presscart access while preserving Supabase as the token issuer and keeping normal Presscart sessions unchanged.

**Architecture:** `presscart-mcp` will publish OAuth metadata and proxy only authorization, dynamic registration, and token operations to fixed Supabase endpoints. It will translate the facade-only `offline_access` scope without storing clients or credentials. `presscart-app` will enrich every initial and refreshed access token, move the MCP JWT audience to the canonical protected-resource URL, and bind each signed Supabase `session_id` to one Presscart grant so refresh never depends on an incoming custom `grant_id`.

**Tech Stack:** TypeScript 5.9, Node.js 22, Express 5, Zod 3, MCP TypeScript SDK, JOSE, Node test runner, pnpm/Turborepo, Hono, Vitest, Supabase Auth OAuth 2.1.

## Global Constraints

- Work only in the isolated `oauth-refresh-lifecycle` worktrees for `presscart-mcp` and `presscart-app`.
- Use `https://mcp.presscart.com/mcp` as the canonical OAuth resource and JWT audience.
- Use `https://mcp.presscart.com` as the translator authorization-server identifier.
- The facade supports exactly the scope set `profile offline_access`; it sends only `profile` to Supabase.
- Supabase remains responsible for login, client persistence, authorization codes, access tokens, rotating refresh tokens, and signing.
- `presscart-mcp` must not persist or log authorization codes, access tokens, refresh tokens, client secrets, or registration-management credentials.
- Preserve OAuth error names such as `invalid_grant`; never convert an expected refresh rejection to a generic 500.
- Accept PKCE `S256` only and never redirect a locally detected authorization error to an unverified `redirect_uri`.
- The translator feature flag defaults off. Ordinary Presscart browser/app sessions and legacy non-OAuth MCP mode remain unchanged.
- Follow red -> green -> refactor. Mock only external network or data boundaries.
- Use the repository `$commit` skill for every commit; do not use raw `git commit` in execution.
- Add one `presscart-app` migration for nullable unique
  `oauth_grants.supabase_session_id`; apply it before deploying the hook code
  that reads or writes this binding.

## File Map

### `presscart-mcp`

- Create `src/oauth-protocol.ts`: pure facade scope/resource parsing, metadata builders, DCR/token response validation, and OAuth-safe error types.
- Create `src/oauth-protocol.test.ts`: pure protocol contract tests.
- Create `src/oauth-router.ts`: Express routes, request limits, endpoint-specific rate limits, fixed-origin upstream calls, and response/error mapping.
- Create `src/oauth-router.test.ts`: real Express route tests with only `globalThis.fetch` stubbed.
- Create `src/oauth-http.ts`: hosted OAuth layer assembly plus the pure MCP session-identity validator.
- Create `src/oauth-http.test.ts`: real bearer-challenge integration and token-rotation session-binding tests.
- Create `src/supabase-oauth.test.ts`: signed-JWT tests for canonical and transitional legacy audiences.
- Create `src/env.test.ts`: exact boolean environment parsing tests.
- Modify `src/supabase-oauth.ts`: accept a canonical resource plus one or more verification audiences.
- Modify `src/env.ts`: add the translator flag, legacy audience, and upstream timeout; change the canonical audience default.
- Modify `src/http.ts`: mount discovery/translator routes and construct the dual-audience verifier.
- Modify `README.md`: document refresh ownership, configuration, rollout order, and cross-platform client behavior.

### `presscart-app`

- Add the nullable unique `oauth_grants.supabase_session_id` migration and update generated schema types.
- Modify `apps/api/src/controllers/oauth-grants/access-token-hook.ts`: require signed `sub`, `client_id`, and `session_id` for OAuth hook events, distinguish initial issuance from `token_refresh`, and emit the canonical `/mcp` audience plus the resolved `grant_id`.
- Modify `apps/api/src/controllers/oauth-grants/access-token-hook.test.ts`: add fresh-claim initial and refresh regressions that do not rely on an incoming custom `grant_id`.
- Create `apps/api/src/controllers/oauth-grants/access-token-hook.integration.test.ts`: exercise the real controller, session-bound resolver, and active-grant service while mocking data/network boundaries only.
- Add session-binding data helpers and update the grant create/revoke/resolution services so initial issuance binds once, refresh resolves the exact session, and revocation remains fail closed.
- Modify `docs/superpowers/specs/presscart-mcp-account-oauth.md`: document automatic refresh and the canonical audience.
- Modify `docs/design-docs/oauth-threat-model.md`: add the translator boundary, scope translation, fixed-origin proxy, rotation, and migration checks.

---

### Task 1: Canonical and transitional JWT audiences

**Files:**
- Modify: `presscart-mcp/src/env.ts`
- Modify: `presscart-mcp/src/supabase-oauth.ts`
- Create: `presscart-mcp/src/supabase-oauth.test.ts`
- Create: `presscart-mcp/src/env.test.ts`

**Interfaces:**
- Consumes: Supabase issuer URL and signed JWTs with `client_id`, `grant_id`, and `sub`.
- Produces: `SupabaseOAuthVerifier({ issuerUrl, audiences, resource })`, where `audiences` is a non-empty `readonly URL[]` accepted by JOSE and `resource` is always the canonical `AuthInfo.resource`.
- Produces config: `MCP_OAUTH_AUDIENCE`, `MCP_OAUTH_LEGACY_AUDIENCE`, `MCP_OAUTH_TRANSLATOR_ENABLED`, and `MCP_OAUTH_UPSTREAM_TIMEOUT_MS`.

- [ ] **Step 1: Write signed-JWT tests that distinguish the canonical resource from accepted audiences**

Create `src/supabase-oauth.test.ts` with a local JWKS server and three concrete cases:

```ts
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

import { SupabaseOAuthVerifier } from './supabase-oauth.js';

const canonical = new URL('https://mcp.presscart.com/mcp');
const legacy = new URL('https://mcp.presscart.com');
let issuer: URL;
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let closeJwks: () => Promise<void>;

before(async () => {
  const keys = await generateKeyPair('ES256');
  privateKey = keys.privateKey;
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'test-key', alg: 'ES256', use: 'sig' };
  const server = createServer((req, res) => {
    if (req.url !== '/.well-known/jwks.json') {
      res.writeHead(404).end();
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  issuer = new URL(`http://127.0.0.1:${address.port}/`);
  closeJwks = () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

after(async () => closeJwks());

async function token(audience: string) {
  return new SignJWT({ client_id: 'client-1', grant_id: '22222222-2222-2222-2222-222222222222' })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
    .setIssuer(issuer.href.replace(/\/$/, ''))
    .setSubject('11111111-1111-1111-1111-111111111111')
    .setAudience(audience)
    .setExpirationTime('5m')
    .sign(privateKey);
}

test('accepts the canonical audience and reports the canonical resource', async () => {
  const verifier = new SupabaseOAuthVerifier({ issuerUrl: issuer, audiences: [canonical], resource: canonical });
  const auth = await verifier.verifyAccessToken(await token(canonical.href));
  assert.equal(auth.resource?.href, canonical.href);
});

test('accepts a configured legacy audience but still reports the canonical resource', async () => {
  const verifier = new SupabaseOAuthVerifier({ issuerUrl: issuer, audiences: [canonical, legacy], resource: canonical });
  const auth = await verifier.verifyAccessToken(await token(legacy.href.replace(/\/$/, '')));
  assert.equal(auth.resource?.href, canonical.href);
});

test('rejects the legacy audience when compatibility is not configured', async () => {
  const verifier = new SupabaseOAuthVerifier({ issuerUrl: issuer, audiences: [canonical], resource: canonical });
  const signed = await token(legacy.href.replace(/\/$/, ''));
  await assert.rejects(() => verifier.verifyAccessToken(signed), /Invalid or expired token/);
});
```

- [ ] **Step 2: Run the verifier test to prove RED**

Run in `presscart-mcp`:

```bash
node --import tsx --test src/supabase-oauth.test.ts
```

Expected: FAIL because the verifier constructor does not accept `audiences` or `resource`.

- [ ] **Step 3: Implement dual verification with a single canonical resource**

Change the verifier option and JOSE call in `src/supabase-oauth.ts`:

```ts
type SupabaseOAuthVerifierOptions = {
  issuerUrl: URL;
  audiences: readonly [URL, ...URL[]];
  resource: URL;
};

const acceptedAudiences = options.audiences.map(normalizeAudience);
const { payload } = await jwtVerify(token, this.jwks, {
  issuer: normalizeIssuer(this.options.issuerUrl),
  audience: acceptedAudiences,
});

return toAuthInfo(token, payload, this.options.resource);
```

Keep claim validation unchanged. `toAuthInfo()` must receive `resource`, not whichever legacy audience happened to match.

- [ ] **Step 4: Run the verifier test to prove GREEN**

Run in `presscart-mcp`:

```bash
node --import tsx --test src/supabase-oauth.test.ts
```

Expected: all 3 verifier tests pass.

- [ ] **Step 5: Write explicit boolean environment parser tests**

Create `src/env.test.ts`, set `PRESSCART_API_URL` before dynamically importing `env.ts`, and assert that the exported `booleanEnvSchema` maps `true`/`"true"`/`"1"` to `true`, maps `false`/`"false"`/`"0"` to `false`, and rejects every other string.

- [ ] **Step 6: Run the environment test to prove RED**

Run in `presscart-mcp`:

```bash
node --import tsx --test src/env.test.ts
```

Expected: FAIL because `booleanEnvSchema` is not exported and `"false"` still uses truthy boolean coercion.

- [ ] **Step 7: Add validated environment configuration**

Add one explicit parser to `src/env.ts` and use it for both OAuth boolean flags so the existing `MCP_OAUTH_ENABLED=false` behavior is corrected at the same boundary:

```ts
export const booleanEnvSchema = z.preprocess(value => {
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return value;
}, z.boolean());
```

Extend the environment schema with these exact entries and mappings:

```ts
MCP_OAUTH_ENABLED: booleanEnvSchema.default(false),
MCP_OAUTH_TRANSLATOR_ENABLED: booleanEnvSchema.default(false),
MCP_OAUTH_AUDIENCE: z.string().url().default('https://mcp.presscart.com/mcp'),
MCP_OAUTH_LEGACY_AUDIENCE: z.string().url().optional(),
MCP_OAUTH_UPSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().max(30_000).default(10_000),
```

```ts
MCP_OAUTH_TRANSLATOR_ENABLED: process.env.MCP_OAUTH_TRANSLATOR_ENABLED,
MCP_OAUTH_AUDIENCE: process.env.MCP_OAUTH_AUDIENCE,
MCP_OAUTH_LEGACY_AUDIENCE: process.env.MCP_OAUTH_LEGACY_AUDIENCE,
MCP_OAUTH_UPSTREAM_TIMEOUT_MS: process.env.MCP_OAUTH_UPSTREAM_TIMEOUT_MS,
```

- [ ] **Step 8: Run focused and static checks to prove GREEN**

Run in `presscart-mcp`:

```bash
node --import tsx --test src/supabase-oauth.test.ts
node --import tsx --test src/env.test.ts
npm run check
```

Expected: 3 verifier tests and all boolean parser cases pass; TypeScript reports no errors.

- [ ] **Step 9: Commit Task 1**

Invoke `$commit` in `presscart-mcp` with the intended message:

```text
feat(auth): support canonical and legacy MCP audiences
```

---

### Task 2: Pure OAuth facade protocol contract

**Files:**
- Create: `presscart-mcp/src/oauth-protocol.ts`
- Create: `presscart-mcp/src/oauth-protocol.test.ts`

**Interfaces:**
- Produces: `OAuthProtocolError`, `parseFacadeScope()`, `parseCanonicalResource()`, `createAuthorizationServerMetadata()`, `createProtectedResourceMetadata()`, `translateRegistrationRequest()`, `translateRegistrationResponse()`, and `translateTokenResponse()`.
- Consumers: Task 3 route handlers use these pure functions and never duplicate scope, resource, or response validation.

- [ ] **Step 1: Write the failing pure contract tests**

Create `src/oauth-protocol.test.ts`. Cover each exact behavior:

```ts
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  OAuthProtocolError,
  createAuthorizationServerMetadata,
  createProtectedResourceMetadata,
  parseCanonicalResource,
  parseFacadeScope,
  translateRegistrationRequest,
  translateRegistrationResponse,
  translateTokenResponse,
} from './oauth-protocol.js';

const resource = new URL('https://mcp.presscart.com/mcp');
const facade = new URL('https://mcp.presscart.com');
const facadeIssuer = facade.href.replace(/\/$/, '');
const upstream = new URL('https://project.supabase.co/auth/v1');

describe('scope translation', () => {
  test('defaults an omitted scope to the full facade set', () => {
    assert.deepEqual(parseFacadeScope(undefined), { facade: 'profile offline_access', upstream: 'profile' });
  });
  test('accepts the two scopes in either order', () => {
    assert.equal(parseFacadeScope('offline_access profile').upstream, 'profile');
  });
  for (const value of ['profile', 'offline_access', 'profile email', '']) {
    test(`rejects partial or unsupported scope: ${JSON.stringify(value)}`, () => {
      assert.throws(() => parseFacadeScope(value), (error: unknown) =>
        error instanceof OAuthProtocolError && error.code === 'invalid_scope');
    });
  }
});

test('accepts only the exact canonical resource', () => {
  assert.equal(parseCanonicalResource(resource.href, resource), resource.href);
  assert.throws(() => parseCanonicalResource(facade.href, resource), (error: unknown) =>
    error instanceof OAuthProtocolError && error.code === 'invalid_target');
});

test('builds facade and direct-Supabase metadata without mixing issuers', () => {
  assert.equal(createAuthorizationServerMetadata(facade).issuer, facadeIssuer);
  assert.deepEqual(createProtectedResourceMetadata({ resource, authorizationServer: facade, translatorEnabled: true }).authorization_servers, [facadeIssuer]);
  assert.deepEqual(createProtectedResourceMetadata({ resource, authorizationServer: upstream, translatorEnabled: false }).scopes_supported, ['openid', 'profile']);
});

test('validates a compatible Supabase DCR response and emits only portable fields', () => {
  const request = translateRegistrationRequest({
    redirect_uris: ['https://client.example/callback'],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: 'profile offline_access',
    client_name: 'Example client',
  });
  assert.equal(request.upstream.scope, 'profile');
  const response = translateRegistrationResponse({
    request: request.facade,
    upstream: {
      ...request.upstream,
      client_id: 'a7f2616f-caf6-47d6-8f46-fabf13f11397',
      client_type: 'public',
      registration_type: 'dynamic',
      created_at: '2026-07-17T09:00:00Z',
      updated_at: '2026-07-17T09:00:00Z',
      scope: 'profile',
    },
  });
  assert.deepEqual(response, {
    client_id: 'a7f2616f-caf6-47d6-8f46-fabf13f11397',
    redirect_uris: ['https://client.example/callback'],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    client_name: 'Example client',
    scope: 'profile offline_access',
  });
});

test('normalizes a successful token response and preserves refresh rotation', () => {
  assert.deepEqual(translateTokenResponse({
    grantType: 'refresh_token',
    upstream: {
      access_token: 'access-next',
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: 'refresh-next',
      scope: 'profile',
    },
  }), {
    access_token: 'access-next',
    token_type: 'bearer',
    expires_in: 3600,
    refresh_token: 'refresh-next',
    scope: 'profile offline_access',
  });
});

test('rejects an authorization-code response without a refresh token', () => {
  assert.throws(() => translateTokenResponse({
    grantType: 'authorization_code',
    upstream: { access_token: 'access', token_type: 'bearer', expires_in: 3600, scope: 'profile' },
  }), (error: unknown) => error instanceof OAuthProtocolError && error.code === 'server_error');
});
```

- [ ] **Step 2: Run the pure tests to prove RED**

Run in `presscart-mcp`:

```bash
node --import tsx --test src/oauth-protocol.test.ts
```

Expected: FAIL because `oauth-protocol.ts` does not exist.

- [ ] **Step 3: Implement the pure protocol module**

Create `src/oauth-protocol.ts` with strict Zod schemas and these exact public shapes:

```ts
import { z } from 'zod';

export const FACADE_SCOPE = 'profile offline_access';
export const UPSTREAM_SCOPE = 'profile';

export class OAuthProtocolError extends Error {
  constructor(
    readonly code: 'invalid_request' | 'invalid_scope' | 'invalid_target' | 'server_error',
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = 'OAuthProtocolError';
  }
}

export function parseFacadeScope(scope: string | undefined) {
  if (scope === undefined) return { facade: FACADE_SCOPE, upstream: UPSTREAM_SCOPE } as const;
  const values = scope.trim().split(/\s+/).filter(Boolean);
  const unique = new Set(values);
  if (unique.size !== 2 || !unique.has('profile') || !unique.has('offline_access')) {
    throw new OAuthProtocolError('invalid_scope', 'scope must contain profile and offline_access');
  }
  return { facade: FACADE_SCOPE, upstream: UPSTREAM_SCOPE } as const;
}

export function parseCanonicalResource(value: string | undefined, canonical: URL) {
  if (value === undefined) return undefined;
  if (value !== canonical.href) {
    throw new OAuthProtocolError('invalid_target', 'resource is not supported');
  }
  return value;
}

export function createAuthorizationServerMetadata(authorizationServer: URL) {
  const issuer = authorizationServer.href.replace(/\/$/, '');
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    scopes_supported: ['profile', 'offline_access'],
  };
}

export function createProtectedResourceMetadata(args: {
  resource: URL;
  authorizationServer: URL;
  translatorEnabled: boolean;
}) {
  return {
    resource: args.resource.href,
    authorization_servers: [args.authorizationServer.href.replace(/\/$/, '')],
    scopes_supported: args.translatorEnabled ? ['profile', 'offline_access'] : ['openid', 'profile'],
    bearer_methods_supported: ['header'],
    resource_name: 'Presscart MCP',
  };
}
```

Add strict request/response schemas for the fields listed in the approved spec. `translateRegistrationRequest()` must return `{ facade, upstream }` and mirror Supabase's bounds: no more than 10 redirect URIs, `client_name` no more than 1024 UTF-8 bytes, and `client_uri`/`logo_uri` no more than 2048 UTF-8 bytes. `translateRegistrationResponse()` must require Supabase's UUID `client_id`, `client_type`, dynamic `registration_type`, timestamps, core client fields, confidential-only secret, optional supported client metadata, and optional fixed `profile` scope; reject unknown fields; compare redirect URI/auth method/grant/response sets and optional metadata; and return only the portable allowlist with `FACADE_SCOPE`. `translateTokenResponse()` must allow only standard token fields, accept upstream scope only when absent or `profile`, require `refresh_token` for `authorization_code`, and always return `FACADE_SCOPE`.

- [ ] **Step 4: Run pure tests and type checking to prove GREEN**

Run in `presscart-mcp`:

```bash
node --import tsx --test src/oauth-protocol.test.ts
npm run check
```

Expected: all protocol tests pass and TypeScript reports no errors.

- [ ] **Step 5: Commit Task 2**

Invoke `$commit` in `presscart-mcp` with:

```text
feat(auth): define OAuth facade protocol contract
```

---

### Task 3: Stateless OAuth discovery and proxy routes

**Files:**
- Create: `presscart-mcp/src/oauth-router.ts`
- Create: `presscart-mcp/src/oauth-router.test.ts`

**Interfaces:**
- Consumes pure functions from `oauth-protocol.ts`.
- Produces `createOAuthRouter(options): Router`.
- `OAuthRouterOptions` contains `resource`, `authorizationServer`, `upstreamIssuer`, `translatorEnabled`, `upstreamTimeoutMs`, and optional `fetchImpl`/`now` test seams.

- [ ] **Step 1: Write a real-Express test harness and failing discovery/authorization tests**

Create `src/oauth-router.test.ts` with this harness:

```ts
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { afterEach, test } from 'node:test';
import express from 'express';

import { createOAuthRouter } from './oauth-router.js';

const servers: Server[] = [];

async function startRouter(fetchImpl: typeof fetch = globalThis.fetch, translatorEnabled = true) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(createOAuthRouter({
    resource: new URL('https://mcp.presscart.com/mcp'),
    authorizationServer: new URL('https://mcp.presscart.com'),
    upstreamIssuer: new URL('https://project.supabase.co/auth/v1'),
    translatorEnabled,
    upstreamTimeoutMs: 1_000,
    fetchImpl,
  }));
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

test('publishes facade metadata only when enabled', async () => {
  const enabled = await startRouter();
  assert.equal((await fetch(`${enabled}/.well-known/oauth-authorization-server`)).status, 200);
  const disabled = await startRouter(globalThis.fetch, false);
  assert.equal((await fetch(`${disabled}/.well-known/oauth-authorization-server`)).status, 404);
  const direct = await (await fetch(`${disabled}/.well-known/oauth-protected-resource/mcp`)).json();
  assert.deepEqual(direct.authorization_servers, ['https://project.supabase.co/auth/v1']);
});

test('redirects a valid S256 request to the fixed Supabase authorize endpoint', async () => {
  const base = await startRouter();
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: 'client-1',
    redirect_uri: 'https://client.example/callback',
    code_challenge: 'A'.repeat(43),
    code_challenge_method: 'S256',
    state: 'state-1',
    resource: 'https://mcp.presscart.com/mcp',
    scope: 'offline_access profile',
  });
  const response = await fetch(`${base}/oauth/authorize?${query}`, { redirect: 'manual' });
  const locationHeader = response.headers.get('location');
  assert(locationHeader);
  const location = new URL(locationHeader);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(location.origin + location.pathname, 'https://project.supabase.co/auth/v1/oauth/authorize');
  assert.equal(location.searchParams.get('scope'), 'profile');
  assert.equal(location.searchParams.get('state'), 'state-1');
  assert.equal(location.searchParams.get('resource'), 'https://mcp.presscart.com/mcp');
});

test('returns a local JSON error and never redirects an invalid scope', async () => {
  const base = await startRouter();
  const query = new URLSearchParams({
    response_type: 'code', client_id: 'client-1',
    redirect_uri: 'https://attacker.example/callback', code_challenge: 'A'.repeat(43),
    code_challenge_method: 'S256', scope: 'profile',
  });
  const response = await fetch(`${base}/oauth/authorize?${query}`, { redirect: 'manual' });
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('location'), null);
  assert.deepEqual(await response.json(), { error: 'invalid_scope', error_description: 'scope must contain profile and offline_access' });
});
```

Also add concrete cases for missing/duplicate scalar parameters, wrong `resource`, `plain` PKCE, request URLs over 8 KiB on each of `/oauth/authorize`, `/oauth/register`, and `/oauth/token`, both protected-resource routes, `Cache-Control`, and endpoint-specific 429 responses. The register/token URL-limit tests must send otherwise-valid POST requests with oversized query strings and assert that no upstream fetch occurs.

- [ ] **Step 2: Add failing DCR and token forwarding tests**

Use a `fetchImpl` stub that captures `input` and `init`. Assert all of the following with sentinel values:

```ts
const upstreamCalls: Array<{ url: string; init?: RequestInit }> = [];
const fetchImpl: typeof fetch = async (input, init) => {
  upstreamCalls.push({ url: String(input), init });
  return new Response(JSON.stringify({
    access_token: 'access-next', token_type: 'bearer', expires_in: 3600,
    refresh_token: 'refresh-next', scope: 'profile',
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};
```

- DCR posts only to `/auth/v1/oauth/clients/register`, translates scope to `profile`, enforces Supabase's redirect-count and UTF-8 metadata bounds locally, validates Supabase's UUID/client type/dynamic registration/timestamp/core-field response, restores `profile offline_access`, emits only the portable client-field allowlist, and rejects malformed/oversized responses.
- An exact Supabase HTTP 400 `validation_failed` DCR body maps to RFC 7591 `invalid_client_metadata` with a fixed description; malformed variants remain safe 502 responses and never expose `msg`.
- Authorization-code exchange forwards `code`, `code_verifier`, exact decoded `redirect_uri`, `client_id`, and optional exact canonical `resource` once.
- Refresh exchange forwards `refresh_token` once and returns the rotated token unchanged.
- `Authorization: Basic` is forwarded only to `/auth/v1/oauth/token`; bearer and arbitrary authorization schemes are rejected.
- `client_secret_post` remains in the form body and public clients use `client_id` without a secret.
- Every upstream fetch uses `redirect: 'manual'` and `AbortSignal`.
- `invalid_grant`, `invalid_client`, and `invalid_scope` keep their OAuth error names and 4xx status.
- Timeout/network failure becomes `temporarily_unavailable`; redirect/malformed success becomes `server_error` without raw upstream text.
- Token and registration responses carry `Cache-Control: no-store` and `Pragma: no-cache` where required.
- Sentinel code/token/secret values never appear in captured `console` output.

- [ ] **Step 3: Run route tests to prove RED**

Run in `presscart-mcp`:

```bash
node --import tsx --test src/oauth-router.test.ts
```

Expected: FAIL because `createOAuthRouter()` does not exist.

- [ ] **Step 4: Implement the router with fixed upstream targets and strict middleware**

Create `src/oauth-router.ts` with the following public interface and constants:

```ts
import express, { type NextFunction, type Request, type Response, type Router } from 'express';

import {
  OAuthProtocolError,
  createAuthorizationServerMetadata,
  createProtectedResourceMetadata,
  parseCanonicalResource,
  parseFacadeScope,
  translateRegistrationRequest,
  translateRegistrationResponse,
  translateTokenResponse,
} from './oauth-protocol.js';

export type OAuthRouterOptions = {
  resource: URL;
  authorizationServer: URL;
  upstreamIssuer: URL;
  translatorEnabled: boolean;
  upstreamTimeoutMs: number;
  fetchImpl?: typeof globalThis.fetch;
  now?: () => number;
};

const REQUEST_URL_LIMIT = 8 * 1024;
const FORM_BODY_LIMIT = '16kb';
const JSON_BODY_LIMIT = '32kb';
const RATE_LIMITS = {
  authorize: { max: 60, windowMs: 60_000 },
  register: { max: 20, windowMs: 60_000 },
  token: { max: 120, windowMs: 60_000 },
} as const;
```

`createOAuthRouter()` must derive upstream URLs only once from `upstreamIssuer`:

```ts
const upstreamBase = ensureTrailingSlash(options.upstreamIssuer);
const upstreamAuthorize = new URL('oauth/authorize', upstreamBase);
const upstreamRegister = new URL('oauth/clients/register', upstreamBase);
const upstreamToken = new URL('oauth/token', upstreamBase);
```

Mount both protected-resource metadata routes unconditionally. When the flag is off, use the upstream issuer and `openid profile`; do not mount facade AS/authorize/register/token endpoints. When on, mount metadata and the three facade endpoints.

Implement a separate in-memory fixed-window limiter instance per endpoint. Key it by `req.ip`, return HTTP 429 with `temporarily_unavailable` and `Retry-After`, and prune expired entries every 100 checks so unique IPs do not grow the map indefinitely.

Authorization must schema-check only `response_type`, `client_id`, `redirect_uri`, `code_challenge`, `code_challenge_method`, `state`, `resource`, and `scope`; reject arrays/duplicates and unknown parameters. Validate locally, then build a new URL against the fixed `upstreamAuthorize` value. Set `Cache-Control: no-store` on the successful 302 response before calling `res.redirect()`. Never fetch or follow a redirect and never use `redirect_uri` as a response target.

Registration must use `express.json({ limit: JSON_BODY_LIMIT, strict: true, type: 'application/json' })`; token must use `express.urlencoded({ extended: false, limit: FORM_BODY_LIMIT, type: 'application/x-www-form-urlencoded' })`. Build new upstream request bodies from parsed/validated allowlisted fields rather than forwarding raw bytes. Set `redirect: 'manual'`, use `AbortSignal.timeout(options.upstreamTimeoutMs)`, and forward no caller headers except a syntactically valid Basic authorization header on the token endpoint.

Before endpoint-specific parsing or rate-limit accounting, reject any request whose `req.originalUrl.length` exceeds `REQUEST_URL_LIMIT` on all three translator endpoints. Return a local `invalid_request` response with HTTP 414 and never contact Supabase. Body limits remain separate and still apply to registration and token requests.

Use one error responder:

```ts
function sendOAuthError(res: Response, error: string, description: string, status: number) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.status(status).json({ error, error_description: description });
}
```

For upstream 4xx OAuth responses, return only validated `error`, optional `error_description`, and optional `error_uri`. Treat 3xx, non-JSON, schema-invalid success, and 5xx as safe facade errors; never include raw response text. An Express error middleware at the end of this router must convert body-limit/parser errors to `invalid_request` without logging request content.

- [ ] **Step 5: Run the route tests and all MCP checks to prove GREEN**

Run in `presscart-mcp`:

```bash
node --import tsx --test src/oauth-router.test.ts
npm test
npm run check
npm run build
```

Expected: router tests and the full MCP suite pass; typecheck and build exit 0.

- [ ] **Step 6: Commit Task 3**

Invoke `$commit` in `presscart-mcp` with:

```text
feat(auth): add stateless OAuth refresh translator
```

---

### Task 4: Wire the translator into the hosted MCP server

**Files:**
- Create: `presscart-mcp/src/oauth-http.ts`
- Create: `presscart-mcp/src/oauth-http.test.ts`
- Modify: `presscart-mcp/src/http.ts`
- Modify: `presscart-mcp/README.md`

**Interfaces:**
- Consumes `createOAuthRouter()` from Task 3 and `SupabaseOAuthVerifier` from Task 1.
- Produces `createOAuthHttpLayer(options)`, which returns the translator/discovery `router` and the real MCP SDK `bearerAuth` middleware.
- Produces `validateOAuthSessionAuth(previous, next)`, which permits a new token string only for the same `clientId`, `sub`, and `oauth_grant_id`.
- Produces the hosted route graph and documented deployment contract.

- [ ] **Step 1: Add failing hosted-layer and session-binding tests**

Create `src/oauth-http.test.ts`. Mount the result of `createOAuthHttpLayer()` on a real Express app with a stub `OAuthTokenVerifier`, then request `/mcp` without a bearer token and assert:

```ts
assert.equal(response.status, 401);
assert.match(
  response.headers.get('www-authenticate') ?? '',
  /resource_metadata="https:\/\/mcp\.presscart\.com\/\.well-known\/oauth-protected-resource\/mcp"/
);
```

In the same file, construct `AuthInfo` fixtures and assert that a rotated token is returned when `clientId`, `extra.sub`, and `extra.oauth_grant_id` match even though `token` differs. Add one rejection test for each mismatched identity field, plus a missing-request-auth test.

- [ ] **Step 2: Run the focused test to prove RED against current wiring**

Run in `presscart-mcp`:

```bash
node --import tsx --test src/oauth-http.test.ts
```

Expected: FAIL because `oauth-http.ts` and its exported hosted/session seams do not exist.

- [ ] **Step 3: Implement the hosted OAuth layer without process side effects**

Create `src/oauth-http.ts` with this public assembly interface:

```ts
import { getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

import { createOAuthRouter, type OAuthRouterOptions } from './oauth-router.js';

export type OAuthHttpLayerOptions = OAuthRouterOptions & {
  serverUrl: URL;
  verifier: OAuthTokenVerifier;
};

export function createOAuthHttpLayer(options: OAuthHttpLayerOptions) {
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(options.serverUrl);
  return {
    router: createOAuthRouter(options),
    bearerAuth: requireBearerAuth({
      verifier: options.verifier,
      requiredScopes: [],
      resourceMetadataUrl,
    }),
    resourceMetadataUrl,
  };
}
```

Move `validateOAuthSessionAuth()` and its string-extra reader from `http.ts` into this module. Define and export `OAuthSessionAuthError` with `statusCode = 401`; preserve the current messages and comparisons. This module must not listen on a port, create timers, or read environment variables, so tests can import it safely.

- [ ] **Step 4: Replace manual discovery wiring in `src/http.ts` with guarded config**

Resolve all optional OAuth configuration in one narrowing function. Do not use non-null assertions:

```ts
function resolveOAuthRuntimeConfig() {
  if (env.MCP_OAUTH_TRANSLATOR_ENABLED && !env.MCP_OAUTH_ENABLED) {
    throw new Error('MCP_OAUTH_TRANSLATOR_ENABLED requires MCP_OAUTH_ENABLED=true.');
  }
  if (!env.MCP_OAUTH_ENABLED) return undefined;
  const issuer = resolveIssuerUrl();
  const resource = new URL(env.MCP_OAUTH_AUDIENCE);
  const legacy = env.MCP_OAUTH_LEGACY_AUDIENCE
    ? new URL(env.MCP_OAUTH_LEGACY_AUDIENCE)
    : undefined;
  const audiences: [URL, ...URL[]] = legacy ? [resource, legacy] : [resource];
  return { issuer, resource, audiences };
}
```

After validating that `resource` and `mcpServerUrl` differ by no more than a trailing slash, construct the verifier and layer only inside `if (oauthConfig)`, where TypeScript has narrowed every value:

```ts
const oauthVerifier = new SupabaseOAuthVerifier({
  issuerUrl: oauthConfig.issuer,
  audiences: oauthConfig.audiences,
  resource: oauthConfig.resource,
});
const oauthLayer = createOAuthHttpLayer({
  serverUrl: mcpServerUrl,
  verifier: oauthVerifier,
  resource: oauthConfig.resource,
  authorizationServer: new URL(mcpServerUrl.origin),
  upstreamIssuer: oauthConfig.issuer,
  translatorEnabled: env.MCP_OAUTH_TRANSLATOR_ENABLED,
  upstreamTimeoutMs: env.MCP_OAUTH_UPSTREAM_TIMEOUT_MS,
});
app.use(oauthLayer.router);
bearerAuth = oauthLayer.bearerAuth;
```

Mount the layer before `/mcp` and before the final 404 handler. Delete the duplicated protected-resource route handlers, direct `requireBearerAuth()` construction, and `createProtectedResourceMetadata()` from `http.ts`. Replace the private session validator call with the exported tested function. Update `resolveErrorStatus()` to recognize `OAuthSessionAuthError` as 401, and update `handleRouteError()` so `formatServerError(..., { exposeMessage })` exposes messages for both `HttpError` and `OAuthSessionAuthError`. Pass the layer's canonical `resourceMetadataUrl` to the centralized error handler so these 401 responses also carry a Bearer `WWW-Authenticate` challenge. Add an HTTP-layer assertion that a mismatched refreshed token returns 401 with the preserved grant-mismatch message and canonical resource-metadata challenge instead of `Internal server error`.

Do not derive upstream targets from `Host`, `Forwarded`, or request query/header values.

- [ ] **Step 5: Update operator and client documentation**

In `README.md`:

- change both audience examples to `https://mcp.presscart.com/mcp`;
- add `MCP_OAUTH_TRANSLATOR_ENABLED=false`, `MCP_OAUTH_LEGACY_AUDIENCE`, and `MCP_OAUTH_UPSTREAM_TIMEOUT_MS=10000`;
- explain that clients store and rotate refresh tokens and initiate refresh automatically;
- explain that the translator changes only MCP OAuth, not Presscart web sessions;
- list ChatGPT, Claude, Cursor, and Codex as standards-based consumers without vendor branches;
- document deployment order: dual audience -> app session-binding migration -> app hook -> wait one access-token lifetime -> translator flag -> replacement ChatGPT app -> remove legacy audience;
- state that UI wording such as Connect/Authenticate is controlled by the client platform.

- [ ] **Step 6: Run all MCP verification**

Run in `presscart-mcp`:

```bash
npm test
npm run check
npm run build
git diff --check
```

Expected: all tests pass, build/typecheck exit 0, and diff check is empty.

- [ ] **Step 7: Commit Task 4**

Invoke `$commit` in `presscart-mcp` with:

```text
feat(auth): wire hosted OAuth refresh lifecycle
```

---

### Task 5: Bind app-side refresh issuance to the signed Supabase session

**Files:**
- Create: `presscart-app/apps/api/prisma/migrations/*_add_oauth_grant_supabase_session_id/migration.sql`
- Modify: `presscart-app/apps/api/prisma/schema.prisma`
- Modify: `presscart-app/apps/api/src/controllers/oauth-grants/access-token-hook.ts`
- Modify/Create: focused controller, resolver, data-helper, grant-lifecycle, and revocation tests.
- Create/Modify: session binding/lookup helpers and OAuth grant create, resolve, and revoke services.

**Interfaces:**
- Consumes Supabase-signed `sub`, OAuth `client_id`, and `session_id` claims plus exact hook authentication methods `oauth_provider/authorization_code` and `token_refresh`.
- Persists `oauth_grants.supabase_session_id` as a nullable unique UUID. Initial issuance binds once under the user/client lock; refresh resolves only the exact stored session and never falls forward to another active grant.
- Produces claims with `aud=https://mcp.presscart.com/mcp`, preserved standard subject/session/lifetime claims, resolved `grant_id`, and no stale `permissions` claim.

- [ ] **Step 1: Add the session-binding migration and schema contract**

Add nullable unique `supabase_session_id UUID` to `access.oauth_grants`, update Prisma/generated types, and add data tests for bind-once, unique-session lookup, conflicts, and missing rows. The migration must be applied before any hook deployment that reads or writes the column.

- [ ] **Step 2: Add controller and integration tests to prove RED**

Cover both fresh Supabase claim sets:

1. `oauth_provider/authorization_code` with signed `sub`, `client_id`, and `session_id` binds an unbound active grant and returns canonical claims;
2. `token_refresh` with the same signed identity and no incoming custom `grant_id` resolves the exact session-bound grant;
3. missing/mismatched user, client, session, authentication method, revoked grant, deleted grant, or conflicting binding fails closed;
4. non-OAuth claims without a client identity remain unchanged;
5. `iat`, `exp`, `sub`, and `session_id` are preserved while stale `permissions` is stripped.

Exercise the real controller and resolver, mocking only data/network boundaries.

- [ ] **Step 3: Implement initial and refresh resolution**

Under the shared user/client advisory lock, initial issuance must bind an unbound grant once, return the same-session retry idempotently, or replace a differently bound active grant using the exact existing identity and permission links. Refresh must query by unique `supabase_session_id`, verify matching `sub` and `client_id`, and require that exact grant to remain active. Do not use an incoming custom `grant_id` as refresh input.

Set the canonical `/mcp` audience, retain the no-client early return for ordinary browser sessions, and accept only the exact Supabase authentication-method strings.

- [ ] **Step 4: Keep grant creation and revocation serialized**

Explicit approval and authenticated revocation use the same user/client lock. Revocation durably denies all active exact-pair grants before retryable Supabase consent/session cleanup so losing or old session families cannot refresh into a newer grant.

- [ ] **Step 5: Run focused and workspace checks to prove GREEN**

Run in `presscart-app`:

```bash
pnpm test run apps/api/src/controllers/oauth-grants/access-token-hook.test.ts apps/api/src/controllers/oauth-grants/access-token-hook.integration.test.ts apps/api/src/services/oauth-grant/resolve-oauth-grant-for-token-hook.test.ts apps/api/src/services/oauth-grant/revoke-oauth-grant.test.ts
pnpm type-check
```

Expected: all focused OAuth tests pass and the monorepo typecheck exits 0.

- [ ] **Step 6: Commit Task 5**

Invoke `$commit` in `presscart-app` with:

```text
feat(auth): bind OAuth refresh to Supabase sessions
```

---

### Task 6: Align the OAuth design and threat model

**Files:**
- Modify: `presscart-app/docs/superpowers/specs/presscart-mcp-account-oauth.md`
- Modify: `presscart-app/docs/design-docs/oauth-threat-model.md`

**Interfaces:**
- Consumes the implemented translator and audience contracts.
- Produces durable reviewer and operator guidance; no runtime interface.

- [ ] **Step 1: Update the app-side OAuth design document**

Make these exact semantic changes in `presscart-mcp-account-oauth.md`:

- audience becomes `https://mcp.presscart.com/mcp`;
- the protected resource advertises the MCP-origin authorization server while Supabase remains the token issuer;
- clients request `profile offline_access`, keep refresh tokens locally, and automatically call the refresh grant;
- the access-token hook uses signed `session_id`, `sub`, and `client_id` on initial issue and refresh, stores the nullable unique session binding, and never depends on an incoming custom `grant_id` during refresh;
- the session-binding migration is applied before the corresponding hook deployment;
- normal Presscart browser sessions are outside this translator.

- [ ] **Step 2: Update the threat model with translator-specific controls**

In `oauth-threat-model.md`, update T4/X1 to the canonical `/mcp` audience and add checklist rows for:

- facade/open-redirect prevention: local validation errors never use unverified redirect URIs;
- fixed upstream origin and disabled redirect following for registration/token proxy calls;
- exact `profile offline_access` facade set and no scope expansion;
- exact current Supabase DCR response validation and a portable facade output allowlist with no registration-management credentials;
- rotating refresh token replacement and `invalid_grant` handling;
- temporary legacy audience is verifier-only, never advertised/issued, and removed after migration.

Correct the stale statement that MCP account-level tokens require `permissions[]`; current code strips permissions and authorizes through the live grant.

- [ ] **Step 3: Run documentation and focused code verification**

Run in `presscart-app`:

```bash
pnpm test run apps/api/src/controllers/oauth-grants/access-token-hook.test.ts apps/api/src/controllers/oauth-grants/access-token-hook.integration.test.ts apps/api/src/services/oauth-grant/resolve-oauth-grant-for-token-hook.test.ts apps/api/src/services/oauth-grant/get-active-oauth-grant.test.ts
pnpm type-check
git diff --check
```

Expected: tests and typecheck pass; diff check is empty.

- [ ] **Step 4: Commit Task 6**

Invoke `$commit` in `presscart-app` with:

```text
docs(auth): document MCP refresh security boundary
```

---

### Task 7: Cross-repository verification and review gates

**Files:**
- Verify all changed files in both worktrees.
- Modify only files required to resolve review findings or failing checks.

**Interfaces:**
- Produces two clean, committed branches ready for the user's merge decision.

- [ ] **Step 1: Run the complete MCP gates**

Run in `presscart-mcp`:

```bash
npm test
npm run check
npm run build
git diff --check
git status --short
```

Expected: all tests pass, typecheck/build exit 0, diff check is empty, and status is clean.

- [ ] **Step 2: Run the app gates appropriate to the touched API/docs scope**

Run in `presscart-app`:

```bash
pnpm test run apps/api/src/controllers/oauth-grants/access-token-hook.test.ts apps/api/src/controllers/oauth-grants/access-token-hook.integration.test.ts apps/api/src/services/oauth-grant/resolve-oauth-grant-for-token-hook.test.ts apps/api/src/services/oauth-grant/get-active-oauth-grant.test.ts
pnpm type-check
pnpm --filter api build
git diff --check
git status --short
```

Expected: focused OAuth tests, typecheck, and the API workspace build pass; both git checks are clean.

- [ ] **Step 3: Run deterministic secret scans in both repositories**

For each branch, scan added diff lines for private keys, JWTs, provider tokens, and assignments to `secret`, `token`, `password`, or `client_secret`. Treat sentinel test values such as `access-next` as fixtures; any real credential is a blocker and must be rotated, not merely deleted.

- [ ] **Step 4: Run the project Codex review gate until APPROVE**

Invoke `$codex-review` in `presscart-mcp` for the full branch and in `presscart-app` for its full branch. Fix every Critical and Important finding with a failing regression test first, commit through `$commit`, and resume each review until it returns `APPROVE`.

- [ ] **Step 5: Run the required auth security reviewers**

Run each repository's configured security-reviewer against its branch diff. Explicitly cover open redirects, SSRF, token/code/secret logging, DCR credentials, PKCE downgrade, scope escalation, audience migration, refresh rotation, and normal-session isolation. Resolve all Critical/High findings.

- [ ] **Step 6: Re-run final verification after review fixes**

Repeat Steps 1-3. Record the exact passing test counts and build/typecheck results for handoff.

- [ ] **Step 7: Stop for the user's integration decision**

Present both branch names, worktree paths, commits, verification evidence, deployment order, and the manual live-client matrix. Do not merge, push, deploy, change production flags, or replace the published ChatGPT app without the user's explicit choice.

## Post-merge operational checklist

These are deployment/administrator actions, not repository implementation steps:

1. Deploy `presscart-mcp` with translator off, canonical audience configured, and `MCP_OAUTH_LEGACY_AUDIENCE=https://mcp.presscart.com` temporarily enabled.
2. Apply the `presscart-app` migration adding nullable unique `oauth_grants.supabase_session_id` and verify it completes.
3. Deploy the `presscart-app` hook and session-bound resolver so new/refreshed MCP tokens use `/mcp`.
4. Wait at least one full access-token lifetime and confirm legacy audience usage has drained.
5. Enable the translator in non-production, then production after discovery/code/refresh/revocation smoke tests pass.
6. Create and publish a replacement ChatGPT workspace app; keep the old app during the reconnection window.
7. Test ChatGPT, Claude, Cursor, and Codex before and after access-token expiry.
8. Remove the old published app and legacy audience only after the migration window and telemetry confirm they are unused.
