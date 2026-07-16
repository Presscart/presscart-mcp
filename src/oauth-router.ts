import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import { z } from 'zod';

import {
  OAuthProtocolError,
  createAuthorizationServerMetadata,
  createProtectedResourceMetadata,
  parseCanonicalResource,
  parseFacadeScope,
  translateRegistrationRequest,
  translateRegistrationResponse,
  translateTokenResponse,
} from './oauth-protocol.js';

export type OAuthRouterOptions = {
  resource: URL;
  authorizationServer: URL;
  upstreamIssuer: URL;
  translatorEnabled: boolean;
  upstreamTimeoutMs: number;
  fetchImpl?: typeof globalThis.fetch;
  now?: () => number;
};

const REQUEST_URL_LIMIT = 8 * 1024;
const FORM_BODY_LIMIT = '16kb';
const JSON_BODY_LIMIT = '32kb';
const UPSTREAM_RESPONSE_LIMIT = 64 * 1024;
const METADATA_CACHE_CONTROL = 'public, max-age=300';
const RATE_LIMITS = {
  authorize: { max: 60, windowMs: 60_000 },
  register: { max: 20, windowMs: 60_000 },
  token: { max: 120, windowMs: 60_000 },
} as const;

const authorizationParameters = new Set([
  'response_type',
  'client_id',
  'redirect_uri',
  'code_challenge',
  'code_challenge_method',
  'state',
  'resource',
  'scope',
]);

const textField = z.string().min(1);
const optionalClientFields = {
  client_id: textField.optional(),
  client_secret: textField.optional(),
  resource: textField.optional(),
  scope: z.string().optional(),
} as const;
const authorizationCodeTokenRequestSchema = z.object({
  grant_type: z.literal('authorization_code'),
  code: textField,
  code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
  redirect_uri: textField.refine(isValidRedirectUri),
  ...optionalClientFields,
}).strict();
const refreshTokenRequestSchema = z.object({
  grant_type: z.literal('refresh_token'),
  refresh_token: textField,
  ...optionalClientFields,
}).strict();
const tokenRequestSchema = z.discriminatedUnion('grant_type', [
  authorizationCodeTokenRequestSchema,
  refreshTokenRequestSchema,
]);
const upstreamOAuthErrorSchema = z.object({
  error: z.string().min(1).max(128).regex(/^[A-Za-z0-9._~-]+$/),
  error_description: z.string().max(2_048).optional(),
  error_uri: z.string().url().max(2_048).optional(),
}).passthrough();

type OAuthErrorPayload = {
  error: string;
  error_description?: string;
  error_uri?: string;
};

type TokenRequest = z.infer<typeof tokenRequestSchema>;

class FacadeOAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly errorUri?: string,
  ) {
    super(message);
    this.name = 'FacadeOAuthError';
  }
}

class UpstreamOAuthError extends Error {
  constructor(
    readonly status: number,
    readonly payload: OAuthErrorPayload,
  ) {
    super('upstream authorization server rejected the request');
    this.name = 'UpstreamOAuthError';
  }
}

