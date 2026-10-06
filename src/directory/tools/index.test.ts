import assert from 'node:assert/strict';
import { test } from 'node:test';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

process.env.PRESSCART_API_URL = 'https://api.presscart.test';
process.env.MCP_INTERNAL_AUTH_TOKEN = 'internal-token-placeholder';
delete process.env.PRESSCART_APP_URL;

const fixtures = await import('../api.fixtures.js');
const { connectInMemoryClient, jsonResponse, readTextContent, withStubbedFetch } = await import(
  '../mcp-client.fixtures.js'
);
const { DIRECTORY_PROFILES } = await import('../policy.js');
const { DIRECTORY_RESULT_SCHEMAS, getTeamResultSchema, listTeamsResultSchema } = await import(
  '../output-schemas.js'
);
const results = await import('../results.js');
const { DIRECTORY_READ_ONLY_ANNOTATION_REASON } = await import('./definition.js');
const {
  DIRECTORY_TOOL_DEFINITIONS,
  assertDirectoryToolCoverage,
  registerDirectoryToolDefinition,
  registerDirectoryTools,
} = await import('./index.js');

type ToolDefinition = NonNullable<ReturnType<typeof DIRECTORY_TOOL_DEFINITIONS.get>>;

const ids = fixtures.FIXTURE_IDS;
const oauthAuthInfo = {
  token: 'oauth-access-token',
  extra: {
    source: 'mcp',
    sub: ids.userId,
    oauth_grant_id: 'grant-1',
    email: 'buyer@example.com',
    first_name: 'Ada',
    last_name: 'Lovelace',
  },
};
const apiTokenAuthInfo = {
  token: 'api-token-placeholder',
  extra: { source: 'api_token', team_id: ids.teamId, presscart_api_token: 'api-token-placeholder' },
};

function directoryServer(authInfo: { token: string; extra: Record<string, unknown> } = oauthAuthInfo) {
  const server = new McpServer({ name: 'presscart-directory-test', version: '1.0.0' });
  registerDirectoryTools(server, DIRECTORY_PROFILES.openai, { getSessionAuthInfo: () => authInfo });
  return server;
}

function requireDefinition(name: Parameters<typeof DIRECTORY_TOOL_DEFINITIONS.get>[0]): ToolDefinition {
  const definition = DIRECTORY_TOOL_DEFINITIONS.get(name);
  assert.ok(definition, `missing definition for ${name}`);
  return definition;
}

type HandlerCase = {
  tool: Parameters<typeof DIRECTORY_TOOL_DEFINITIONS.get>[0];
  args: Record<string, unknown>;
  response: unknown;
  pathname: string;
  query: Array<[string, string]>;
  expected: unknown;
};

