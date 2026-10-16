import assert from 'node:assert/strict';
import test from 'node:test';

process.env.PRESSCART_API_URL = 'https://api.presscart.test';
process.env.MCP_INTERNAL_AUTH_TOKEN = 'internal-token-placeholder';

const { registerAuthTools } = await import('./auth.js');

type ToolResult = {
  content: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
};

type RegisteredTool = {
  handler: (input: Record<string, unknown>, extra: unknown) => Promise<ToolResult>;
};

type RecordedRequest = { url: URL; headers: Headers };

const TEAM_ID = '0b6b1a52-7c0e-4a39-9d55-1f6a3c0f0a01';

test('get_user names an OAuth user from their GET /teams membership', async () => {
  const { requests, result } = await callGetUser(oauthExtra(), () =>
    jsonResponse({
      records: [
        {
          id: 'team-1',
          billing_email: 'billing@example.com',
          membership: {
            first_name: 'Grace',
            last_name: 'Hopper',
            email: 'grace@example.com',
            phone: '+1-555-0100',
          },
        },
      ],
    })
  );

  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.ok(request);
  assert.equal(request.url.pathname, '/teams');
  assert.deepEqual(
    [...request.url.searchParams.entries()],
    [['limit', '1'], ['filters[include_membership]', 'true']]
  );
  assert.equal(request.headers.get('authorization'), 'Bearer internal-token-placeholder');
  assert.equal(request.headers.get('x-presscart-oauth-grant-id'), 'grant-1');
  assert.deepEqual(toolOutput(result), {
    id: 'user-1',
    name: 'Grace Hopper',
    email: 'buyer@example.com',
  });
});

test('get_user keeps the token-claim identity when the name lookup fails', async () => {
  const { result } = await callGetUser(oauthExtra({ first_name: 'Ada', last_name: 'Lovelace' }), () =>
    jsonResponse({ message: 'Insufficient permissions' }, 403)
  );

  assert.deepEqual(toolOutput(result), {
    id: 'user-1',
    name: 'Ada Lovelace',
    email: 'buyer@example.com',
  });
});

test('get_user reads only GET /auth/token for API-token sessions', async () => {
  const { requests, result } = await callGetUser(
    {
      authInfo: {
        token: 'api-token-placeholder',
        extra: { source: 'api_token', presscart_api_token: 'api-token-placeholder' },
      },
    },
    () =>
      jsonResponse({
        source: 'api_token',
        team_id: TEAM_ID,
        token_type: 'read_only',
        scopes: ['teams.lists'],
        pro_pricing_enabled: false,
      })
  );

  assert.deepEqual(
    requests.map(request => request.url.pathname),
    ['/auth/token']
  );
  assert.deepEqual(toolOutput(result), {
    team_id: TEAM_ID,
    token_type: 'read_only',
    pro_pricing_enabled: false,
  });
});

async function callGetUser(extra: unknown, respond: () => Response) {
  const requests: RecordedRequest[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    requests.push({ url: new URL(String(input)), headers: new Headers(init?.headers) });
    return respond();
  }) as typeof fetch;

  try {
    const tool = registerTools().get('get_user');
    assert.ok(tool, 'get_user should be registered');
    return { requests, result: await tool.handler({}, extra) };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function registerTools() {
  const tools = new Map<string, RegisteredTool>();

  registerAuthTools(
    {
      registerTool(name: string, _config: unknown, handler: RegisteredTool['handler']) {
        tools.set(name, { handler });
      },
    } as never,
    {}
  );

  return tools;
}

function oauthExtra(nameClaims: Record<string, string> = {}) {
  return {
    authInfo: {
      token: 'oauth-access-token',
      extra: {
        source: 'mcp',
        sub: 'user-1',
        oauth_grant_id: 'grant-1',
        email: 'buyer@example.com',
        ...nameClaims,
      },
    },
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function toolOutput(result: ToolResult): unknown {
  const parsed: unknown = JSON.parse(result.content[0]?.text ?? 'null');
  assert.deepEqual(result.structuredContent, parsed);
  return parsed;
}