export function createOAuthRouter(options: OAuthRouterOptions): Router {
  const router = express.Router();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const resource = new URL(options.resource.href);
  const authorizationServer = new URL(options.authorizationServer.href);
  const upstreamIssuer = new URL(options.upstreamIssuer.href);
  const upstreamBase = ensureTrailingSlash(upstreamIssuer);
  const upstreamAuthorize = new URL('oauth/authorize', upstreamBase);
  const upstreamRegister = new URL('oauth/clients/register', upstreamBase);
  const upstreamToken = new URL('oauth/token', upstreamBase);

  const protectedResourceMetadata = createProtectedResourceMetadata({
    resource,
    authorizationServer: options.translatorEnabled
      ? authorizationServer
      : upstreamIssuer,
    translatorEnabled: options.translatorEnabled,
  });
  const sendProtectedResourceMetadata = (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', METADATA_CACHE_CONTROL);
    res.json(protectedResourceMetadata);
  };

  router.get('/.well-known/oauth-protected-resource', sendProtectedResourceMetadata);
  router.get('/.well-known/oauth-protected-resource/mcp', sendProtectedResourceMetadata);

  if (!options.translatorEnabled) return router;

  const authorizationServerMetadata = createAuthorizationServerMetadata(authorizationServer);
  router.get('/.well-known/oauth-authorization-server', (_req, res) => {
    res.setHeader('Cache-Control', METADATA_CACHE_CONTROL);
    res.json(authorizationServerMetadata);
  });

  const authorizeRateLimit = createRateLimiter(RATE_LIMITS.authorize, now);
  const registerRateLimit = createRateLimiter(RATE_LIMITS.register, now);
  const tokenRateLimit = createRateLimiter(RATE_LIMITS.token, now);
  const jsonParser = express.json({
    limit: JSON_BODY_LIMIT,
    strict: true,
    type: 'application/json',
  });
  const formParser = express.urlencoded({
    extended: false,
    limit: FORM_BODY_LIMIT,
    type: 'application/x-www-form-urlencoded',
  });

  router.get('/oauth/authorize', enforceRequestUrlLimit, authorizeRateLimit, (req, res) => {
    try {
      const request = parseAuthorizationRequest(req, resource);
      const location = new URL(upstreamAuthorize.href);
      location.searchParams.set('response_type', request.responseType);
      location.searchParams.set('client_id', request.clientId);
      location.searchParams.set('redirect_uri', request.redirectUri);
      location.searchParams.set('code_challenge', request.codeChallenge);
      location.searchParams.set('code_challenge_method', request.codeChallengeMethod);
      location.searchParams.set('scope', request.scope);
      if (request.state !== undefined) location.searchParams.set('state', request.state);
      if (request.resource !== undefined) location.searchParams.set('resource', request.resource);

      res.setHeader('Cache-Control', 'no-store');
      res.redirect(302, location.href);
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  router.post(
    '/oauth/register',
    enforceRequestUrlLimit,
    registerRateLimit,
    jsonParser,
    async (req, res) => {
      try {
        const registration = translateRegistrationRequest(req.body as unknown);
        const upstream = await fetchUpstreamJson({
          fetchImpl,
          url: upstreamRegister,
          timeoutMs: options.upstreamTimeoutMs,
          init: {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(registration.upstream),
          },
        });
        const response = translateRegistrationResponse({
          request: registration.facade,
          upstream: upstream.body,
        });
        sendOAuthSuccess(res, upstream.status, response);
      } catch (error) {
        handleRouteError(res, error);
      }
    },
  );

  router.post(
    '/oauth/token',
    enforceRequestUrlLimit,
    tokenRateLimit,
    formParser,
    async (req, res) => {
      try {
        const authorization = parseBasicAuthorization(req);
        const tokenRequest = parseTokenRequest(req.body as unknown, authorization, resource);
        const upstreamBody = buildUpstreamTokenBody(tokenRequest);
        const headers = new Headers({
          'content-type': 'application/x-www-form-urlencoded',
        });
        if (authorization !== undefined) headers.set('authorization', authorization);

        const upstream = await fetchUpstreamJson({
          fetchImpl,
          url: upstreamToken,
          timeoutMs: options.upstreamTimeoutMs,
          init: {
            method: 'POST',
            headers,
            body: upstreamBody,
          },
        });
        const response = translateTokenResponse({
          grantType: tokenRequest.grant_type,
          upstream: upstream.body,
        });
        sendOAuthSuccess(res, upstream.status, response);
      } catch (error) {
        handleRouteError(res, error);
      }
    },
  );

  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (isBodyParserError(error)) {
      const status = error.status === 413 ? 413 : 400;
      sendOAuthError(res, 'invalid_request', 'request body is invalid', status);
      return;
    }
    handleRouteError(res, error);
  });

  return router;
}

function parseAuthorizationRequest(req: Request, resource: URL) {
  const searchParams = new URL(req.originalUrl, 'http://oauth-router.invalid').searchParams;
  for (const name of new Set(searchParams.keys())) {
    if (!authorizationParameters.has(name) || searchParams.getAll(name).length !== 1) {
      throw invalidRequest('authorization request is invalid');
    }
  }

  const responseType = requiredParameter(searchParams, 'response_type');
  const clientId = requiredParameter(searchParams, 'client_id');
  const redirectUri = requiredParameter(searchParams, 'redirect_uri');
  const codeChallenge = requiredParameter(searchParams, 'code_challenge');
  const codeChallengeMethod = requiredParameter(searchParams, 'code_challenge_method');
  if (
    responseType !== 'code'
    || !isValidRedirectUri(redirectUri)
    || !/^[A-Za-z0-9._~-]{43,128}$/.test(codeChallenge)
    || codeChallengeMethod !== 'S256'
  ) {
    throw invalidRequest('authorization request is invalid');
  }

  const scope = parseFacadeScope(optionalParameter(searchParams, 'scope'));
  const canonicalResource = parseCanonicalResource(
    optionalParameter(searchParams, 'resource'),
    resource,
  );
  return {
    responseType,
    clientId,
    redirectUri,
    codeChallenge,
    codeChallengeMethod,
    state: optionalParameter(searchParams, 'state'),
    resource: canonicalResource,
    scope: scope.upstream,
  };
}

function requiredParameter(searchParams: URLSearchParams, name: string) {
  const value = optionalParameter(searchParams, name);
  if (value === undefined || value.length === 0) throw invalidRequest('authorization request is invalid');
  return value;
}

function optionalParameter(searchParams: URLSearchParams, name: string) {
  const values = searchParams.getAll(name);
  if (values.length > 1) throw invalidRequest('authorization request is invalid');
  return values[0];
}

function parseBasicAuthorization(req: Request) {
  const authorization = req.get('authorization');
  if (authorization === undefined) return undefined;
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(authorization);
  const encoded = match?.[1];
  if (encoded === undefined || encoded.length % 4 === 1) {
    throw new FacadeOAuthError('invalid_client', 'client authentication is invalid', 401);
  }

  const decoded = Buffer.from(encoded, 'base64');
  const canonical = decoded.toString('base64').replace(/=+$/, '');
  if (canonical !== encoded.replace(/=+$/, '') || decoded.indexOf(0x3a) <= 0) {
    throw new FacadeOAuthError('invalid_client', 'client authentication is invalid', 401);
  }
  return authorization;
}

function parseTokenRequest(body: unknown, authorization: string | undefined, resource: URL): TokenRequest {
  const parsed = tokenRequestSchema.safeParse(body);
  if (!parsed.success) throw invalidRequest('token request is invalid');

  if (authorization !== undefined && parsed.data.client_secret !== undefined) {
    throw invalidRequest('multiple client authentication methods are not allowed');
  }
  if (authorization === undefined && parsed.data.client_id === undefined) {
    throw new FacadeOAuthError('invalid_client', 'client authentication is required', 401);
  }
  if (parsed.data.client_secret !== undefined && parsed.data.client_id === undefined) {
    throw invalidRequest('client_id is required with client_secret');
  }

  parseCanonicalResource(parsed.data.resource, resource);
  if (parsed.data.scope !== undefined) parseFacadeScope(parsed.data.scope);
  return parsed.data;
}

function buildUpstreamTokenBody(request: TokenRequest) {
  const body = new URLSearchParams();
  body.set('grant_type', request.grant_type);
  if (request.grant_type === 'authorization_code') {
    body.set('code', request.code);
    body.set('code_verifier', request.code_verifier);
    body.set('redirect_uri', request.redirect_uri);
  } else {
    body.set('refresh_token', request.refresh_token);
  }
  if (request.client_id !== undefined) body.set('client_id', request.client_id);
  if (request.client_secret !== undefined) body.set('client_secret', request.client_secret);
  if (request.resource !== undefined) body.set('resource', request.resource);
  if (request.scope !== undefined) body.set('scope', parseFacadeScope(request.scope).upstream);
  return body;
}

async function fetchUpstreamJson(args: {
  fetchImpl: typeof fetch;
  url: URL;
  timeoutMs: number;
  init: RequestInit;
}) {
  let response: globalThis.Response;
  try {
    response = await args.fetchImpl(args.url, {
      ...args.init,
      redirect: 'manual',
      signal: AbortSignal.timeout(args.timeoutMs),
    });
  } catch {
    throw new FacadeOAuthError(
      'temporarily_unavailable',
      'upstream authorization server is temporarily unavailable',
      503,
    );
  }

  if (response.status >= 300 && response.status < 400) {
    throw upstreamServerError();
  }
  if (response.status >= 500) {
    throw new FacadeOAuthError(
      'temporarily_unavailable',
      'upstream authorization server is temporarily unavailable',
      503,
    );
  }
  if (!((response.status >= 200 && response.status < 300)
    || (response.status >= 400 && response.status < 500))) {
    throw upstreamServerError();
  }

  const body = await readLimitedJson(response);
  if (response.status >= 400) {
    const parsed = upstreamOAuthErrorSchema.safeParse(body);
    if (!parsed.success) throw upstreamServerError();
    throw new UpstreamOAuthError(response.status, {
      error: parsed.data.error,
      ...(parsed.data.error_description === undefined
        ? {}
        : { error_description: parsed.data.error_description }),
      ...(parsed.data.error_uri === undefined ? {} : { error_uri: parsed.data.error_uri }),
    });
  }
  return { status: response.status, body };
}

async function readLimitedJson(response: globalThis.Response): Promise<unknown> {
  const contentType = response.headers.get('content-type');
  if (contentType === null || !/^application\/(?:[A-Za-z0-9.+-]+\+)?json(?:\s*;|\s*$)/i.test(contentType)) {
    throw upstreamServerError();
  }
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > UPSTREAM_RESPONSE_LIMIT) {
      throw upstreamServerError();
    }
  }
  if (response.body === null) throw upstreamServerError();

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let length = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > UPSTREAM_RESPONSE_LIMIT) {
        await reader.cancel();
        throw upstreamServerError();
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof OAuthProtocolError || error instanceof FacadeOAuthError) throw error;
    throw upstreamServerError();
  } finally {
    reader.releaseLock();
  }
}

