import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { startTestJwks, type TestJwks } from './oauth-jwks.fixtures.js';
import { SupabaseOAuthVerifier } from './supabase-oauth.js';

const canonical = new URL('https://mcp.presscart.com/mcp');
const legacy = new URL('https://mcp.presscart.com');
const openai = new URL('https://mcp.presscart.com/mcp/openai');
let jwks: TestJwks;
let issuer: URL;

before(async () => {
  jwks = await startTestJwks();
  issuer = new URL(jwks.issuer);
});

after(async () => jwks.close());

test('accepts the canonical audience and reports the canonical resource', async () => {
  const verifier = new SupabaseOAuthVerifier({ issuerUrl: issuer, audiences: [canonical], resource: canonical });
  const auth = await verifier.verifyAccessToken(await jwks.sign(canonical.href));
  assert.equal(auth.resource?.href, canonical.href);
});

test('accepts a configured legacy audience but still reports the canonical resource', async () => {
  const verifier = new SupabaseOAuthVerifier({ issuerUrl: issuer, audiences: [canonical, legacy], resource: canonical });
  const auth = await verifier.verifyAccessToken(await jwks.sign(legacy.href.replace(/\/$/, '')));
  assert.equal(auth.resource?.href, canonical.href);
});

test('rejects the legacy audience when compatibility is not configured', async () => {
  const verifier = new SupabaseOAuthVerifier({ issuerUrl: issuer, audiences: [canonical], resource: canonical });
  const signed = await jwks.sign(legacy.href.replace(/\/$/, ''));
  await assert.rejects(() => verifier.verifyAccessToken(signed), /Invalid or expired token/);
});

test('a directory verifier accepts only its own audience', async () => {
  const verifier = new SupabaseOAuthVerifier({ issuerUrl: issuer, audiences: [openai], resource: openai });
  assert.equal((await verifier.verifyAccessToken(await jwks.sign(openai.href))).resource?.href, openai.href);
  for (const audience of [canonical.href, legacy.href.replace(/\/$/, '')]) {
    const signed = await jwks.sign(audience);
    await assert.rejects(() => verifier.verifyAccessToken(signed), /Invalid or expired token/, audience);
  }
});

test('the canonical verifier rejects a directory-audience token', async () => {
  const verifier = new SupabaseOAuthVerifier({ issuerUrl: issuer, audiences: [canonical], resource: canonical });
  const directoryToken = await jwks.sign(openai.href);
  await assert.rejects(() => verifier.verifyAccessToken(directoryToken), /Invalid or expired token/);
});
