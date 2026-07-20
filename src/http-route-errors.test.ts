import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { afterEach, test } from 'node:test';

import express from 'express';
import type { Request } from 'express';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

import { PresscartApiError } from './api.js';
import {
  HttpError,
  createHttpRouteErrorHandler,
} from './http-route-errors.js';
import { validateOAuthSessionAuth } from './oauth-http.js';

const servers: Server[] = [];
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

async function requestThroughHandler(errorFactory: () => unknown) {
  const logged: Array<{
    req: Request;
    statusCode: number;
    error: unknown;
  }> = [];
  const app = express();
  app.get('/mcp', (_req, _res, next) => {
    try {
      throw errorFactory();
    } catch (error) {
      next(error);
    }
  });
  app.use(createHttpRouteErrorHandler({
    resourceMetadataUrl: 'https://mcp.presscart.com/.well-known/oauth-protected-resource/mcp',
    logRouteError(req, statusCode, error) {
      logged.push({ req, statusCode, error });
    },
  }));

  const server = createServer(app);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');

  const response = await fetch(`http://127.0.0.1:${address.port}/mcp`);
  return { response, logged };
}

test('production handler exposes OAuth session mismatches as JSON-RPC 401 responses', async () => {
  const previous = authInfo();
  const next = authInfo({
    token: 'access-rotated',
    extra: { sub: 'user-1', oauth_grant_id: 'grant-2' },
  });
  const { response, logged } = await requestThroughHandler(() => {
    validateOAuthSessionAuth(previous, next);
  });

  assert.equal(response.status, 401);
  assert.equal(
    response.headers.get('www-authenticate'),
    `Bearer error="invalid_token", error_description="${sessionMismatchMessage}", resource_metadata="https://mcp.presscart.com/.well-known/oauth-protected-resource/mcp"`,
  );
  assert.deepEqual(await response.json(), {
    jsonrpc: '2.0',
    error: { code: -32000, message: sessionMismatchMessage },
    id: null,
  });
  assert.equal(logged.length, 1);
  assert.equal(logged[0]?.req.method, 'GET');
  assert.equal(logged[0]?.req.path, '/mcp');
  assert.equal(logged[0]?.statusCode, 401);
  assert.equal(logged[0]?.error instanceof Error, true);
});

test('production handler preserves intentional HttpError status and message', async () => {
  const { response } = await requestThroughHandler(
    () => new HttpError(400, 'Public request error')
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Public request error' },
    id: null,
  });
});

test('production handler maps Presscart authorization errors to safe 401 responses', async () => {
  const { response } = await requestThroughHandler(
    () => new PresscartApiError('upstream details', 403, { secret: 'must-not-escape' })
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Unauthorized' },
    id: null,
  });
});

test('production handler hides unrelated internal error messages', async () => {
  const { response } = await requestThroughHandler(
    () => new Error('database password must-not-escape')
  );

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Internal server error' },
    id: null,
  });
});
