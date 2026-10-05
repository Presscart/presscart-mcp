import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export type ConnectedClient = {
  client: Client;
  close: () => Promise<void>;
};

// Connects a real SDK client to a real McpServer over the SDK's in-memory transport.
export async function connectInMemoryClient(server: McpServer): Promise<ConnectedClient> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'presscart-directory-test', version: '1.0.0' });
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

export type RecordedRequest = {
  method: string;
  url: URL;
  headers: Headers;
};

export type FetchResponder = (request: RecordedRequest) => Response | Promise<Response>;

// Stubs globalThis.fetch (the network boundary) for the duration of `run`.
export async function withStubbedFetch<T>(
  responder: FetchResponder,
  run: (requests: RecordedRequest[]) => Promise<T>
): Promise<T> {
  const requests: RecordedRequest[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const request: RecordedRequest = {
      method: init?.method ?? (input instanceof Request ? input.method : 'GET'),
      url,
      headers: new Headers(init?.headers),
    };
    requests.push(request);
    return responder(request);
  };

  try {
    return await run(requests);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function readTextContent(result: unknown) {
  if (typeof result !== 'object' || result === null || !('content' in result)) return '';
  const content = result.content;
  if (!Array.isArray(content)) return '';
  return content
    .map(entry =>
      typeof entry === 'object' && entry !== null && 'text' in entry && typeof entry.text === 'string'
        ? entry.text
        : ''
    )
    .join('');
}