function createRateLimiter(
  limit: { max: number; windowMs: number },
  now: () => number,
) {
  const entries = new Map<string, { count: number; resetAt: number }>();
  let checks = 0;
  return (req: Request, res: Response, next: NextFunction) => {
    const currentTime = now();
    checks += 1;
    if (checks % 100 === 0) {
      for (const [key, entry] of entries) {
        if (entry.resetAt <= currentTime) entries.delete(key);
      }
    }

    const key = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const entry = entries.get(key);
    if (entry === undefined || entry.resetAt <= currentTime) {
      entries.set(key, { count: 1, resetAt: currentTime + limit.windowMs });
      next();
      return;
    }
    if (entry.count >= limit.max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - currentTime) / 1_000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      sendOAuthError(res, 'temporarily_unavailable', 'request rate limit exceeded', 429);
      return;
    }
    entry.count += 1;
    next();
  };
}

function enforceRequestUrlLimit(req: Request, res: Response, next: NextFunction) {
  if (req.originalUrl.length > REQUEST_URL_LIMIT) {
    sendOAuthError(res, 'invalid_request', 'request URL is too long', 414);
    return;
  }
  next();
}

function sendOAuthSuccess(res: Response, status: number, body: unknown) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.status(status).json(body);
}

function sendOAuthError(
  res: Response,
  error: string,
  description: string | undefined,
  status: number,
  errorUri?: string,
) {
  const payload: OAuthErrorPayload = {
    error,
    ...(description === undefined ? {} : { error_description: description }),
    ...(errorUri === undefined ? {} : { error_uri: errorUri }),
  };
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.status(status).json(payload);
}

