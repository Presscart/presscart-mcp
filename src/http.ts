import { randomUUID } from 'node:crypto';

import { type Request, type RequestHandler, type Response } from 'express';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import { PresscartApiClient, PresscartApiError, type TokenSessionResponse } from './api.js';
import { env } from './env.js';
import {
  OAuthSessionAuthError,
  createOAuthHttpLayer,
  validateOAuthSessionAuth,
} from './oauth-http.js';
import { createPresscartMcpServer } from './server.js';
import { SupabaseOAuthVerifier } from './supabase-oauth.js';
import { formatServerError } from './utils/errors.js';

type SessionState = {
  transport: StreamableHTTPServerTransport;
  authInfo?: AuthInfo;
  lastSeenAtMs: number;
};

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const PRESSCART_TOKEN_HEADER = 'x-presscart-api-token';
const SESSION_IDLE_TTL_MS = env.MCP_SESSION_IDLE_TTL_MS;
const SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const TOKEN_CACHE_TTL_MS = 60_000;
const MCP_CORS_ALLOWED_METHODS = 'GET, POST, DELETE, OPTIONS';
const MCP_CORS_ALLOWED_HEADERS = [
  'accept',
  'authorization',
  'content-type',
  'mcp-protocol-version',
  'mcp-session-id',
].join(', ');
const MCP_CORS_EXPOSED_HEADERS = [
  'mcp-protocol-version',
  'mcp-session-id',
  'www-authenticate',
].join(', ');
const KNOWN_REMOTE_MCP_CLIENT_ORIGINS = ['https://claude.ai', 'https://claude.com'];

const sessions = new Map<string, SessionState>();
const tokenCache = new Map<string, { authInfo: AuthInfo; verifiedAtMs: number }>();

const mcpServerUrl = resolveMcpServerUrl();
const oauthConfig = resolveOAuthRuntimeConfig();
const allowedOrigins = resolveAllowedOrigins(mcpServerUrl);
const cleanupTimer = setInterval(cleanupExpiredState, SESSION_CLEANUP_INTERVAL_MS);
cleanupTimer.unref();

const app = createMcpExpressApp({
  host: env.MCP_HOST,
  allowedHosts: env.MCP_ALLOWED_HOSTS ? resolveAllowedHostnames(mcpServerUrl) : undefined,
});

app.set('trust proxy', 1);
app.disable('x-powered-by');

let bearerAuth: RequestHandler | undefined;

if (oauthConfig) {
  validateOAuthResourceUrl(oauthConfig.resource, mcpServerUrl);

  const oauthVerifier = new SupabaseOAuthVerifier({
    issuerUrl: oauthConfig.issuer,
    audiences: oauthConfig.audiences,
    resource: oauthConfig.resource,
  });
  const oauthLayer = createOAuthHttpLayer({
    serverUrl: mcpServerUrl,
    verifier: oauthVerifier,
    resource: oauthConfig.resource,
    authorizationServer: new URL(mcpServerUrl.origin),
    upstreamIssuer: oauthConfig.issuer,
    translatorEnabled: env.MCP_OAUTH_TRANSLATOR_ENABLED,
    upstreamTimeoutMs: env.MCP_OAUTH_UPSTREAM_TIMEOUT_MS,
  });

  app.use(oauthLayer.router);
  bearerAuth = oauthLayer.bearerAuth;
}

app.use('/mcp', applyMcpCorsHeaders(allowedOrigins));
app.options('/mcp', validateOriginHeader(allowedOrigins), handleMcpPreflight);
app.use('/mcp', validateOriginHeader(allowedOrigins));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/mcp', ...(bearerAuth ? [bearerAuth] : []), async (req, res) => {
  try {
    if (env.MCP_OAUTH_ENABLED) {
      rejectLegacyPresscartHeader(req);
    }

    const sessionId = readHeader(req, 'mcp-session-id');
    const existingSession = sessionId ? sessions.get(sessionId) : undefined;

    if (sessionId && !existingSession) {
      sendJsonRpcError(res, 404, -32001, 'Session not found');
      return;
    }

    const authInfo = env.MCP_OAUTH_ENABLED
      ? req.auth
      : await resolveLegacyRequestAuthInfo(req, existingSession);

    if (env.MCP_OAUTH_ENABLED && existingSession) {
      existingSession.authInfo = validateOAuthSessionAuth(existingSession.authInfo, authInfo);
    }

    req.auth = authInfo;

    if (existingSession) {
      touchSession(existingSession);
      await existingSession.transport.handleRequest(req, res, req.body);
      return;
    }

    if (sessionId) {
      sendJsonRpcError(res, 404, -32001, 'Session not found');
      return;
    }

    if (!isInitializeRequest(req.body)) {
      sendJsonRpcError(res, 400, -32000, 'Bad Request: Mcp-Session-Id header is required');
      return;
    }

    const transport = createTransport(req.auth);
    const server = createPresscartMcpServer({
      getSessionAuthInfo: sid => (sid ? sessions.get(sid)?.authInfo : undefined),
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    handleRouteError(req, res, error);
  }
});

