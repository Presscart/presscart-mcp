import { randomUUID } from 'node:crypto';

import type { Express, Request, RequestHandler, Response } from 'express';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import { PresscartApiClient, PresscartApiError, type TokenSessionResponse } from './api.js';
import type { DirectoryProfile, DirectoryProfileId } from './directory/policy.js';
import { env } from './env.js';
import { HttpError, createHttpRouteErrorHandler } from './http-route-errors.js';
import {
  createOAuthHttpLayer,
  validateOAuthSessionAuth,
  type OAuthResourceGuard,
} from './oauth-http.js';
import { resolveDirectoryAudiences, resolveDirectoryResource } from './oauth-protocol.js';
import { createDirectoryMcpServer, createPresscartMcpServer } from './server.js';
import type { ServerOptions } from './utils/tool-context.js';

export type OAuthVerifierFactory = (args: {
  resource: URL;
  audiences: readonly [URL, ...URL[]];
}) => OAuthTokenVerifier;

export type HttpAppOAuthConfig = {
  issuer: URL;
  resource: URL;
  audiences: readonly [URL, ...URL[]];
  translatorEnabled: boolean;
  upstreamTimeoutMs: number;
  // Directory routes also accept the canonical /mcp audience while true (spec §6.3).
  acceptCanonicalAudienceOnDirectoryRoutes: boolean;
  createVerifier: OAuthVerifierFactory;
};

export type HttpAppConfig = {
  host: string;
  mcpServerUrl: URL;
  allowedHosts?: string[];
  allowedOrigins: string[];
  sessionIdleTtlMs: number;
  directoryProfiles?: readonly DirectoryProfile[];
  oauth?: HttpAppOAuthConfig;
};

export type SessionProfile = 'legacy' | DirectoryProfileId;

export type SessionState = {
  transport: StreamableHTTPServerTransport;
  authInfo?: AuthInfo;
  // Fixed from the route the session was initialized on; nothing in the request changes it.
  profile: SessionProfile;
  lastSeenAtMs: number;
};

type McpEndpoint = {
  path: string;
  profile: SessionProfile;
  guard?: OAuthResourceGuard;
  createServer: (options: ServerOptions) => McpServer;
};

export type HttpApp = {
  app: Express;
  sessions: ReadonlyMap<string, SessionState>;
  cleanupExpiredState: (nowMs?: number) => void;
  closeAllSessions: () => Promise<void>;
};

const PRESSCART_TOKEN_HEADER = 'x-presscart-api-token';
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

