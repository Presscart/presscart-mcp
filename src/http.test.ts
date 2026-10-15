import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

import { initializeRequest, sendMcp, type McpHttpResponse } from './http-app.fixtures.js';

// Boots the real entrypoint so the production env wiring is covered, not just createHttpApp.
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const STARTUP_TIMEOUT_MS = 15_000;
const STOP_TIMEOUT_MS = 5_000;
const DIRECTORY_PATHS = ['/mcp/openai', '/mcp/claude-directory'] as const;

let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let jwksServer: Server | undefined;
let issuer: string;
let child: ChildProcess | undefined;
let base: string;

before(async () => {
  const keys = await generateKeyPair('ES256');
  privateKey = keys.privateKey;
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'test-key', alg: 'ES256', use: 'sig' };
  jwksServer = createServer((req, res) => {
    if (req.url !== '/.well-known/jwks.json') {
      res.writeHead(404).end();
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  issuer = `http://127.0.0.1:${await listen(jwksServer)}`;

  const port = await findFreePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['--import', 'tsx', 'src/http.ts'], {
    cwd: REPO_ROOT,
    env: {
      PATH: process.env.PATH,
      PRESSCART_API_URL: 'https://api.presscart.test',
      MCP_HOST: '127.0.0.1',
      PORT: String(port),
      MCP_SERVER_URL: `${base}/mcp`,
      MCP_OAUTH_AUDIENCE: `${base}/mcp`,
      MCP_OAUTH_ENABLED: 'true',
      MCP_OAUTH_ISSUER_URL: issuer,
      MCP_DIRECTORY_PROFILES: 'openai,claude-directory',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForListening(child);
});

after(async () => {
  if (child) await stopChild(child);
  const server = jwksServer;
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  }
});

test('a directory route refuses a token whose audience is the canonical /mcp resource', async () => {
  for (const path of DIRECTORY_PATHS) {
    const response = await initializeWith(path, '/mcp');
    assert.equal(response.status, 401, path);
    assert.equal(readResourceMetadata(response), metadataUrlFor(path), path);
  }
});

test('a directory route accepts a token whose audience is that route', async () => {
  for (const path of DIRECTORY_PATHS) {
    assert.equal((await initializeWith(path, path)).status, 200, path);
  }
});

test('/mcp accepts the canonical audience and refuses a directory audience', async () => {
  assert.equal((await initializeWith('/mcp', '/mcp')).status, 200);

  const directoryToken = await initializeWith('/mcp', '/mcp/openai');
  assert.equal(directoryToken.status, 401);
  assert.equal(readResourceMetadata(directoryToken), metadataUrlFor('/mcp'));
});

test('a token for one directory route is refused by another', async () => {
  const response = await initializeWith('/mcp/claude-directory', '/mcp/openai');
  assert.equal(response.status, 401);
  assert.equal(readResourceMetadata(response), metadataUrlFor('/mcp/claude-directory'));
});

async function initializeWith(path: string, audiencePath: string) {
  return sendMcp(base, path, {
    body: initializeRequest(),
    headers: { authorization: `Bearer ${await token(`${base}${audiencePath}`)}` },
  });
}

async function token(audience: string) {
  return new SignJWT({ client_id: 'client-1', grant_id: '22222222-2222-2222-2222-222222222222' })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
    .setIssuer(issuer)
    .setSubject('11111111-1111-1111-1111-111111111111')
    .setAudience(audience)
    .setExpirationTime('5m')
    .sign(privateKey);
}

function metadataUrlFor(path: string) {
  return `${base}/.well-known/oauth-protected-resource${path}`;
}

function readResourceMetadata(response: McpHttpResponse) {
  return /resource_metadata="([^"]+)"/.exec(response.headers.get('www-authenticate') ?? '')?.[1];
}

async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  return address.port;
}

async function findFreePort() {
  const server = createServer();
  const port = await listen(server);
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

function waitForListening(entrypoint: ChildProcess) {
  let output = '';
  const capture = (chunk: Buffer) => {
    output += chunk.toString();
  };
  entrypoint.stdout?.on('data', capture);
  entrypoint.stderr?.on('data', capture);

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      settle();
      reject(new Error(`entrypoint did not start within ${STARTUP_TIMEOUT_MS}ms:\n${output}`));
    }, STARTUP_TIMEOUT_MS);
    const onData = () => {
      if (!output.includes('listening on')) return;
      settle();
      resolve();
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      settle();
      reject(new Error(`entrypoint exited (${code ?? signal}) before listening:\n${output}`));
    };
    function settle() {
      clearTimeout(timer);
      entrypoint.stdout?.off('data', onData);
      entrypoint.off('exit', onExit);
    }
    entrypoint.stdout?.on('data', onData);
    entrypoint.once('exit', onExit);
  });
}

async function stopChild(entrypoint: ChildProcess) {
  if (entrypoint.exitCode !== null || entrypoint.signalCode !== null) return;
  const exited = once(entrypoint, 'exit');
  entrypoint.kill('SIGTERM');
  const timer = setTimeout(() => entrypoint.kill('SIGKILL'), STOP_TIMEOUT_MS);
  await exited;
  clearTimeout(timer);
}
