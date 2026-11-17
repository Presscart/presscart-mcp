import assert from 'node:assert/strict';
import test from 'node:test';

import { SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/sdk/types.js';

process.env.PRESSCART_API_URL ??= 'https://api.presscart.test';

const { buildServerCard } = await import('./server-card.js');
const { PACKAGE_VERSION } = await import('./version.js');

test('the card meets the v1 Server Card schema limits and names only identity and transport', () => {
  const card = buildServerCard(new URL('https://mcp.presscart.test/mcp'));
  assert.equal(card.$schema, 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json');
  assert.match(card.name, /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
  assert.ok(card.description.length >= 1 && card.description.length <= 100);
  assert.ok(card.title.length <= 100);
  assert.equal(card.version, PACKAGE_VERSION);
  assert.deepEqual(card.remotes, [
    {
      type: 'streamable-http',
      url: 'https://mcp.presscart.test/mcp',
      supportedProtocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
    },
  ]);
  // Tools vary per user and are listed at runtime; a card never carries them.
  assert.equal('tools' in card, false);
});
