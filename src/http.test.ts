import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  closeServer,
  initializeRequest,
  listenOnLoopbackPort,
  sendMcp,
  type McpHttpResponse,
} from './http-app.fixtures.js';
import { startTestJwks } from './oauth-jwks.fixtures.js';

// Boots the real entrypoint so the production env wiring is covered, not just createHttpApp.
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const STARTUP_TIMEOUT_MS = 15_000;
const STOP_TIMEOUT_MS = 5_000;
// node:test has no default timeout, and sendMcp has no abort signal.
const REQUEST_TEST = { timeout: 10_000 };
const DIRECTORY_PATHS = ['/mcp/openai', '/mcp/claude-directory'] as const;

const jwks = await startTestJwks();
let child: ChildProcess | undefined;
let base: string;

before(async () => {
  const port = await findFreePort();
  base = `http://127.0.0.1:${port}`;
  child = spawnEntrypoint(port);
  await waitForListening(child);
});

after(async () => {
  if (child) await stopChild(child);
  await jwks.close();
});

test('a directory route refuses a token whose audience is the canonical /mcp resource', REQUEST_TEST, async () => {
  for (const path of DIRECTORY_PATHS) {
    const response = await initializeWith(path, '/mcp');
    assert.equal(response.status, 401, path);
    assert.equal(readResourceMetadata(response), metadataUrlFor(path), path);
  }
});

test('a directory route accepts a token whose audience is that route', REQUEST_TEST, async () => {
  for (const path of DIRECTORY_PATHS) {
    assert.equal((await initializeWith(path, path)).status, 200, path);
  }
});

test('/mcp accepts the canonical audience and refuses a directory audience', REQUEST_TEST, async () => {
  assert.equal((await initializeWith('/mcp', '/mcp')).status, 200);

  const directoryToken = await initializeWith('/mcp', '/mcp/openai');
  assert.equal(directoryToken.status, 401);
  assert.equal(readResourceMetadata(directoryToken), metadataUrlFor('/mcp'));
});

test('a token for one directory route is refused by another', REQUEST_TEST, async () => {
  const response = await initializeWith('/mcp/claude-directory', '/mcp/openai');
  assert.equal(response.status, 401);
  assert.equal(readResourceMetadata(response), metadataUrlFor('/mcp/claude-directory'));
});

test('/mcp accepts the legacy origin audience and a directory route refuses it', REQUEST_TEST, async () => {
  // An empty audience path signs the bare server origin, the form the verifier compares.
  assert.equal((await initializeWith('/mcp', '')).status, 200);

  const response = await initializeWith('/mcp/openai', '');
  assert.equal(response.status, 401);
  assert.equal(readResourceMetadata(response), metadataUrlFor('/mcp/openai'));
});

test('the entrypoint exits non-zero when its port is taken', { timeout: STARTUP_TIMEOUT_MS + STOP_TIMEOUT_MS }, async () => {
  const occupier = createServer();
  const entrypoint = spawnEntrypoint(await listenOnLoopbackPort(occupier));
  try {
    const { code, output } = await waitForExit(entrypoint);
    assert.equal(code, 1, output);
    assert.doesNotMatch(output, /listening on/);
    assert.match(output, /EADDRINUSE/);
  } finally {
    await stopChild(entrypoint);
    await closeServer(occupier);
  }
});

async function initializeWith(path: string, audiencePath: string) {
  return sendMcp(base, path, {
    body: initializeRequest(),
    headers: { authorization: `Bearer ${await jwks.sign(`${base}${audiencePath}`)}` },
  });
}

function metadataUrlFor(path: string) {
  return `${base}/.well-known/oauth-protected-resource${path}`;
}

function readResourceMetadata(response: McpHttpResponse) {
  return /resource_metadata="([^"]+)"/.exec(response.headers.get('www-authenticate') ?? '')?.[1];
}

async function findFreePort() {
  const server = createServer();
  const port = await listenOnLoopbackPort(server);
  await closeServer(server);
  return port;
}

function spawnEntrypoint(port: number) {
  const origin = `http://127.0.0.1:${port}`;
  return spawn(process.execPath, ['--import', 'tsx', 'src/http.ts'], {
    cwd: REPO_ROOT,
    env: {
      PATH: process.env.PATH,
      PRESSCART_API_URL: 'https://api.presscart.test',
      MCP_HOST: '127.0.0.1',
      PORT: String(port),
      MCP_SERVER_URL: `${origin}/mcp`,
      MCP_OAUTH_AUDIENCE: `${origin}/mcp`,
      MCP_OAUTH_LEGACY_AUDIENCE: origin,
      MCP_OAUTH_ENABLED: 'true',
      MCP_OAUTH_ISSUER_URL: jwks.issuer,
      MCP_DIRECTORY_PROFILES: 'openai,claude-directory',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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

function waitForExit(entrypoint: ChildProcess) {
  let output = '';
  entrypoint.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  entrypoint.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });

  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`entrypoint did not exit within ${STARTUP_TIMEOUT_MS}ms:\n${output}`));
    }, STARTUP_TIMEOUT_MS);
    // 'close' waits for stdio to drain, so the output is complete.
    entrypoint.once('close', code => {
      clearTimeout(timer);
      resolve({ code, output });
    });
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