function handleRouteError(res: Response, error: unknown) {
  if (res.headersSent) return;
  if (error instanceof UpstreamOAuthError) {
    sendOAuthError(
      res,
      error.payload.error,
      error.payload.error_description,
      error.status,
      error.payload.error_uri,
    );
    return;
  }
  if (error instanceof OAuthProtocolError) {
    sendOAuthError(res, error.code, error.message, error.status);
    return;
  }
  if (error instanceof FacadeOAuthError) {
    sendOAuthError(res, error.code, error.message, error.status, error.errorUri);
    return;
  }
  sendOAuthError(res, 'server_error', 'the authorization server could not process the request', 500);
}

function isBodyParserError(error: unknown): error is { status: number } {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { status?: unknown; type?: unknown };
  return (candidate.status === 400 || candidate.status === 413)
    && typeof candidate.type === 'string';
}

function invalidRequest(message: string) {
  return new OAuthProtocolError('invalid_request', message);
}

function upstreamServerError() {
  return new OAuthProtocolError(
    'server_error',
    'upstream authorization server response is invalid',
    502,
  );
}

function isValidRedirectUri(value: string) {
  try {
    const redirectUri = new URL(value);
    return redirectUri.protocol.length > 1 && redirectUri.hash.length === 0;
  } catch {
    return false;
  }
}

function ensureTrailingSlash(url: URL) {
  const base = new URL(url.href);
  base.search = '';
  base.hash = '';
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  return base;
}
