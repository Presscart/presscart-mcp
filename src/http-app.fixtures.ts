import { createServer, type Server } from 'node:http';

import type { Express } from 'express';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';

export const TEST_API_ORIGIN = 'https://api.presscart.test';

// Presscart API settings every createHttpApp test config needs.
export const TEST_PRESSCART_API_SETTINGS = {
  presscartApiUrl: TEST_API_ORIGIN,
  presscartApiTimeoutMs: 5_000,
};

export type ApiCall = { url: URL; method: string; headers: Headers };

// Stubs globalThis.fetch for the Presscart API origin only (the network boundary);
// requests to the local test server go through the real fetch.
export function stubPresscartApi(
  respond: (call: ApiCall) => Response | Promise<Response>
): { calls: ApiCall[]; restore: () => void } {
  const originalFetch = globalThis.fetch;
  const calls: ApiCall[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== TEST_API_ORIGIN) return originalFetch(input, init);
    const call: ApiCall = { url, method: init?.method ?? 'GET', headers: new Headers(init?.headers) };
    calls.push(call);
    return respond(call);
  };
  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

export function apiJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function listenOnLoopback(app: Express) {
  const server = createServer(app);
  const port = await listenOnLoopbackPort(server);
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => closeServer(server),
  };
}

// Listens on a free loopback port and returns it; rejects if the server cannot bind.
export async function listenOnLoopbackPort(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  return address.port;
}

export function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close(error => (error ? reject(error) : resolve()));
  });
}

export type McpHttpResponse = { status: number; headers: Headers; body: unknown };

export async function sendMcp(
  base: string,
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<McpHttpResponse> {
  const response = await fetch(`${base}${path}`, {
    method: init.method ?? 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return { status: response.status, headers: response.headers, body: await readMcpBody(response) };
}

export function initializeRequest(id = 1) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'presscart-http-test', version: '1.0.0' },
    },
  };
}

export function sessionHeaders(sessionId: string, extra: Record<string, string> = {}) {
  return { 'mcp-session-id': sessionId, 'mcp-protocol-version': LATEST_PROTOCOL_VERSION, ...extra };
}

export async function initializeSession(
  base: string,
  path: string,
  headers: Record<string, string> = {}
): Promise<string> {
  const response = await sendMcp(base, path, { body: initializeRequest(), headers });
  if (response.status !== 200) {
    throw new Error(`initialize on ${path} failed with ${response.status}: ${JSON.stringify(response.body)}`);
  }
  const sessionId = response.headers.get('mcp-session-id');
  if (!sessionId) throw new Error(`initialize on ${path} returned no mcp-session-id`);
  return sessionId;
}

export async function listToolNames(
  base: string,
  path: string,
  sessionId: string,
  headers: Record<string, string> = {}
) {
  const response = await sendMcp(base, path, {
    body: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    headers: sessionHeaders(sessionId, headers),
  });
  if (response.status !== 200) {
    throw new Error(`tools/list on ${path} failed with ${response.status}`);
  }
  return readResult(response.body, 'tools').map(tool => {
    if (typeof tool === 'object' && tool !== null && 'name' in tool && typeof tool.name === 'string') {
      return tool.name;
    }
    throw new Error('tools/list returned a tool without a name');
  });
}

export function readResult(body: unknown, key: string): unknown[] {
  if (typeof body !== 'object' || body === null || !('result' in body)) {
    throw new Error(`expected a JSON-RPC result, got ${JSON.stringify(body)}`);
  }
  const result = body.result;
  if (typeof result !== 'object' || result === null || !(key in result)) {
    throw new Error(`expected result.${key}, got ${JSON.stringify(result)}`);
  }
  const value: unknown = (result as Record<string, unknown>)[key];
  if (!Array.isArray(value)) throw new Error(`expected result.${key} to be an array`);
  return value;
}

async function readMcpBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return null;
  if ((response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const data = text
      .split('\n')
      .filter(line => line.startsWith('data: '))
      .map(line => line.slice('data: '.length));
    const first = data[0];
    return first === undefined ? null : JSON.parse(first);
  }
  return JSON.parse(text);
}