app.get('/mcp', ...(bearerAuth ? [bearerAuth] : []), async (req, res) => {
  try {
    if (env.MCP_OAUTH_ENABLED) {
      rejectLegacyPresscartHeader(req);
    }

    const sessionId = readHeader(req, 'mcp-session-id');
    if (!sessionId) {
      sendJsonRpcError(res, 400, -32000, 'Bad Request: Mcp-Session-Id header is required');
      return;
    }

    const existingSession = sessions.get(sessionId);
    if (!existingSession) {
      sendJsonRpcError(res, 404, -32001, 'Session not found');
      return;
    }

    req.auth = env.MCP_OAUTH_ENABLED
      ? req.auth
      : await resolveLegacyRequestAuthInfo(req, existingSession);

    if (env.MCP_OAUTH_ENABLED) {
      existingSession.authInfo = validateOAuthSessionAuth(existingSession.authInfo, req.auth);
    }

    touchSession(existingSession);
    await existingSession.transport.handleRequest(req, res);
  } catch (error) {
    handleRouteError(req, res, error);
  }
});

app.delete('/mcp', ...(bearerAuth ? [bearerAuth] : []), async (req, res) => {
  try {
    if (env.MCP_OAUTH_ENABLED) {
      rejectLegacyPresscartHeader(req);
    }

    const sessionId = readHeader(req, 'mcp-session-id');
    if (!sessionId) {
      sendJsonRpcError(res, 400, -32000, 'Bad Request: Mcp-Session-Id header is required');
      return;
    }

    const existingSession = sessions.get(sessionId);
    if (!existingSession) {
      sendJsonRpcError(res, 404, -32001, 'Session not found');
      return;
    }

    req.auth = env.MCP_OAUTH_ENABLED
      ? req.auth
      : await resolveLegacyRequestAuthInfo(req, existingSession);

    if (env.MCP_OAUTH_ENABLED) {
      existingSession.authInfo = validateOAuthSessionAuth(existingSession.authInfo, req.auth);
    }

    touchSession(existingSession);
    await existingSession.transport.handleRequest(req, res);
  } catch (error) {
    handleRouteError(req, res, error);
  }
});

app.use((req, res) => {
  if (req.path === '/mcp') {
    sendJsonRpcError(res, 405, -32000, 'Method not allowed');
    return;
  }

  res.status(404).json({ error: 'Not found' });
});

const server = app.listen(env.MCP_PORT, env.MCP_HOST, () => {
  console.info(`Presscart MCP server listening on http://${env.MCP_HOST}:${env.MCP_PORT}/mcp`);
});

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

async function shutdown() {
  clearInterval(cleanupTimer);

  for (const [sessionId, session] of sessions.entries()) {
    try {
      await session.transport.close();
    } catch {
      // Ignore shutdown cleanup errors.
    } finally {
      sessions.delete(sessionId);
    }
  }

  server.close(() => process.exit(0));
}

function createTransport(authInfo: AuthInfo | undefined) {
  let transport: StreamableHTTPServerTransport;
  transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableDnsRebindingProtection: true,
    allowedOrigins,
    onsessioninitialized: initializedSessionId => {
      sessions.set(initializedSessionId, {
        transport,
        authInfo,
        lastSeenAtMs: Date.now(),
      });
    },
  });

  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid) sessions.delete(sid);
  };

  return transport;
}

async function resolveLegacyRequestAuthInfo(
  req: Request,
  existingSession: SessionState | undefined
): Promise<AuthInfo | undefined> {
  const authorization = readHeader(req, 'authorization');
  if (authorization) {
    throw new HttpError(
      400,
      'Authorization is reserved for MCP OAuth. Use X-Presscart-API-Token to provide the upstream Presscart credential.'
    );
  }

  const providedToken = readHeader(req, PRESSCART_TOKEN_HEADER);
  if (!providedToken) {
    return existingSession?.authInfo;
  }

  if (existingSession?.authInfo && existingSession.authInfo.token !== providedToken) {
    throw new HttpError(
      400,
      'X-Presscart-API-Token does not match the credential bound to the active MCP session.'
    );
  }

  const authInfo = await verifyPresscartToken(providedToken);

  if (existingSession && !existingSession.authInfo) {
    existingSession.authInfo = authInfo;
  }

  return existingSession?.authInfo ?? authInfo;
}

async function verifyPresscartToken(token: string): Promise<AuthInfo> {
  const cached = tokenCache.get(token);
  if (cached && Date.now() - cached.verifiedAtMs < TOKEN_CACHE_TTL_MS) {
    return cached.authInfo;
  }

  const api = new PresscartApiClient(env.PRESSCART_API_URL, token, env.PRESSCART_API_TIMEOUT_MS);
  const session = await api.get<TokenSessionResponse>('/auth/token');

  if (session.source !== 'api_token') {
    throw new HttpError(401, 'Expected a Presscart API-token session.');
  }

  const authInfo: AuthInfo = {
    token,
    clientId: session.team_id,
    scopes: session.scopes,
    expiresAt: Math.floor(Date.now() / 1000) + 300,
    extra: {
      ...session,
      presscart_api_token: token,
    },
  };

  tokenCache.set(token, { authInfo, verifiedAtMs: Date.now() });
  return authInfo;
}