const handlerCases: HandlerCase[] = [
  {
    tool: 'list_teams',
    args: { limit: 10, page: 2 },
    response: fixtures.teamsListResponse(),
    pathname: '/teams',
    query: [['limit', '10'], ['page', '2']],
    expected: results.buildListTeamsResult(fixtures.teamsListResponse()),
  },
  {
    tool: 'get_team',
    args: { team_slug: ids.teamSlug },
    response: fixtures.teamBySlugResponse(),
    pathname: `/teams/slug/${ids.teamSlug}`,
    query: [],
    expected: results.buildGetTeamResult(fixtures.teamBySlugResponse()),
  },
  {
    tool: 'list_profiles',
    args: { team_id: ids.teamId, limit: 25 },
    response: fixtures.profilesListResponse(),
    pathname: `/teams/${ids.teamId}/profiles`,
    query: [['limit', '25']],
    expected: results.buildListProfilesResult(fixtures.profilesListResponse()),
  },
  {
    tool: 'list_profile_orders',
    args: {
      team_slug: ids.teamSlug,
      profile_id: ids.profileId,
      limit: 5,
      page: 1,
      start_date: '2026-01-01',
      end_date: '2026-03-31',
    },
    response: fixtures.profileOrdersListResponse(),
    pathname: `/teams/${ids.teamSlug}/profiles/${ids.profileId}/orders`,
    query: [
      ['limit', '5'],
      ['page', '1'],
      ['start_date', '2026-01-01'],
      ['end_date', '2026-03-31'],
    ],
    expected: results.buildListProfileOrdersResult(fixtures.profileOrdersListResponse()),
  },
  {
    tool: 'get_order',
    args: { team_slug: ids.teamSlug, order_id: ids.orderId },
    response: fixtures.orderDetailResponse(),
    pathname: `/teams/${ids.teamSlug}/orders/${ids.orderId}`,
    query: [],
    expected: results.buildGetOrderResult(fixtures.orderDetailResponse()),
  },
  {
    tool: 'list_campaigns',
    args: { team_slug: ids.teamSlug, profile_id: ids.profileId, search: 'Spring' },
    response: fixtures.profileCampaignsListResponse(),
    pathname: `/teams/${ids.teamSlug}/profiles/${ids.profileId}/campaigns`,
    query: [['search', 'Spring']],
    expected: results.buildListCampaignsResult(fixtures.profileCampaignsListResponse()),
  },
  {
    tool: 'get_campaign',
    args: { team_slug: ids.teamSlug, campaign_id: ids.campaignId },
    response: fixtures.campaignDetailResponse(),
    pathname: `/teams/${ids.teamSlug}/campaigns/${ids.campaignId}`,
    query: [],
    expected: results.buildGetCampaignResult(fixtures.campaignDetailResponse()),
  },
  {
    tool: 'list_campaign_articles',
    args: { team_slug: ids.teamSlug, campaign_id: ids.campaignId, profile_id: ids.profileId, page: 3 },
    response: fixtures.campaignArticlesResponse(),
    pathname: `/teams/${ids.teamSlug}/campaigns/${ids.campaignId}/articles`,
    query: [['page', '3']],
    expected: results.buildListCampaignArticlesResult(fixtures.campaignArticlesResponse(), {
      teamSlug: ids.teamSlug,
      campaignId: ids.campaignId,
      profileId: ids.profileId,
    }),
  },
  {
    tool: 'get_campaign_article_status',
    args: { team_slug: ids.teamSlug, campaign_id: ids.campaignId },
    response: fixtures.campaignArticleStatusCountResponse(),
    pathname: `/teams/${ids.teamSlug}/campaigns/${ids.campaignId}/articles/status-count`,
    query: [],
    expected: results.buildGetCampaignArticleStatusResult(
      fixtures.campaignArticleStatusCountResponse(),
    ),
  },
];

for (const item of handlerCases) {
  test(`${item.tool} issues one GET to its route and returns the builder output`, async () => {
    await withStubbedFetch(
      () => jsonResponse(item.response),
      async requests => {
        const { client, close } = await connectInMemoryClient(directoryServer());
        try {
          const result = await client.callTool({ name: item.tool, arguments: item.args });

          assert.equal(result.isError, undefined, readTextContent(result));
          assert.equal(requests.length, 1);
          const request = requests[0];
          assert.ok(request);
          assert.equal(request.method, 'GET');
          assert.equal(request.url.origin, 'https://api.presscart.test');
          assert.equal(request.url.pathname, item.pathname);
          assert.deepEqual([...request.url.searchParams.entries()], item.query);
          assert.equal(request.headers.get('authorization'), 'Bearer internal-token-placeholder');
          assert.equal(request.headers.get('x-presscart-oauth-grant-id'), 'grant-1');
          assert.deepEqual(result.structuredContent, item.expected);
          assert.equal(requireDefinition(item.tool).outputSchema.safeParse(result.structuredContent).success, true);
          assert.deepEqual(JSON.parse(readTextContent(result)), item.expected);
        } finally {
          await close();
        }
      },
    );
  });
}

test('get_user answers OAuth sessions from token claims without calling the API', async () => {
  await withStubbedFetch(
    () => jsonResponse({}),
    async requests => {
      const { client, close } = await connectInMemoryClient(directoryServer());
      try {
        const result = await client.callTool({ name: 'get_user', arguments: {} });
        assert.deepEqual(result.structuredContent, { id: ids.userId, name: 'Ada Lovelace' });
        assert.equal(requests.length, 0);
      } finally {
        await close();
      }
    },
  );
});

test('get_user reads GET /auth/token for API-token sessions and returns team_id only', async () => {
  await withStubbedFetch(
    () => jsonResponse(fixtures.apiTokenSessionResponse()),
    async requests => {
      const { client, close } = await connectInMemoryClient(directoryServer(apiTokenAuthInfo));
      try {
        const result = await client.callTool({ name: 'get_user', arguments: {} });
        assert.deepEqual(result.structuredContent, { team_id: ids.teamId });
        assert.equal(requests.length, 1);
        assert.equal(requests[0]?.method, 'GET');
        assert.equal(requests[0]?.url.pathname, '/auth/token');
        assert.equal(requests[0]?.headers.get('authorization'), 'Bearer api-token-placeholder');
      } finally {
        await close();
      }
    },
  );
});

