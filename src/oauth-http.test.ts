import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { afterEach, test } from 'node:test';

import express, { type NextFunction, type Request, type Response } from 'express';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

import {
  OAuthSessionAuthError,
  createOAuthHttpLayer,
  validateOAuthSessionAuth,
} from './oauth-http.js';
import { formatServerError } from './utils/errors.js';

const servers: Server[] = [];
const canonicalResource = new URL('https://mcp.presscart.com/mcp');
const sessionMismatchMessage =
  'Authorization token does not match the OAuth grant bound to the active MCP session.';

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server =>
    new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))));
});

function authInfo(overrides: Partial<AuthInfo> = {}): AuthInfo {
  return {
    token: 'access-current',
    clientId: 'client-1',
    scopes: ['profile'],
    expiresAt: Math.floor(Date.now() / 1000) + 3_600,
    extra: {
      sub: 'user-1',
      oauth_grant_id: 'grant-1',
    },
    ...overrides,
  };
}

function createLayer(verifier: OAuthTokenVerifier) {
  return createOAuthHttpLayer({
    serverUrl: canonicalResource,
    verifier,
    resource: canonicalResource,
    authorizationServer: new URL('https://mcp.presscart.com'),
    upstreamIssuer: new URL('https://project.supabase.co/auth/v1'),
    translatorEnabled: false,
    upstreamTimeoutMs: 1_000,
  });
}

async function listen(app: express.Express) {
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

function assertSessionMismatch(run: () => unknown) {
  assert.throws(run, error => {
    assert(error instanceof OAuthSessionAuthError);
    assert.equal(error.statusCode, 401);
    assert.equal(error.message, sessionMismatchMessage);
    return true;
  });
}

test('challenges unauthenticated MCP requests with canonical resource metadata', async () => {
  const verifier: OAuthTokenVerifier = {
    async verifyAccessToken(token) {
      return authInfo({ token });
    },
  };
  const layer = createLayer(verifier);
  const app = express();
  app.set('trust proxy', 1);
  app.use(layer.router);
  app.get('/mcp', layer.bearerAuth, (_req, res) => res.json({ ok: true }));

  const response = await fetch(`${await listen(app)}/mcp`);

  assert.equal(response.status, 401);
  assert.match(
    response.headers.get('www-authenticate') ?? '',
    /resource_metadata="https:\/\/mcp\.presscart\.com\/\.well-known\/oauth-protected-resource\/mcp"/
  );
});

test('accepts a rotated access token for the same OAuth session identity', () => {
  const previous = authInfo();
  const next = authInfo({ token: 'access-rotated' });

  assert.equal(validateOAuthSessionAuth(previous, next), next);
});

test('rejects a rotated access token from a different OAuth client', () => {
  assertSessionMismatch(() => validateOAuthSessionAuth(
    authInfo(),
    authInfo({ token: 'access-rotated', clientId: 'client-2' })
  ));
});

test('rejects a rotated access token for a different subject', () => {
  assertSessionMismatch(() => validateOAuthSessionAuth(
    authInfo(),
    authInfo({
      token: 'access-rotated',
      extra: { sub: 'user-2', oauth_grant_id: 'grant-1' },
    })
  ));
});

test('rejects a rotated access token from a different OAuth grant', () => {
  assertSessionMismatch(() => validateOAuthSessionAuth(
    authInfo(),
    authInfo({
      token: 'access-rotated',
      extra: { sub: 'user-1', oauth_grant_id: 'grant-2' },
    })
  ));
});

test('rejects missing request authentication', () => {
  assert.throws(
    () => validateOAuthSessionAuth(authInfo(), undefined),
    error => {
      assert(error instanceof OAuthSessionAuthError);
      assert.equal(error.statusCode, 401);
      assert.equal(error.message, 'Missing Authorization header');
      return true;
    }
  );
});

test('exposes a rotated-session mismatch as an HTTP 401', async () => {
  const previous = authInfo();
  const verifier: OAuthTokenVerifier = {
    async verifyAccessToken(token) {
      return authInfo({
        token,
        extra: { sub: 'user-1', oauth_grant_id: 'grant-2' },
      });
    },
  };
  const layer = createLayer(verifier);
  const app = express();
  app.set('trust proxy', 1);
  app.use(layer.router);
  app.get('/mcp', layer.bearerAuth, (req, res, next) => {
    try {
      validateOAuthSessionAuth(previous, req.auth);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const exposed = error instanceof OAuthSessionAuthError;
    res.status(exposed ? error.statusCode : 500).json({
      message: formatServerError(error, { exposeMessage: exposed }),
    });
  });

  const response = await fetch(`${await listen(app)}/mcp`, {
    headers: { authorization: 'Bearer access-rotated' },
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { message: sessionMismatchMessage });
});