export function createHttpApp(config: HttpAppConfig): HttpApp {
  const sessions = new Map<string, SessionState>();
  const tokenCache = new Map<string, { authInfo: AuthInfo; verifiedAtMs: number }>();
  const allowedOrigins = config.allowedOrigins;
  const oauthEnabled = config.oauth !== undefined;
  const directoryProfiles = config.directoryProfiles ?? [];

  const app = createMcpExpressApp({
    host: config.host,
    allowedHosts: config.allowedHosts,
  });

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  const guards = new Map<SessionProfile, OAuthResourceGuard>();

  if (config.oauth) {
    const oauth = config.oauth;
    const canonicalVerifier = oauth.createVerifier({
      resource: oauth.resource,
      audiences: oauth.audiences,
    });
    const directoryResources = directoryProfiles.map(profile => {
      const resource = resolveDirectoryResource(oauth.resource, profile.path);
      return {
        resource,
        verifier: oauth.createVerifier({
          resource,
          audiences: resolveDirectoryAudiences({
            resource,
            canonicalResource: oauth.resource,
            acceptCanonicalAudience: oauth.acceptCanonicalAudienceOnDirectoryRoutes,
          }),
        }),
      };
    });
    const oauthLayer = createOAuthHttpLayer({
      serverUrl: config.mcpServerUrl,
      protectedResources: [
        { resource: oauth.resource, verifier: canonicalVerifier },
        ...directoryResources,
      ],
      authorizationServer: new URL(config.mcpServerUrl.origin),
      upstreamIssuer: oauth.issuer,
      translatorEnabled: oauth.translatorEnabled,
      upstreamTimeoutMs: oauth.upstreamTimeoutMs,
    });

    app.use(oauthLayer.router);
    const [canonicalGuard, ...directoryGuards] = oauthLayer.guards;
    guards.set('legacy', canonicalGuard);
    directoryProfiles.forEach((profile, index) => {
      const guard = directoryGuards[index];
      if (guard === undefined || guard.resource.href !== directoryResources[index]?.resource.href) {
        throw new Error(`Missing OAuth guard for directory profile "${profile.id}".`);
      }
      guards.set(profile.id, guard);
    });
  }

  const endpoints: McpEndpoint[] = [
    {
      path: '/mcp',
      profile: 'legacy',
      guard: guards.get('legacy'),
      createServer: options => createPresscartMcpServer(options),
    },
    ...directoryProfiles.map((profile): McpEndpoint => ({
      path: profile.path,
      profile: profile.id,
      guard: guards.get(profile.id),
      createServer: options => createDirectoryMcpServer(profile, options),
    })),
  ];
  const mcpPaths = new Set(endpoints.map(endpoint => endpoint.path));

  // app.use('/mcp') also matches every /mcp/<profile> path.
  app.use('/mcp', applyMcpCorsHeaders(allowedOrigins));
  for (const endpoint of endpoints) {
    app.options(endpoint.path, validateOriginHeader(allowedOrigins), handleMcpPreflight);
  }
  app.use('/mcp', validateOriginHeader(allowedOrigins));

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  for (const endpoint of endpoints) {
    mountMcpEndpoint(endpoint);
  }

  app.use(createHttpRouteErrorHandler({
    logRouteError,
    resourceMetadataUrl: guards.get('legacy')?.resourceMetadataUrl,
  }));

  app.use((req, res) => {
    if (mcpPaths.has(req.path)) {
      sendJsonRpcError(res, 405, -32000, 'Method not allowed');
      return;
    }

    res.status(404).json({ error: 'Not found' });
  });

  function mountMcpEndpoint(endpoint: McpEndpoint) {
    const auth = endpoint.guard ? [endpoint.guard.bearerAuth] : [];
    // Route-level error handler so OAuth session errors name this route's metadata.
    const routeErrorHandler = createHttpRouteErrorHandler({
      logRouteError,
      resourceMetadataUrl: endpoint.guard?.resourceMetadataUrl,
    });

    // A session is only visible on the route whose profile it was created with; a
    // mismatch is indistinguishable from an unknown session.
    const findSession = (sessionId: string) => {
      const session = sessions.get(sessionId);
      return session?.profile === endpoint.profile ? session : undefined;
    };

    const handlePost: RequestHandler = async (req, res, next) => {
      try {
        if (oauthEnabled) {
          rejectLegacyPresscartHeader(req, endpoint.path);
        }

        const sessionId = readHeader(req, 'mcp-session-id');
        const existingSession = sessionId ? findSession(sessionId) : undefined;

        if (sessionId && !existingSession) {
          sendJsonRpcError(res, 404, -32001, 'Session not found');
          return;
        }

        const authInfo = oauthEnabled
          ? req.auth
          : await resolveLegacyRequestAuthInfo(req, existingSession);

        if (oauthEnabled && existingSession) {
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

        const transport = createTransport(req.auth, endpoint.profile);
        const server = endpoint.createServer({
          getSessionAuthInfo: sid => (sid ? findSession(sid)?.authInfo : undefined),
        });

        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        next(error);
      }
    };

    const handleSessionRequest: RequestHandler = async (req, res, next) => {
      try {
        if (oauthEnabled) {
          rejectLegacyPresscartHeader(req, endpoint.path);
        }

        const sessionId = readHeader(req, 'mcp-session-id');
        if (!sessionId) {
          sendJsonRpcError(res, 400, -32000, 'Bad Request: Mcp-Session-Id header is required');
          return;
        }

        const existingSession = findSession(sessionId);
        if (!existingSession) {
          sendJsonRpcError(res, 404, -32001, 'Session not found');
          return;
        }

        req.auth = oauthEnabled
          ? req.auth
          : await resolveLegacyRequestAuthInfo(req, existingSession);

        if (oauthEnabled) {
          existingSession.authInfo = validateOAuthSessionAuth(existingSession.authInfo, req.auth);
        }

        touchSession(existingSession);
        await existingSession.transport.handleRequest(req, res);
      } catch (error) {
        next(error);
      }
    };

    app.post(endpoint.path, ...auth, handlePost, routeErrorHandler);
    app.get(endpoint.path, ...auth, handleSessionRequest, routeErrorHandler);
    app.delete(endpoint.path, ...auth, handleSessionRequest, routeErrorHandler);
  }

  function createTransport(authInfo: AuthInfo | undefined, profile: SessionProfile) {
    let transport: StreamableHTTPServerTransport;
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableDnsRebindingProtection: true,
      allowedOrigins,
      onsessioninitialized: initializedSessionId => {
        sessions.set(initializedSessionId, {
          transport,
          authInfo,
          profile,
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

  function cleanupExpiredState(nowMs = Date.now()) {
    for (const [sessionId, session] of sessions.entries()) {
      if (nowMs - session.lastSeenAtMs <= config.sessionIdleTtlMs) continue;

      sessions.delete(sessionId);
      logServerEvent('info', 'Closed idle MCP session.', {
        sessionId,
        idleMs: nowMs - session.lastSeenAtMs,
        ttlMs: config.sessionIdleTtlMs,
      });
      void session.transport.close().catch(error => {
        logServerEvent('warn', 'Failed to close idle MCP session.', { error: readErrorMessage(error) });
      });
    }

    for (const [token, cached] of tokenCache.entries()) {
      if (nowMs - cached.verifiedAtMs <= TOKEN_CACHE_TTL_MS) continue;
      tokenCache.delete(token);
    }
  }

  async function closeAllSessions() {
    for (const [sessionId, session] of sessions.entries()) {
      try {
        await session.transport.close();
      } catch {
        // Ignore shutdown cleanup errors.
      } finally {
        sessions.delete(sessionId);
      }
    }
  }

  return { app, sessions, cleanupExpiredState, closeAllSessions };
}

function rejectLegacyPresscartHeader(req: Request, path: string) {
  if (readHeader(req, PRESSCART_TOKEN_HEADER)) {
    throw new HttpError(
      400,
      `X-Presscart-API-Token is not accepted on ${path} when MCP OAuth is enabled.`
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

function touchSession(session: SessionState) {
  session.lastSeenAtMs = Date.now();
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

function logServerEvent(
  level: 'info' | 'warn' | 'error',
  message: string,
  context: Record<string, unknown>
) {
  const payload = JSON.stringify({ message, ...context });
  if (level === 'error') {
    console.error(payload);
    return;
  }

  // console.warn writes to stderr, which log platforms render as error-level;
  // routine events must go to stdout
  if (level === 'info') {
    console.info(payload);
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
