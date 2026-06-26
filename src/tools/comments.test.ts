import assert from 'node:assert/strict';
import test from 'node:test';

process.env.PRESSCART_API_URL = 'https://api.presscart.test';

const { registerCommentTools } = await import('./comments.js');

test('comments tools call the root comments API with team query context', async () => {
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
        team_slug: 'acme-team',
        entity_type: 'article',
        entity_id: '6b2f4eb8-46db-4ef2-9c44-46b94a7049c7',
      },
      oauthExtra('comments.lists')
    );

    await tools.get('create_comment')?.handler(
      {
        team_slug: 'acme-team',
        entity_type: 'article',
        entity_id: '6b2f4eb8-46db-4ef2-9c44-46b94a7049c7',
        comment_text: 'Looks good.',
      },
      oauthExtra('comments.create')
    );

    assert.equal(calls[0]?.method, 'GET');
    assert.equal(new URL(calls[0].url).pathname, '/comments');
    assert.equal(new URL(calls[0].url).searchParams.get('slug'), 'acme-team');
    assert.equal(
      new URL(calls[0].url).searchParams.get('filters[entity_type]'),
      'article'
    );

    assert.equal(calls[1]?.method, 'POST');
    assert.equal(new URL(calls[1].url).pathname, '/comments');
    assert.equal(new URL(calls[1].url).searchParams.get('slug'), 'acme-team');
    assert.match(calls[1].body ?? '', /Looks good/);
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

function oauthExtra(permission: string) {
  return {
    authInfo: {
      token: 'test-token',
      extra: {
        source: 'oauth',
        permissions: [permission],
      },
    },
  };
}