test('unknown input fields are stripped and never forwarded to the API', async () => {
  await withStubbedFetch(
    () => jsonResponse(fixtures.teamsListResponse()),
    async requests => {
      const { client, close } = await connectInMemoryClient(directoryServer());
      try {
        const result = await client.callTool({
          name: 'list_teams',
          arguments: { limit: 3, include_archived: true, sort_by: 'name', filters: { x: 1 } },
        });
        assert.equal(result.isError, undefined);
        assert.deepEqual([...(requests[0]?.url.searchParams.entries() ?? [])], [['limit', '3']]);
      } finally {
        await close();
      }
    },
  );
});

test('list limits above 25 are rejected before any API call', async () => {
  await withStubbedFetch(
    () => jsonResponse(fixtures.teamsListResponse()),
    async requests => {
      const { client, close } = await connectInMemoryClient(directoryServer());
      try {
        const result = await client.callTool({ name: 'list_teams', arguments: { limit: 26 } });
        assert.equal(result.isError, true);
        assert.match(readTextContent(result), /Input validation error/);
        assert.equal(requests.length, 0);
      } finally {
        await close();
      }
    },
  );
});

test('error boundary maps API failures to fixed messages without bodies, URLs, or status text', async () => {
  const cases: Array<{ status: number; message: string }> = [
    { status: 401, message: 'Unauthorized' },
    { status: 403, message: 'Unauthorized' },
    { status: 404, message: 'Presscart API resource not found' },
    { status: 422, message: 'Presscart API rejected the request (422)' },
    { status: 500, message: 'Presscart API is unavailable' },
  ];

  for (const item of cases) {
    await withStubbedFetch(
      () =>
        new Response(
          JSON.stringify({ error: 'secret upstream detail', url: 'https://internal.example/db' }),
          { status: item.status, statusText: 'Leaky Status Text', headers: { 'content-type': 'application/json' } },
        ),
      async () => {
        const { client, close } = await connectInMemoryClient(directoryServer());
        try {
          const result = await client.callTool({
            name: 'get_team',
            arguments: { team_slug: ids.teamSlug },
          });
          assert.equal(result.isError, true);
          assert.equal(readTextContent(result), item.message, String(item.status));
          assert.equal(result.structuredContent, undefined);
        } finally {
          await close();
        }
      },
    );
  }
});

test('error boundary maps API timeouts and unexpected errors to fixed messages', async () => {
  await withStubbedFetch(
    () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    },
    async () => {
      const { client, close } = await connectInMemoryClient(directoryServer());
      try {
        const result = await client.callTool({ name: 'list_teams', arguments: {} });
        assert.equal(result.isError, true);
        assert.equal(readTextContent(result), 'Presscart API request timed out');
      } finally {
        await close();
      }
    },
  );

  await withStubbedFetch(
    () => {
      throw new Error('connect ECONNREFUSED https://api.presscart.test/teams?token=secret');
    },
    async () => {
      const { client, close } = await connectInMemoryClient(directoryServer());
      try {
        const result = await client.callTool({ name: 'list_teams', arguments: {} });
        assert.equal(result.isError, true);
        assert.equal(readTextContent(result), 'Internal server error');
      } finally {
        await close();
      }
    },
  );
});

test('error boundary never returns status text for unmapped statuses', async () => {
  await withStubbedFetch(
    () => new Response(null, { status: 300, statusText: 'Multiple Choices Leak' }),
    async () => {
      const { client, close } = await connectInMemoryClient(directoryServer());
      try {
        const result = await client.callTool({ name: 'get_team', arguments: { team_slug: ids.teamSlug } });
        assert.equal(result.isError, true);
        const text = readTextContent(result);
        assert.equal(text, 'Internal server error');
        assert.doesNotMatch(text, /Leak|300/);
      } finally {
        await close();
      }
    },
  );
});

test('error boundary maps an upstream HTTP 504 to the timed-out message', async () => {
  await withStubbedFetch(
    () => new Response('gateway detail', { status: 504, statusText: 'Gateway Leak' }),
    async () => {
      const { client, close } = await connectInMemoryClient(directoryServer());
      try {
        const result = await client.callTool({ name: 'get_team', arguments: { team_slug: ids.teamSlug } });
        assert.equal(result.isError, true);
        assert.equal(readTextContent(result), 'Presscart API request timed out');
      } finally {
        await close();
      }
    },
  );
});

