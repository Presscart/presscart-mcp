import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

import { SupabaseOAuthVerifier } from './supabase-oauth.js';

const canonical = new URL('https://mcp.presscart.com/mcp');
const legacy = new URL('https://mcp.presscart.com');
let issuer: URL;
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let closeJwks: () => Promise<void>;

before(async () => {
  const keys = await generateKeyPair('ES256');
  privateKey = keys.privateKey;
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'test-key', alg: 'ES256', use: 'sig' };
  const server = createServer((req, res) => {
    if (req.url !== '/.well-known/jwks.json') {
      res.writeHead(404).end();
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  issuer = new URL(`http://127.0.0.1:${address.port}/`);
  closeJwks = () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

after(async () => closeJwks());

async function token(audience: string) {
  return new SignJWT({ client_id: 'client-1', grant_id: '22222222-2222-2222-2222-222222222222' })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
    .setIssuer(issuer.href.replace(/\/$/, ''))
    .setSubject('11111111-1111-1111-1111-111111111111')
    .setAudience(audience)
    .setExpirationTime('5m')
    .sign(privateKey);
}

test('accepts the canonical audience and reports the canonical resource', async () => {
  const verifier = new SupabaseOAuthVerifier({ issuerUrl: issuer, audiences: [canonical], resource: canonical });
  const auth = await verifier.verifyAccessToken(await token(canonical.href));
  assert.equal(auth.resource?.href, canonical.href);
});

test('accepts a configured legacy audience but still reports the canonical resource', async () => {
  const verifier = new SupabaseOAuthVerifier({ issuerUrl: issuer, audiences: [canonical, legacy], resource: canonical });
  const auth = await verifier.verifyAccessToken(await token(legacy.href.replace(/\/$/, '')));
  assert.equal(auth.resource?.href, canonical.href);
});

test('rejects the legacy audience when compatibility is not configured', async () => {
  const verifier = new SupabaseOAuthVerifier({ issuerUrl: issuer, audiences: [canonical], resource: canonical });
  const signed = await token(legacy.href.replace(/\/$/, ''));
  await assert.rejects(() => verifier.verifyAccessToken(signed), /Invalid or expired token/);
});
