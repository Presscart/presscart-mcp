import test from 'node:test';
import assert from 'node:assert/strict';

import { PresscartApiError } from '../api.js';
import { formatServerError } from './errors.js';

test('formats unauthorized upstream API errors as fail-safe client messages', () => {
  const error = new PresscartApiError('Presscart API request failed: 401 Unauthorized', 401, {
    detail: 'internal upstream body',
  });

  assert.equal(formatServerError(error), 'Unauthorized');
});

test('does not expose unexpected error details by default', () => {
  assert.equal(formatServerError(new Error('database password leaked')), 'Internal server error');
});

test('can expose intentionally public HTTP error messages', () => {
  assert.equal(
    formatServerError(new Error('Bad Request: Mcp-Session-Id header is required'), {
      exposeMessage: true,
    }),
    'Bad Request: Mcp-Session-Id header is required'
  );
});