test('error boundary reports a session without a credential as Unauthorized', async () => {
  await withStubbedFetch(
    () => {
      throw new Error('fetch must not be called without a credential');
    },
    async () => {
      const server = new McpServer({ name: 'presscart-directory-test', version: '1.0.0' });
      registerDirectoryTools(server, DIRECTORY_PROFILES.openai, { getSessionAuthInfo: () => undefined });
      const { client, close } = await connectInMemoryClient(server);
      try {
        const result = await client.callTool({ name: 'get_team', arguments: { team_slug: ids.teamSlug } });
        assert.equal(result.isError, true);
        assert.equal(readTextContent(result), 'Unauthorized');
      } finally {
        await close();
      }
    },
  );
});

test('an extra top-level or nested output key fails the call instead of leaking', async () => {
  const baseTeams = requireDefinition('list_teams');
  const baseTeam = requireDefinition('get_team');
  const leakyTopLevel: ToolDefinition = {
    ...baseTeams,
    outputSchema: listTeamsResultSchema,
    handler: async () => ({
      ...results.buildListTeamsResult(fixtures.teamsListResponse()),
      leaked_secret: 'leak-sentinel-top',
    }),
  };
  const leakyNested: ToolDefinition = {
    ...baseTeam,
    outputSchema: getTeamResultSchema,
    handler: async () => ({
      ...results.buildGetTeamResult(fixtures.teamBySlugResponse()),
      profiles: [{ id: ids.profileId, name: 'Acme Brand', email: 'leak-sentinel-nested' }],
    }),
  };

  const server = new McpServer({ name: 'presscart-directory-test', version: '1.0.0' });
  registerDirectoryToolDefinition(server, leakyTopLevel, {});
  registerDirectoryToolDefinition(server, leakyNested, {});
  const { client, close } = await connectInMemoryClient(server);
  try {
    for (const [name, args] of [
      ['list_teams', {}],
      ['get_team', { team_slug: ids.teamSlug }],
    ] as const) {
      const result = await client.callTool({ name, arguments: args });
      assert.equal(result.isError, true, name);
      assert.equal(readTextContent(result), 'Internal server error', name);
      assert.equal(result.structuredContent, undefined, name);
      assert.doesNotMatch(JSON.stringify(result), /leak-sentinel|leaked_secret|email/, name);
    }
  } finally {
    await close();
  }
});

test('every definition carries the read-only annotation reason and a strict output schema', () => {
  for (const [name, definition] of DIRECTORY_TOOL_DEFINITIONS) {
    assert.equal(definition.name, name);
    assert.equal(definition.annotationReason, DIRECTORY_READ_ONLY_ANNOTATION_REASON);
    assert.equal(definition.outputSchema, DIRECTORY_RESULT_SCHEMAS[name]);
    assertStrictDeep(definition.outputSchema, name);
  }
});

test('coverage check fails closed on a missing or duplicate definition', () => {
  const definitions = [...DIRECTORY_TOOL_DEFINITIONS.values()];
  assert.doesNotThrow(() => assertDirectoryToolCoverage(Object.values(DIRECTORY_PROFILES), definitions));
  assert.throws(
    () => assertDirectoryToolCoverage([DIRECTORY_PROFILES.openai], definitions.filter(d => d.name !== 'get_order')),
    /Directory profile "openai" lists tool "get_order" with 0 definitions; expected exactly 1\./,
  );
  assert.throws(
    () => assertDirectoryToolCoverage([DIRECTORY_PROFILES.openai], [...definitions, requireDefinition('get_order')]),
    /Directory profile "openai" lists tool "get_order" with 2 definitions; expected exactly 1\./,
  );
});

test('coverage check rejects duplicate definition names even when no profile lists them', () => {
  const definitions = [...DIRECTORY_TOOL_DEFINITIONS.values()];
  const unlisted = { ...DIRECTORY_PROFILES.openai, tools: [] };
  assert.doesNotThrow(() => assertDirectoryToolCoverage([unlisted], definitions));
  assert.throws(
    () => assertDirectoryToolCoverage([unlisted], [...definitions, requireDefinition('get_order')]),
    /Directory tool definition name "get_order" is defined 2 times; names must be globally unique\./,
  );
});

