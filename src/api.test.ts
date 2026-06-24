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
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }

      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  }) as typeof fetch;

  const client = new PresscartApiClient('https://api.presscart.test', 'token', 5);

  await assert.rejects(
    () => client.get('/slow'),
    error => error instanceof PresscartApiError && error.status === 504
  );
});
