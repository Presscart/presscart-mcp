import { env } from './env.js';
import { createHttpApp, type HttpAppOAuthConfig } from './http-app.js';
import {
  resolveOAuthAudiences,
  validatePublicOAuthUrl,
  validateUpstreamIssuer,
} from './oauth-protocol.js';
import { SupabaseOAuthVerifier } from './supabase-oauth.js';

const SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const KNOWN_REMOTE_MCP_CLIENT_ORIGINS = ['https://claude.ai', 'https://claude.com'];

const mcpServerUrl = resolveMcpServerUrl();
const oauthConfig = resolveOAuthRuntimeConfig();
const allowedOrigins = resolveAllowedOrigins(mcpServerUrl);

const httpApp = createHttpApp({
  host: env.MCP_HOST,
  mcpServerUrl,
  allowedHosts: env.MCP_ALLOWED_HOSTS ? resolveAllowedHostnames(mcpServerUrl) : undefined,
  allowedOrigins,
  sessionIdleTtlMs: env.MCP_SESSION_IDLE_TTL_MS,
  oauth: oauthConfig,
});

const cleanupTimer = setInterval(() => httpApp.cleanupExpiredState(), SESSION_CLEANUP_INTERVAL_MS);
cleanupTimer.unref();

const server = httpApp.app.listen(env.MCP_PORT, env.MCP_HOST, () => {
  console.info(`Presscart MCP server listening on http://${env.MCP_HOST}:${env.MCP_PORT}/mcp`);
});

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

async function shutdown() {
  clearInterval(cleanupTimer);
  await httpApp.closeAllSessions();
  server.close(() => process.exit(0));
}

function resolveMcpServerUrl() {
  if (env.MCP_SERVER_URL) return new URL(env.MCP_SERVER_URL);

  const host =
    env.MCP_HOST === '0.0.0.0' || env.MCP_HOST === '::' ? '127.0.0.1' : env.MCP_HOST;
  const protocol = host === '127.0.0.1' || host === 'localhost' || host === '::1' ? 'http' : 'https';
  return new URL(`${protocol}://${host}:${env.MCP_PORT}/mcp`);
}

function resolveIssuerUrl() {
  if (!env.MCP_OAUTH_ISSUER_URL) {
    throw new Error('MCP_OAUTH_ISSUER_URL is required when MCP_OAUTH_ENABLED=true.');
  }

  return new URL(env.MCP_OAUTH_ISSUER_URL);
}

function resolveOAuthRuntimeConfig(): HttpAppOAuthConfig | undefined {
  if (env.MCP_OAUTH_TRANSLATOR_ENABLED && !env.MCP_OAUTH_ENABLED) {
    throw new Error('MCP_OAUTH_TRANSLATOR_ENABLED requires MCP_OAUTH_ENABLED=true.');
  }

  if (!env.MCP_OAUTH_ENABLED) return undefined;

  validatePublicOAuthUrl(mcpServerUrl, 'MCP_SERVER_URL');
  const issuer = resolveIssuerUrl();
  validateUpstreamIssuer(issuer);
  const resource = new URL(env.MCP_OAUTH_AUDIENCE);
  validatePublicOAuthUrl(resource, 'MCP_OAUTH_AUDIENCE');
  validateOAuthResourceUrl(resource, mcpServerUrl);
  const legacy = env.MCP_OAUTH_LEGACY_AUDIENCE
    ? new URL(env.MCP_OAUTH_LEGACY_AUDIENCE)
    : undefined;
  const audiences = resolveOAuthAudiences({
    resource,
    serverUrl: mcpServerUrl,
    legacyAudience: legacy,
  });
  return {
    issuer,
    resource,
    audiences,
    translatorEnabled: env.MCP_OAUTH_TRANSLATOR_ENABLED,
    upstreamTimeoutMs: env.MCP_OAUTH_UPSTREAM_TIMEOUT_MS,
    createVerifier: ({ resource: verifierResource, audiences: verifierAudiences }) =>
      new SupabaseOAuthVerifier({
        issuerUrl: issuer,
        audiences: verifierAudiences,
        resource: verifierResource,
      }),
  };
}

function validateOAuthResourceUrl(resource: URL, serverUrl: URL) {
  if (normalizeUrlForComparison(resource) !== normalizeUrlForComparison(serverUrl)) {
    throw new Error(
      'MCP_OAUTH_AUDIENCE must match MCP_SERVER_URL, allowing only a trailing-slash difference.'
    );
  }
}

function normalizeUrlForComparison(url: URL) {
  return url.href.endsWith('/') ? url.href.slice(0, -1) : url.href;
}

function resolveAllowedHostnames(serverUrl: URL) {
  if (env.MCP_ALLOWED_HOSTS) return parseCsvList(env.MCP_ALLOWED_HOSTS);
  return [serverUrl.hostname];
}

function resolveAllowedOrigins(serverUrl: URL) {
  if (env.MCP_ALLOWED_ORIGINS) return parseCsvList(env.MCP_ALLOWED_ORIGINS);

  if (serverUrl.hostname === '127.0.0.1' || serverUrl.hostname === 'localhost' || serverUrl.hostname === '::1') {
    return [
      `${serverUrl.protocol}//127.0.0.1:${serverUrl.port}`,
      `${serverUrl.protocol}//localhost:${serverUrl.port}`,
    ];
  }

  return [serverUrl.origin, ...KNOWN_REMOTE_MCP_CLIENT_ORIGINS];
}

function parseCsvList(value: string) {
  return value
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);
}