function rejectLegacyPresscartHeader(req: Request) {
  if (readHeader(req, PRESSCART_TOKEN_HEADER)) {
    throw new HttpError(
      400,
      'X-Presscart-API-Token is not accepted on /mcp when MCP OAuth is enabled.'
    );
  }
}

function validateOriginHeader(allowed: string[]) {
  return (req: Request, res: Response, next: () => void) => {
    const origin = readHeader(req, 'origin');
    if (!origin) {
      next();
      return;
    }

    if (allowed.length > 0 && !allowed.includes(origin)) {
      sendJsonRpcError(res, 403, -32000, 'Invalid Origin header');
      return;
    }

    next();
  };
}

function applyMcpCorsHeaders(allowed: string[]) {
  return (req: Request, res: Response, next: () => void) => {
    const origin = readHeader(req, 'origin');
    if (origin && isAllowedOrigin(origin, allowed)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Expose-Headers', MCP_CORS_EXPOSED_HEADERS);
      res.setHeader('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
    }

    next();
  };
}

function handleMcpPreflight(req: Request, res: Response) {
  const requestedHeaders = readHeader(req, 'access-control-request-headers');

  res.setHeader('Access-Control-Allow-Methods', MCP_CORS_ALLOWED_METHODS);
  res.setHeader('Access-Control-Allow-Headers', requestedHeaders || MCP_CORS_ALLOWED_HEADERS);
  res.setHeader('Access-Control-Max-Age', '86400');
  res.status(204).send();
}

function isAllowedOrigin(origin: string, allowed: string[]) {
  return allowed.length === 0 || allowed.includes(origin);
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

function resolveOAuthRuntimeConfig() {
  if (env.MCP_OAUTH_TRANSLATOR_ENABLED && !env.MCP_OAUTH_ENABLED) {
    throw new Error('MCP_OAUTH_TRANSLATOR_ENABLED requires MCP_OAUTH_ENABLED=true.');
  }

  if (!env.MCP_OAUTH_ENABLED) return undefined;

  const issuer = resolveIssuerUrl();
  const resource = new URL(env.MCP_OAUTH_AUDIENCE);
  const legacy = env.MCP_OAUTH_LEGACY_AUDIENCE
    ? new URL(env.MCP_OAUTH_LEGACY_AUDIENCE)
    : undefined;
  const audiences: [URL, ...URL[]] = legacy ? [resource, legacy] : [resource];
  return { issuer, resource, audiences };
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

function readHeader(req: Request, key: string) {
  const value = req.headers[key];
  if (Array.isArray(value)) return value[0];
  return value;
}

function sendJsonRpcError(
  res: Response,
  statusCode: number,
  code: number,
  message: string
) {
  res.status(statusCode).json({
    jsonrpc: '2.0',
    error: { code, message },
    id: null,
  });
}

function handleRouteError(req: Request, res: Response, error: unknown) {
  const statusCode = resolveErrorStatus(error);
  logRouteError(req, statusCode, error);
  const exposeMessage = error instanceof HttpError || error instanceof OAuthSessionAuthError;
  sendJsonRpcError(
    res,
    statusCode,
    -32000,
    formatServerError(error, { exposeMessage })
  );
}

function resolveErrorStatus(error: unknown) {
  if (error instanceof HttpError) return error.statusCode;
  if (error instanceof OAuthSessionAuthError) return error.statusCode;
  if (error instanceof PresscartApiError && (error.status === 401 || error.status === 403)) {
    return 401;
  }
  return 500;
}

function touchSession(session: SessionState) {
  session.lastSeenAtMs = Date.now();
}

function cleanupExpiredState() {
  const now = Date.now();

  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.lastSeenAtMs <= SESSION_IDLE_TTL_MS) continue;

    sessions.delete(sessionId);
    logServerEvent('warn', 'Closed idle MCP session.', {
      sessionId,
      idleMs: now - session.lastSeenAtMs,
      ttlMs: SESSION_IDLE_TTL_MS,
    });
    void session.transport.close().catch(error => {
      logServerEvent('warn', 'Failed to close idle MCP session.', { error: readErrorMessage(error) });
    });
  }

  for (const [token, cached] of tokenCache.entries()) {
    if (now - cached.verifiedAtMs <= TOKEN_CACHE_TTL_MS) continue;
    tokenCache.delete(token);
  }
}

function logRouteError(req: Request, statusCode: number, error: unknown) {
  const level = statusCode >= 500 ? 'error' : 'warn';
  logServerEvent(level, 'MCP request failed.', {
    method: req.method,
    path: req.path,
    statusCode,
    error: readErrorMessage(error),
  });
}

function logServerEvent(level: 'warn' | 'error', message: string, context: Record<string, unknown>) {
  const payload = JSON.stringify({ message, ...context });
  if (level === 'error') {
    console.error(payload);
    return;
  }

  console.warn(payload);
}

function readErrorMessage(error: unknown) {
  if (error instanceof PresscartApiError) {
    return `${error.message} (${error.status})`;
  }

  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}
