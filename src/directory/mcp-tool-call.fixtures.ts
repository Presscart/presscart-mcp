import assert from 'node:assert/strict';

import {
  connectInMemoryClient,
  jsonResponse,
  withStubbedFetch,
  type RecordedRequest,
} from './mcp-client.fixtures.js';

const oauthAuthInfo = {
  token: 'oauth-access-token',
  extra: { source: 'mcp', sub: 'user-1', oauth_grant_id: 'grant-1' },
};

export type RecordedCall = RecordedRequest;

export type ToolResult = {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
};

// Calls a tool through the real registered handler; only globalThis.fetch is stubbed.
// Test files must set PRESSCART_API_URL / MCP_INTERNAL_AUTH_TOKEN before the first call,
// because the server module is imported lazily here.
export async function callTool(
  name: string,
  args: Record<string, unknown>,
  respond: (call: RecordedCall) => Response = () => jsonResponse({ ok: true })
) {
  const { createPresscartMcpServer } = await import('../server.js');

  return withStubbedFetch(respond, async calls => {
    const { client, close } = await connectInMemoryClient(
      createPresscartMcpServer({ getSessionAuthInfo: () => oauthAuthInfo })
    );
    try {
      const result = (await client
        .callTool({ name, arguments: args })
        .catch((error: unknown) => ({ isError: true, error }))) as ToolResult;
      return { result, calls };
    } finally {
      await close();
    }
  });
}

export function getJsonBody(call: RecordedCall | undefined) {
  assert.equal(typeof call?.body, 'string');
  return JSON.parse(call?.body as string);
}
