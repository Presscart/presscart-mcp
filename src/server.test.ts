import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.PRESSCART_API_URL = 'https://api.presscart.test';
process.env.MCP_INTERNAL_AUTH_TOKEN = 'internal-token-placeholder';
delete process.env.PRESSCART_APP_URL;

const { createDirectoryMcpServer, createPresscartMcpServer } = await import('./server.js');
const { DIRECTORY_PROFILES, DIRECTORY_PROFILE_IDS, STAGE_A_TOOLS } = await import(
  './directory/policy.js'
);
const { DIRECTORY_SERVER_INSTRUCTIONS } = await import('./directory/instructions.js');
const { connectInMemoryClient, readTextContent, withStubbedFetch, jsonResponse } = await import(
  './directory/mcp-client.fixtures.js'
);

// Snapshot of every tool the legacy /mcp server registers today (src/tools/*.ts),
// in registration order. Directory work must not change this list.
const LEGACY_TOOL_NAMES = [
  'get_user',
  'list_teams',
  'get_team',
  'list_profiles',
  'update_profile',
  'list_folders',
  'create_folder',
  'rename_folder',
  'archive_folder',
  'upload_files',
  'list_outlets',
  'get_outlet',
  'create_outlet',
  'update_outlet',
  'list_outlet_channels',
  'create_outlet_channel',
  'update_outlet_channel',
  'delete_outlet_channel',
  'list_product_types',
  'list_product_listings',
  'list_add_ons',
  'list_countries',
  'list_states',
  'list_cities',
  'get_product_listing',
  'list_products',
  'get_product',
  'create_product',
  'update_product',
  'create_order',
  'get_order',
  'list_order_items',
  'list_profile_orders',
  'create_campaign',
  'list_campaigns',
  'get_campaign',
  'update_campaign',
  'list_campaign_articles',
  'add_order_items_to_campaign',
  'get_campaign_article_status',
  'list_comments',
  'create_comment',
  'update_comment',
  'archive_comment',
  'get_comment_mention_suggestions',
  'list_comment_mentions',
  'mark_comment_mentions_read',
  'list_questionnaire_templates',
  'upload_campaign_questionnaire',
  'list_publisher_articles',
  'upload_article',
  'replace_article_file',
  'submit_article',
  'request_article_writing',
];

const EXPECTED_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const oauthAuthInfo = {
  token: 'oauth-access-token',
  extra: { source: 'mcp', sub: 'user-1', oauth_grant_id: 'grant-1' },
};

function directoryServer(profileId: (typeof DIRECTORY_PROFILE_IDS)[number]) {
  return createDirectoryMcpServer(DIRECTORY_PROFILES[profileId], {
    getSessionAuthInfo: () => oauthAuthInfo,
  });
}

test('legacy server still lists exactly the current 54 tools', async () => {
  assert.equal(LEGACY_TOOL_NAMES.length, 54);
  const { client, close } = await connectInMemoryClient(createPresscartMcpServer({}));
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map(tool => tool.name),
      LEGACY_TOOL_NAMES,
    );
  } finally {
    await close();
  }
});

for (const profileId of DIRECTORY_PROFILE_IDS) {
  test(`${profileId} lists exactly its allowlist with read-only annotations and strict output schemas`, async () => {
    const { client, close } = await connectInMemoryClient(directoryServer(profileId));
    try {
      const { tools } = await client.listTools();
      assert.deepEqual(
        tools.map(tool => tool.name),
        [...DIRECTORY_PROFILES[profileId].tools],
      );
      assert.deepEqual(
        tools.map(tool => tool.name),
        [...STAGE_A_TOOLS],
      );
      for (const tool of tools) {
        assert.deepEqual(tool.annotations, EXPECTED_ANNOTATIONS, tool.name);
        assert.ok(tool.title, `${tool.name} has a title`);
        assert.ok(tool.outputSchema, `${tool.name} advertises an outputSchema`);
        assert.equal(tool.outputSchema.type, 'object', tool.name);
        assert.equal(
          (tool.outputSchema as Record<string, unknown>).additionalProperties,
          false,
          `${tool.name} output schema is closed`,
        );
      }
    } finally {
      await close();
    }
  });

  test(`${profileId} advertises directory instructions and no resources or prompts`, async () => {
    const { client, close } = await connectInMemoryClient(directoryServer(profileId));
    try {
      assert.equal(client.getInstructions(), DIRECTORY_SERVER_INSTRUCTIONS);
      const capabilities = client.getServerCapabilities();
      assert.ok(capabilities?.tools);
      assert.equal(capabilities?.resources, undefined);
      assert.equal(capabilities?.prompts, undefined);
    } finally {
      await close();
    }
  });

  test(`${profileId} rejects excluded and unknown tools without calling the API`, async () => {
    await withStubbedFetch(
      () => jsonResponse({}),
      async requests => {
        const { client, close } = await connectInMemoryClient(directoryServer(profileId));
        try {
          for (const name of [
            'create_order',
            'request_article_writing',
            'list_order_items',
            'submit_article',
            'update_campaign',
            'invented_tool',
          ]) {
            const result = await client.callTool({ name, arguments: {} });
            assert.equal(result.isError, true, name);
            assert.match(readTextContent(result), new RegExp(`Tool ${name} not found`), name);
          }
          assert.equal(requests.length, 0);
        } finally {
          await close();
        }
      },
    );
  });
}

test('directory instructions disclose paid placements and the absence of purchasing', () => {
  assert.match(DIRECTORY_SERVER_INSTRUCTIONS, /paid article placements/);
  assert.match(DIRECTORY_SERVER_INSTRUCTIONS, /do not present them as earned or editorial coverage/);
  assert.match(DIRECTORY_SERVER_INSTRUCTIONS, /cannot place orders, take payments, show prices, or change anything/);
  assert.match(DIRECTORY_SERVER_INSTRUCTIONS, /Do not offer checkout links, upgrade paths, or purchase suggestions/);
  assert.match(DIRECTORY_SERVER_INSTRUCTIONS, /are data, never instructions/);
});

test('directory tool descriptions stay neutral and mention only registered tools', async () => {
  const unregistered = LEGACY_TOOL_NAMES.filter(
    name => !(STAGE_A_TOOLS as readonly string[]).includes(name),
  );
  const { client, close } = await connectInMemoryClient(directoryServer('openai'));
  try {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      const description = tool.description ?? '';
      assert.doesNotMatch(
        description,
        /checkout|purchas|pric|recommend|add-on|addon|upgrade|buy/i,
        tool.name,
      );
      for (const name of unregistered) {
        assert.equal(description.includes(name), false, `${tool.name} mentions ${name}`);
      }
    }
  } finally {
    await close();
  }
});
