import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTAINER_PORT,
  getContainerEnvironment,
  getContainerUrl,
  getEnvironmentFingerprint,
  getForwardedHeaders,
} from './forwarding.js';

test('container URL keeps the public host and path but uses plain HTTP without a port', () => {
  assert.equal(
    getContainerUrl('https://mcp.example.com:8443/mcp?session=1'),
    'http://mcp.example.com/mcp?session=1'
  );
});

test('forwarded headers drop client-supplied proxy headers and set the Worker values', () => {
  const incoming = new Headers({
    authorization: 'Bearer abc',
    'cf-connecting-ip': '203.0.113.7',
    'x-forwarded-for': '10.0.0.1',
    forwarded: 'for=10.0.0.1',
    'x-real-ip': '10.0.0.1',
    'true-client-ip': '10.0.0.1',
    'x-forwarded-host': 'evil.example.com',
    'x-forwarded-proto': 'http',
  });

  const headers = getForwardedHeaders('https://mcp.example.com/mcp', incoming);

  assert.equal(headers.get('authorization'), 'Bearer abc');
  assert.equal(headers.get('x-forwarded-for'), '203.0.113.7');
  assert.equal(headers.get('x-forwarded-host'), 'mcp.example.com');
  assert.equal(headers.get('x-forwarded-proto'), 'https');
  assert.equal(headers.get('forwarded'), null);
  assert.equal(headers.get('x-real-ip'), null);
  assert.equal(headers.get('true-client-ip'), null);
});

test('forwarded headers omit x-forwarded-for when Cloudflare gives no client address', () => {
  const headers = getForwardedHeaders('https://mcp.example.com/', new Headers({ 'x-forwarded-for': '10.0.0.1' }));

  assert.equal(headers.get('x-forwarded-for'), null);
});

test('container environment keeps only string settings and sets the container port', () => {
  const environment = getContainerEnvironment({
    MCP_SERVER_URL: 'https://mcp.example.com/mcp',
    MCP_CONTAINER: { binding: true },
    PORT: '1234',
  });

  assert.deepEqual(environment, {
    MCP_SERVER_URL: 'https://mcp.example.com/mcp',
    PORT: String(CONTAINER_PORT),
  });
});

test('environment fingerprint ignores key order and changes when a value changes', async () => {
  const first = await getEnvironmentFingerprint({ A: '1', B: '2' });
  const reordered = await getEnvironmentFingerprint({ B: '2', A: '1' });
  const changed = await getEnvironmentFingerprint({ A: '1', B: '3' });

  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(first, reordered);
  assert.notEqual(first, changed);
});
