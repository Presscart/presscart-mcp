/** Port the presscart-mcp Express server listens on inside the container, matching the Dockerfile's `EXPOSE 8080`. */
export const CONTAINER_PORT = 8080;

// Proxy headers a client could forge, so the Worker drops them before setting its own.
const CLIENT_PROXY_HEADERS = [
  'x-forwarded-for',
  'forwarded',
  'x-forwarded-port',
  'x-forwarded-prefix',
  'x-forwarded-ssl',
  'x-forwarded-server',
  'x-real-ip',
  'true-client-ip',
  'x-original-forwarded-for',
  'x-original-host',
];

/** Returns the container-side URL, keeping the public hostname so the app's host check still matches. */
export function getContainerUrl(publicUrl: string): string {
  const url = new URL(publicUrl);
  url.protocol = 'http:';
  url.port = '';
  return url.toString();
}

/** Returns the headers sent to the container, with forwarding headers set only by the Worker. */
export function getForwardedHeaders(publicUrl: string, incoming: Headers): Headers {
  const url = new URL(publicUrl);
  const headers = new Headers(incoming);
  for (const name of CLIENT_PROXY_HEADERS) headers.delete(name);

  const clientAddress = incoming.get('cf-connecting-ip');
  if (clientAddress) headers.set('x-forwarded-for', clientAddress);

  headers.set('x-forwarded-proto', url.protocol.replace(':', ''));
  headers.set('x-forwarded-host', url.host);
  return headers;
}

/** Returns the container environment: every string setting from the Worker plus the port. */
export function getContainerEnvironment(settings: object): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(settings)) {
    if (typeof value === 'string') environment[name] = value;
  }
  environment.PORT = String(CONTAINER_PORT);
  return environment;
}

/** Returns a SHA-256 fingerprint of the environment that ignores key order. */
export async function getEnvironmentFingerprint(environment: Record<string, string>): Promise<string> {
  const entries = Object.keys(environment)
    .sort()
    .map(name => [name, environment[name]]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(entries)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
