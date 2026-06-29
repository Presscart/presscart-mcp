import test from 'node:test';
import assert from 'node:assert/strict';

import { PresscartApiClient, PresscartApiError } from './api.js';

test('times out stalled upstream API requests', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = ((_input, init) => {
    const signal = init?.signal;
    return new Promise<Response>((_resolve, reject) => {
      const keepAlive = setTimeout(() => {}, 1_000);
      const rejectWithAbortReason = () => {
        clearTimeout(keepAlive);
        reject(signal?.reason);
      };

      if (signal?.aborted) {
        rejectWithAbortReason();
        return;
      }

      signal?.addEventListener('abort', rejectWithAbortReason, { once: true });
    });
  }) as typeof fetch;

  const client = new PresscartApiClient('https://api.presscart.test', 'token', 5);

  await assert.rejects(
    () => client.get('/slow'),
    error => error instanceof PresscartApiError && error.status === 504
  );
});

test('does not force JSON content type for multipart form requests', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let capturedHeaders: unknown;
  let capturedBody: unknown;

  globalThis.fetch = ((_input, init) => {
    capturedHeaders = init?.headers;
    capturedBody = init?.body;
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  }) as typeof fetch;

  const client = new PresscartApiClient('https://api.presscart.test', 'token', 5);
  const formData = new FormData();
  formData.append('files', new File([Buffer.from('pdf')], 'brief.pdf', { type: 'application/pdf' }));

  await client.postForm('/files/upload', formData);

  assert.ok(capturedBody instanceof FormData);
  assert.equal((capturedHeaders as Record<string, string>)['Content-Type'], undefined);
});

test('sends MCP delegated auth with internal bearer token and grant id', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let capturedHeaders: unknown;

  globalThis.fetch = ((_input, init) => {
    capturedHeaders = init?.headers;
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  }) as typeof fetch;

  const client = new PresscartApiClient(
    'https://api.presscart.test',
    {
      bearerToken: 'internal-token',
      oauthGrantId: 'grant-1',
    },
    5
  );

  await client.get('/teams');

  assert.equal(
    (capturedHeaders as Record<string, string>).Authorization,
    'Bearer internal-token'
  );
  assert.equal(
    (capturedHeaders as Record<string, string>)['x-presscart-oauth-grant-id'],
    'grant-1'
  );
});