function assertStrictDeep(schema: z.ZodTypeAny, path: string): void {
  if (schema instanceof z.ZodObject) {
    assert.equal(schema._def.unknownKeys, 'strict', `${path} must be strict`);
    const shape: Record<string, z.ZodTypeAny> = schema.shape;
    for (const [key, child] of Object.entries(shape)) {
      assertStrictDeep(child, `${path}.${key}`);
    }
    return;
  }
  if (schema instanceof z.ZodArray) {
    assertStrictDeep(schema.element, `${path}[]`);
    return;
  }
  if (schema instanceof z.ZodNullable || schema instanceof z.ZodOptional) {
    assertStrictDeep(schema.unwrap(), path);
    return;
  }
  assert.ok(
    schema instanceof z.ZodString || schema instanceof z.ZodNumber || schema instanceof z.ZodBoolean,
    `${path} uses an unexpected schema type`,
  );
}

const slugTools: Array<{ name: string; args: Record<string, unknown>; response: () => unknown; path: (slug: string) => string }> = [
  {
    name: 'get_team',
    args: {},
    response: () => fixtures.teamBySlugResponse(),
    path: slug => `/teams/slug/${encodeURIComponent(slug)}`,
  },
  {
    name: 'list_campaigns',
    args: { profile_id: ids.profileId },
    response: () => fixtures.profileCampaignsListResponse(),
    path: slug => `/teams/${encodeURIComponent(slug)}/profiles/${ids.profileId}/campaigns`,
  },
];

for (const tool of slugTools) {
  test(`${tool.name} rejects malformed team_slug values before any API call`, async () => {
    const malformed = ['acme/../admin', 'acme?x=1', 'acme team', 'acme%2F', 'a'.repeat(129), 'a\\b', 'a#b', 'a&b', 'a=b', 'a\u0000b'];
    for (const team_slug of malformed) {
      await withStubbedFetch(
        () => jsonResponse(tool.response()),
        async requests => {
          const { client, close } = await connectInMemoryClient(directoryServer());
          try {
            const result = await client.callTool({ name: tool.name, arguments: { ...tool.args, team_slug } });
            assert.equal(result.isError, true, team_slug);
            assert.match(readTextContent(result), /Input validation error/);
            assert.equal(requests.length, 0, team_slug);
          } finally {
            await close();
          }
        },
      );
    }
  });

  test(`${tool.name} accepts real-world team slugs and encodes them in the path`, async () => {
    for (const team_slug of ['acme-co', 'k3j9x0p2qa', "o'neil.co"]) {
      await withStubbedFetch(
        () => jsonResponse(tool.response()),
        async requests => {
          const { client, close } = await connectInMemoryClient(directoryServer());
          try {
            const result = await client.callTool({ name: tool.name, arguments: { ...tool.args, team_slug } });
            assert.equal(result.isError, undefined, readTextContent(result));
            assert.equal(requests.length, 1, team_slug);
            assert.equal(requests[0]?.url.pathname, tool.path(team_slug));
          } finally {
            await close();
          }
        },
      );
    }
  });
}

for (const [tool, extra] of [
  ['get_team', {}],
  ['get_order', { order_id: ids.orderId }],
  ['get_campaign', { campaign_id: ids.campaignId }],
] as const) {
  test(`${tool} rejects dot-only team slugs before any API call`, async () => {
    await withStubbedFetch(
      () => jsonResponse({}),
      async requests => {
        const { client, close } = await connectInMemoryClient(directoryServer());
        try {
          for (const slug of ['.', '..', '...']) {
            const result = await client.callTool({ name: tool, arguments: { team_slug: slug, ...extra } });
            assert.equal(result.isError, true, `${tool} accepted ${slug}`);
            assert.match(readTextContent(result), /Input validation error/);
            assert.match(readTextContent(result), /only of dots/);
          }
          assert.equal(requests.length, 0);
        } finally {
          await close();
        }
      },
    );
  });
}

test('team slugs with internal dots still pass validation', async () => {
  await withStubbedFetch(
    () => jsonResponse(fixtures.teamBySlugResponse()),
    async requests => {
      const { client, close } = await connectInMemoryClient(directoryServer());
      try {
        for (const slug of ["o'neil.co", 'acme.co']) {
          const result = await client.callTool({ name: 'get_team', arguments: { team_slug: slug } });
          assert.equal(result.isError, undefined, readTextContent(result));
        }
        assert.equal(requests.length, 2);
      } finally {
        await close();
      }
    },
  );
});
