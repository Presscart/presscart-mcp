import assert from 'node:assert/strict';
import test from 'node:test';

process.env.PRESSCART_API_URL = 'https://api.presscart.test';
process.env.MCP_INTERNAL_AUTH_TOKEN = 'internal-token';

const { registerCommentTools } = await import('./comments.js');

test('comments tools call the article-scoped comments API', async () => {
  const calls: Array<{ url: string; method?: string; body?: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const tools = registerTools();

    assert.equal(tools.has('get_comment'), false);
    assert.equal(tools.has('get_comments_count'), false);

    await tools.get('list_comments')?.handler(
      {
        article_id: '6b2f4eb8-46db-4ef2-9c44-46b94a7049c7',
      },
      mcpExtra()
    );

    await tools.get('create_comment')?.handler(
      {
        article_id: '6b2f4eb8-46db-4ef2-9c44-46b94a7049c7',
        comment_text: 'Looks good.',
      },
      mcpExtra()
    );

    await tools.get('archive_comment')?.handler(
      {
        article_id: '6b2f4eb8-46db-4ef2-9c44-46b94a7049c7',
        comment_id: 'abc123',
      },
      mcpExtra()
    );

    assert.equal(calls[0]?.method, 'GET');
    assert.equal(
      new URL(calls[0].url).pathname,
      '/articles/6b2f4eb8-46db-4ef2-9c44-46b94a7049c7/comments'
    );
    assert.equal(new URL(calls[0].url).searchParams.get('slug'), null);
    assert.equal(new URL(calls[0].url).searchParams.get('filters[entity_type]'), null);

    assert.equal(calls[1]?.method, 'POST');
    assert.equal(
      new URL(calls[1].url).pathname,
      '/articles/6b2f4eb8-46db-4ef2-9c44-46b94a7049c7/comments'
    );
    assert.equal(new URL(calls[1].url).searchParams.get('slug'), null);
    assert.match(calls[1].body ?? '', /Looks good/);

    assert.equal(calls[2]?.method, 'DELETE');
    assert.equal(
      new URL(calls[2].url).pathname,
      '/articles/6b2f4eb8-46db-4ef2-9c44-46b94a7049c7/comments/abc123/archive'
    );
    assert.equal(new URL(calls[2].url).searchParams.get('slug'), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

type RegisteredTool = {
  handler: (input: Record<string, unknown>, extra: unknown) => Promise<unknown>;
};

function registerTools() {
  const tools = new Map<string, RegisteredTool>();

  registerCommentTools(
    {
      registerTool(name: string, _config: unknown, handler: RegisteredTool['handler']) {
        tools.set(name, { handler });
      },
    } as never,
    {}
  );

  return tools;
}

function mcpExtra() {
  return {
    authInfo: {
      token: 'mcp-access-token',
      extra: {
        source: 'mcp',
        oauth_grant_id: 'grant-1',
      },
    },
  };
}
