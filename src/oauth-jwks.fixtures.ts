import { createServer, type Server } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

const KEY_ID = 'test-key';

export type TestJwks = {
  // No trailing slash: the form the verifier compares against the token's iss.
  issuer: string;
  sign: (audience: string) => Promise<string>;
  close: () => Promise<void>;
};

// Loopback issuer serving an ES256 JWKS; signs tokens with the claims the verifier requires.
export async function startTestJwks(): Promise<TestJwks> {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: KEY_ID, alg: 'ES256', use: 'sig' };
  const server = createServer((req, res) => {
    if (req.url !== '/.well-known/jwks.json') {
      res.writeHead(404).end();
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  const issuer = `http://127.0.0.1:${await listenOnLoopbackPort(server)}`;

  return {
    issuer,
    sign: audience =>
      new SignJWT({ client_id: 'client-1', grant_id: '22222222-2222-2222-2222-222222222222' })
        .setProtectedHeader({ alg: 'ES256', kid: KEY_ID })
        .setIssuer(issuer)
        .setSubject('11111111-1111-1111-1111-111111111111')
        .setAudience(audience)
        .setExpirationTime('5m')
        .sign(privateKey),
    close: () => closeServer(server),
  };
}

// Listens on a free loopback port and returns it; rejects if the server cannot bind.
export async function listenOnLoopbackPort(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  return address.port;
}

export function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close(error => (error ? reject(error) : resolve()));
  });
}
