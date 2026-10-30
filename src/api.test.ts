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

async function rejectedApiError(t: { after: (fn: () => void) => void }, status: number, body: unknown) {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    )) as typeof fetch;

  const client = new PresscartApiClient('https://api.presscart.test', 'token', 1_000);
  const error = await client.post('/teams/acme/products/listings', {}).catch((caught: unknown) => caught);
  assert.ok(error instanceof PresscartApiError);
  return error;
}

test('keeps the API message text out of a rejected request error', async t => {
  const error = await rejectedApiError(t, 400, {
    name: 'BadRequestError',
    message: 'internal detail sentinel',
  });

  assert.match(error.message, /400/);
  assert.doesNotMatch(error.message, /sentinel/);
});

test('names the invalid fields when the API rejects the request body', async t => {
  const error = await rejectedApiError(t, 400, {
    success: false,
    error: {
      name: 'ZodError',
      issues: [
        { code: 'invalid_type', path: ['min_delivery_days'], message: 'Required' },
        { code: 'invalid_type', path: ['max_delivery_days'], message: 'Required' },
      ],
    },
  });

  assert.match(error.message, /invalid fields: min_delivery_days, max_delivery_days/);
});

test('keeps API server error details out of the error message', async t => {
  const error = await rejectedApiError(t, 500, { name: 'Error', message: 'database password leaked' });

  assert.doesNotMatch(error.message, /database password/);
});

test('keeps authorization failure details out of the error message', async t => {
  const error = await rejectedApiError(t, 403, {
    success: false,
    error: { issues: [{ path: ['secret_sentinel'], message: 'Required' }] },
  });

  assert.doesNotMatch(error.message, /secret_sentinel/);
});

test('skips malformed validation issues and odd field names', async t => {
  const malformed = Array.from({ length: 5 }, () => ({ code: 'custom' }));
  const error = await rejectedApiError(t, 400, {
    success: false,
    error: {
      issues: [
        null,
        'bad',
        ...malformed,
        { path: 'not-a-list' },
        { path: ['<script>value with spaces'] },
        { path: ['example_links', 0, 'url'], message: 'Invalid url' },
      ],
    },
  });

  assert.equal(error.status, 400);
  assert.match(error.message, /invalid fields: example_links\.0\.url$/);
});

test('lists at most five invalid fields once each', async t => {
  const issues = ['a', 'a', 'b', 'c', 'd', 'e', 'f'].map(field => ({ path: [field], message: 'Required' }));
  const error = await rejectedApiError(t, 400, { success: false, error: { issues } });

  assert.match(error.message, /invalid fields: a, b, c, d, e$/);
});
