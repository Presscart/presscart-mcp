import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import { PresscartApiClient, type TokenSessionResponse } from './api.js';
import { env } from './env.js';
import { createPresscartMcpServer, formatServerError } from './server.js';

type AuthInfo = {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt: number;
  extra?: Record<string, unknown>;
};

type SessionState = {
  transport: StreamableHTTPServerTransport;
  authInfo: AuthInfo;
};

const sessions = new Map<string, SessionState>();
const tokenCache = new Map<string, { authInfo: AuthInfo; verifiedAtMs: number }>();

const httpServer = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (url.pathname === '/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname !== '/mcp') {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    const sessionId = headerValue(req.headers['mcp-session-id']);
    const existingSession = sessionId ? sessions.get(sessionId) : undefined;
    const authInfo = await authenticateRequest(req, existingSession);
    (req as IncomingMessage & { auth?: AuthInfo }).auth = authInfo;

    switch (req.method) {
      case 'POST':
        await handlePost(req as IncomingMessage & { auth?: AuthInfo }, res, existingSession);
        return;
      case 'GET':
      case 'DELETE':
        if (!existingSession) {
          sendJson(res, 400, { error: 'Invalid or missing MCP session id' });
          return;
        }
        await existingSession.transport.handleRequest(
          req as IncomingMessage & { auth?: AuthInfo },
          res
        );
        return;
      default:
        sendJson(res, 405, { error: 'Method not allowed' });
    }
  } catch (error) {
    const status = isUnauthorizedError(error) ? 401 : 500;

    if (status === 401) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="Presscart MCP"');
    }

    sendJson(res, status, { error: formatServerError(error) });
  }
});

httpServer.listen(env.MCP_PORT, env.MCP_HOST, () => {
  console.error(`Presscart MCP server listening on http://${env.MCP_HOST}:${env.MCP_PORT}/mcp`);
});

process.on('SIGINT', async () => {
  for (const [sessionId, session] of sessions.entries()) {
    try {
      await session.transport.close();
    } catch {
      // Ignore shutdown cleanup errors.
    } finally {
      sessions.delete(sessionId);
    }
  }

  httpServer.close(() => process.exit(0));
});

async function handlePost(
  req: IncomingMessage & { auth?: AuthInfo },
  res: ServerResponse,
  existingSession: SessionState | undefined
) {
  const body = await parseJsonBody(req);
  const sessionId = headerValue(req.headers['mcp-session-id']);

  if (existingSession) {
    await existingSession.transport.handleRequest(req, res, body);
    return;
  }

  if (sessionId || !isInitializeRequest(body)) {
    sendJson(res, 400, { error: 'Bad Request: No valid session ID provided' });
    return;
  }

  let transport: StreamableHTTPServerTransport;
  transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: initializedSessionId => {
      if (!req.auth) return;
      sessions.set(initializedSessionId, {
        transport,
        authInfo: req.auth,
      });
    },
  });

  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid) sessions.delete(sid);
  };

  const server = createPresscartMcpServer({
    getSessionAuthInfo: sid => (sid ? sessions.get(sid)?.authInfo : undefined),
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

async function authenticateRequest(
  req: IncomingMessage,
  existingSession: SessionState | undefined
): Promise<AuthInfo> {
  const bearerToken = readBearerToken(req);

  if (!bearerToken) {
    if (existingSession) return existingSession.authInfo;
    throw new Error('Missing Authorization header');
  }

  if (existingSession && existingSession.authInfo.token !== bearerToken) {
    throw new Error('Authorization token does not match the active MCP session');
  }

  const cached = tokenCache.get(bearerToken);
  if (cached && Date.now() - cached.verifiedAtMs < 60_000) {
    return cached.authInfo;
  }

  const api = new PresscartApiClient(env.PRESSCART_API_URL, bearerToken);
  const session = await api.get<TokenSessionResponse>('/auth/token');

  const authInfo: AuthInfo = {
    token: bearerToken,
    clientId: session.team_id,
    scopes: session.scopes,
    expiresAt: Math.floor(Date.now() / 1000) + 300,
    extra: session,
  };

  tokenCache.set(bearerToken, { authInfo, verifiedAtMs: Date.now() });
  return authInfo;
}

async function parseJsonBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return undefined;

  return JSON.parse(raw);
}

function readBearerToken(req: IncomingMessage) {
  const authHeader = headerValue(req.headers.authorization);
  if (!authHeader) return undefined;

  const [scheme, token] = authHeader.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw new Error("Invalid Authorization header format, expected 'Bearer TOKEN'");
  }

  return token;
}

function headerValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function isUnauthorizedError(error: unknown) {
  return error instanceof Error && /authorization|token/i.test(error.message);
}
