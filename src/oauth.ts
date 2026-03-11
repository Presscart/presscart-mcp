import { randomUUID } from 'node:crypto';

import type { Request, Response } from 'express';
import {
  InvalidRequestError,
  InvalidTargetError,
  InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import {
  checkResourceAllowed,
  resourceUrlFromServerUrl,
} from '@modelcontextprotocol/sdk/shared/auth-utils.js';
import { z } from 'zod';

import { PresscartApiClient, type TokenSessionResponse } from './api.js';

type PresscartOAuthProviderOptions = {
  issuerUrl: URL;
  mcpServerUrl: URL;
  presscartApiUrl: string;
  supportedScopes: string[];
};

type PendingAuthorizationRequest = {
  id: string;
  client: OAuthClientInformationFull;
  params: AuthorizationParams;
  createdAtMs: number;
};

type AuthorizationCodeRecord = {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  scopes: string[];
  resource?: string;
  presscartApiToken: string;
  presscartProfileId?: string;
  presscartSession: TokenSessionResponse;
  expiresAtMs: number;
};

type RefreshTokenRecord = {
  token: string;
  clientId: string;
  scopes: string[];
  resource?: string;
  presscartApiToken: string;
  presscartProfileId?: string;
  presscartSession: TokenSessionResponse;
  expiresAtMs: number;
};

type AccessTokenRecord = RefreshTokenRecord & {
  refreshToken?: string;
};

const profileIdSchema = z.string().uuid();

const AUTHORIZATION_REQUEST_TTL_MS = 10 * 60 * 1000;
const AUTHORIZATION_CODE_TTL_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

class InMemoryClientsStore implements OAuthRegisteredClientsStore {
  private readonly clients = new Map<string, OAuthClientInformationFull>();

  async getClient(clientId: string) {
    return this.clients.get(clientId);
  }

  async registerClient(client: OAuthClientInformationFull) {
    this.clients.set(client.client_id, client);
    return client;
  }
}

export class PresscartOAuthProvider implements OAuthServerProvider {
  readonly clientsStore = new InMemoryClientsStore();

  private readonly pendingRequests = new Map<string, PendingAuthorizationRequest>();
  private readonly authorizationCodes = new Map<string, AuthorizationCodeRecord>();
  private readonly accessTokens = new Map<string, AccessTokenRecord>();
  private readonly refreshTokens = new Map<string, RefreshTokenRecord>();

  constructor(private readonly options: PresscartOAuthProviderOptions) {}

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
    this.gcExpiredState();
    this.assertRequestedScopesSupported(params.scopes);
    this.assertResourceAllowed(params.resource);

    const requestId = randomUUID();
    this.pendingRequests.set(requestId, {
      id: requestId,
      client,
      params,
      createdAtMs: Date.now(),
    });

    const approvalUrl = new URL('/oauth/authorize', this.options.issuerUrl);
    approvalUrl.searchParams.set('request', requestId);

    res.redirect(302, approvalUrl.toString());
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string
  ) {
    this.gcExpiredState();

    const record = this.authorizationCodes.get(authorizationCode);
    if (!record || record.clientId !== client.client_id) {
      throw new InvalidRequestError('Invalid authorization code');
    }

    return record.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL
  ): Promise<OAuthTokens> {
    this.gcExpiredState();

    const record = this.authorizationCodes.get(authorizationCode);
    if (!record || record.clientId !== client.client_id) {
      throw new InvalidRequestError('Invalid authorization code');
    }

    if (record.expiresAtMs <= Date.now()) {
      this.authorizationCodes.delete(authorizationCode);
      throw new InvalidRequestError('Authorization code expired');
    }

    if (redirectUri && redirectUri !== record.redirectUri) {
      throw new InvalidRequestError('redirect_uri mismatch');
    }

    this.assertRequestedResourceMatches(resource, record.resource);
    this.authorizationCodes.delete(authorizationCode);

    const refreshToken = randomUUID();
    const accessToken = this.issueAccessToken({
      clientId: client.client_id,
      scopes: record.scopes,
      resource: record.resource,
      presscartApiToken: record.presscartApiToken,
      presscartProfileId: record.presscartProfileId,
      presscartSession: record.presscartSession,
      refreshToken,
    });

    this.refreshTokens.set(refreshToken, {
      token: refreshToken,
      clientId: client.client_id,
      scopes: record.scopes,
      resource: record.resource,
      presscartApiToken: record.presscartApiToken,
      presscartProfileId: record.presscartProfileId,
      presscartSession: record.presscartSession,
      expiresAtMs: Date.now() + REFRESH_TOKEN_TTL_MS,
    });

    return {
      access_token: accessToken.token,
      token_type: 'bearer',
      expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
      refresh_token: refreshToken,
      scope: record.scopes.length > 0 ? record.scopes.join(' ') : undefined,
    };
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL
  ): Promise<OAuthTokens> {
    this.gcExpiredState();

    const record = this.refreshTokens.get(refreshToken);
    if (!record || record.clientId !== client.client_id) {
      throw new InvalidRequestError('Invalid refresh token');
    }

    if (record.expiresAtMs <= Date.now()) {
      this.refreshTokens.delete(refreshToken);
      throw new InvalidRequestError('Refresh token expired');
    }

    this.assertRequestedResourceMatches(resource, record.resource);

    if (scopes && !scopes.every(scope => record.scopes.includes(scope))) {
      throw new InvalidRequestError('Requested scopes exceed the original grant');
    }

    const effectiveScopes = scopes && scopes.length > 0 ? scopes : record.scopes;
    const accessToken = this.issueAccessToken({
      clientId: client.client_id,
      scopes: effectiveScopes,
      resource: record.resource,
      presscartApiToken: record.presscartApiToken,
      presscartProfileId: record.presscartProfileId,
      presscartSession: record.presscartSession,
      refreshToken: record.token,
    });

    return {
      access_token: accessToken.token,
      token_type: 'bearer',
      expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
      refresh_token: record.token,
      scope: effectiveScopes.length > 0 ? effectiveScopes.join(' ') : undefined,
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    this.gcExpiredState();

    const record = this.accessTokens.get(token);
    if (!record || record.expiresAtMs <= Date.now()) {
      this.accessTokens.delete(token);
      throw new InvalidTokenError('Invalid or expired token');
    }

    return {
      token,
      clientId: record.clientId,
      scopes: record.scopes,
      expiresAt: Math.floor(record.expiresAtMs / 1000),
      resource: record.resource ? new URL(record.resource) : undefined,
      extra: {
        team_id: record.presscartSession.team_id,
        presscart_api_token: record.presscartApiToken,
        presscart_profile_id: record.presscartProfileId,
        presscart_token_session: record.presscartSession,
      },
    };
  }

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest) {
    const accessRecord = this.accessTokens.get(request.token);
    if (accessRecord && accessRecord.clientId === client.client_id) {
      this.accessTokens.delete(request.token);
    }

    const refreshRecord = this.refreshTokens.get(request.token);
    if (refreshRecord && refreshRecord.clientId === client.client_id) {
      this.refreshTokens.delete(request.token);
    }
  }

  async renderAuthorizationPage(req: Request, res: Response) {
    this.gcExpiredState();

    const requestId = typeof req.query.request === 'string' ? req.query.request : undefined;
    if (!requestId) {
      res.status(400).type('html').send(renderErrorPage('Missing authorization request.'));
      return;
    }

    const pending = this.pendingRequests.get(requestId);
    if (!pending || this.isExpired(pending.createdAtMs, AUTHORIZATION_REQUEST_TTL_MS)) {
      this.pendingRequests.delete(requestId);
      res
        .status(400)
        .type('html')
        .send(renderErrorPage('Authorization request expired. Restart the OAuth flow from your MCP client.'));
      return;
    }

    res.status(200).type('html').send(renderAuthorizationForm(pending));
  }

  async approveAuthorization(req: Request, res: Response) {
    this.gcExpiredState();

    const requestId = readBodyValue(req.body.request);
    const presscartApiToken = readBodyValue(req.body.presscart_api_token)?.trim();
    const presscartProfileId = readBodyValue(req.body.presscart_profile_id)?.trim();

    const pending = requestId ? this.pendingRequests.get(requestId) : undefined;
    if (!requestId || !pending || this.isExpired(pending.createdAtMs, AUTHORIZATION_REQUEST_TTL_MS)) {
      if (requestId) this.pendingRequests.delete(requestId);
      res
        .status(400)
        .type('html')
        .send(renderErrorPage('Authorization request expired. Restart the OAuth flow from your MCP client.'));
      return;
    }

    if (!presscartApiToken) {
      res
        .status(400)
        .type('html')
        .send(renderAuthorizationForm(pending, 'Presscart API token is required.', presscartProfileId));
      return;
    }

    if (presscartProfileId) {
      const parsedProfileId = profileIdSchema.safeParse(presscartProfileId);
      if (!parsedProfileId.success) {
        res
          .status(400)
          .type('html')
          .send(renderAuthorizationForm(pending, 'Profile ID must be a valid UUID.', presscartProfileId));
        return;
      }
    }

    let presscartSession: TokenSessionResponse;
    try {
      presscartSession = await this.verifyPresscartCredential(presscartApiToken);
    } catch {
      res
        .status(401)
        .type('html')
        .send(
          renderAuthorizationForm(
            pending,
            'The Presscart API token was rejected. Check the token and try again.',
            presscartProfileId
          )
        );
      return;
    }

    const authorizationCode = randomUUID();
    this.authorizationCodes.set(authorizationCode, {
      clientId: pending.client.client_id,
      codeChallenge: pending.params.codeChallenge,
      redirectUri: pending.params.redirectUri,
      scopes: pending.params.scopes ?? [],
      resource: pending.params.resource
        ? resourceUrlFromServerUrl(pending.params.resource).href
        : undefined,
      presscartApiToken,
      presscartProfileId: presscartProfileId || undefined,
      presscartSession,
      expiresAtMs: Date.now() + AUTHORIZATION_CODE_TTL_MS,
    });
    this.pendingRequests.delete(requestId);

    const redirectUrl = new URL(pending.params.redirectUri);
    redirectUrl.searchParams.set('code', authorizationCode);
    if (pending.params.state) {
      redirectUrl.searchParams.set('state', pending.params.state);
    }

    res.redirect(302, redirectUrl.toString());
  }

  private issueAccessToken(
    token: Omit<AccessTokenRecord, 'token' | 'expiresAtMs'>
  ): AccessTokenRecord {
    const issued = {
      ...token,
      token: randomUUID(),
      expiresAtMs: Date.now() + ACCESS_TOKEN_TTL_MS,
    };

    this.accessTokens.set(issued.token, issued);
    return issued;
  }

  private async verifyPresscartCredential(token: string) {
    const api = new PresscartApiClient(this.options.presscartApiUrl, token);
    return api.get<TokenSessionResponse>('/auth/token');
  }

  private assertRequestedScopesSupported(scopes: string[] | undefined) {
    if (!scopes || scopes.length === 0) return;

    const unsupported = scopes.filter(scope => !this.options.supportedScopes.includes(scope));
    if (unsupported.length > 0) {
      throw new InvalidRequestError(`Unsupported scopes requested: ${unsupported.join(', ')}`);
    }
  }

  private assertResourceAllowed(resource: URL | undefined) {
    if (!resource) return;

    const configuredResource = resourceUrlFromServerUrl(this.options.mcpServerUrl);
    if (!checkResourceAllowed({ requestedResource: resource, configuredResource })) {
      throw new InvalidTargetError(
        `Expected resource indicator ${configuredResource.href}, got ${resource.href}`
      );
    }
  }

  private assertRequestedResourceMatches(requested: URL | undefined, expected: string | undefined) {
    if (!requested && !expected) return;
    if (!requested || !expected || requested.href !== expected) {
      throw new InvalidRequestError('resource indicator mismatch');
    }
  }

  private gcExpiredState() {
    const now = Date.now();

    for (const [requestId, pending] of this.pendingRequests.entries()) {
      if (pending.createdAtMs + AUTHORIZATION_REQUEST_TTL_MS <= now) {
        this.pendingRequests.delete(requestId);
      }
    }

    for (const [code, record] of this.authorizationCodes.entries()) {
      if (record.expiresAtMs <= now) {
        this.authorizationCodes.delete(code);
      }
    }

    for (const [token, record] of this.accessTokens.entries()) {
      if (record.expiresAtMs <= now) {
        this.accessTokens.delete(token);
      }
    }

    for (const [token, record] of this.refreshTokens.entries()) {
      if (record.expiresAtMs <= now) {
        this.refreshTokens.delete(token);
      }
    }
  }

  private isExpired(createdAtMs: number, ttlMs: number) {
    return createdAtMs + ttlMs <= Date.now();
  }
}

function renderAuthorizationForm(
  pending: PendingAuthorizationRequest,
  error?: string,
  profileId?: string
) {
  const clientName = pending.client.client_name ?? pending.client.client_id;
  const scopeText =
    pending.params.scopes && pending.params.scopes.length > 0
      ? pending.params.scopes.join(', ')
      : 'all';
  const resourceText = pending.params.resource?.href ?? 'default';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Authorize \u2014 Presscart MCP</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Newsreader:wght@400;500;600&family=Work+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
    <style>
      *,*::before,*::after{box-sizing:border-box;margin:0}
      body{
        min-height:100vh;
        display:flex;
        align-items:center;
        justify-content:center;
        padding:24px;
        background:#f2f2f2;
        font-family:'Work Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
        color:#1e1a1c;
        -webkit-font-smoothing:antialiased;
      }
      .card{
        width:100%;
        max-width:440px;
        background:#fff;
        border-radius:20px;
        border:1px solid #e7e7e7;
        padding:36px 32px 32px;
        box-shadow:
          0 44px 27px rgba(0,0,0,0.01),
          0 20px 20px rgba(0,0,0,0.02),
          0 5px 11px rgba(0,0,0,0.02);
      }
      .brand{
        display:flex;
        align-items:center;
        gap:10px;
        margin-bottom:28px;
      }
      .brand-mark{
        width:34px;height:34px;
        border-radius:10px;
        background:#1e1a1c;
        color:#fff;
        display:flex;align-items:center;justify-content:center;
        font-size:11px;font-weight:600;letter-spacing:0.08em;
      }
      .brand-name{
        font-size:15px;font-weight:600;letter-spacing:-0.16px;
      }
      h1{
        font-family:'Newsreader',Georgia,serif;
        font-size:28px;font-weight:500;line-height:1.15;
        margin-bottom:8px;letter-spacing:-0.56px;
      }
      .subtitle{
        font-size:14px;color:#636363;line-height:1.55;
        margin-bottom:24px;
      }
      .subtitle strong{color:#1e1a1c}
      .meta{
        display:flex;gap:8px;flex-wrap:wrap;
        margin-bottom:24px;
      }
      .meta-tag{
        font-size:12px;font-weight:500;
        padding:5px 10px;
        border-radius:8px;
        background:#f3e8ff;
        color:#1e1a1c;
        border:1px solid #eadcf5;
      }
      .divider{
        height:1px;background:#e7e7e7;
        margin-bottom:24px;
      }
      .error{
        background:#fef2f2;
        border:1px solid #fecaca;
        color:#991b1b;
        padding:12px 14px;
        border-radius:8px;
        font-size:13px;line-height:1.5;
        margin-bottom:16px;
      }
      .field{
        margin-bottom:18px;
      }
      .field label{
        display:block;
        font-size:13px;font-weight:500;
        margin-bottom:6px;color:#1e1a1c;
      }
      .field input{
        width:100%;
        padding:11px 14px;
        border:1px solid #e7e7e7;
        border-radius:8px;
        font:inherit;font-size:14px;
        color:#1e1a1c;
        background:#fff;
        transition:border-color 150ms,box-shadow 150ms;
      }
      .field input:focus{
        outline:none;
        border-color:#B98ADE;
        box-shadow:0 0 0 3px rgba(185,138,222,0.15);
      }
      .field input::placeholder{color:#b0b0b0}
      .field-hint{
        font-size:12px;color:#636363;margin-top:5px;line-height:1.4;
      }
      .btn{
        width:100%;
        padding:12px;
        border:0;border-radius:8px;
        background:#1e1a1c;color:#fff;
        font:inherit;font-size:14px;font-weight:600;
        cursor:pointer;
        transition:background 150ms;
        margin-top:6px;
      }
      .btn:hover{background:black}
      .btn:focus-visible{
        outline:none;
        box-shadow:0 0 0 2px #1e1a1c,0 0 0 4px rgba(30,26,28,0.2);
      }
      .footer{
        margin-top:20px;
        padding:12px 14px;
        border-radius:8px;
        background:#f7f7f7;
        border:1px solid #e7e7e7;
        font-size:12px;color:#636363;line-height:1.5;
      }
      @media(max-width:480px){
        body{padding:16px}
        .card{padding:28px 22px 24px;border-radius:16px}
      }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="brand">
        <span class="brand-mark">PC</span>
        <span class="brand-name">Presscart</span>
      </div>

      <h1>Authorize MCP access</h1>
      <p class="subtitle">
        <strong>${escapeHtml(clientName)}</strong> wants to connect to your Presscart workspace.
      </p>

      <div class="meta">
        <span class="meta-tag">Scopes: ${escapeHtml(scopeText)}</span>
        <span class="meta-tag">Resource: ${escapeHtml(resourceText)}</span>
      </div>

      <div class="divider"></div>

      ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}

      <form method="post" action="/oauth/authorize">
        <input type="hidden" name="request" value="${escapeHtml(pending.id)}" />

        <div class="field">
          <label for="presscart_api_token">API token</label>
          <input
            id="presscart_api_token"
            type="password"
            name="presscart_api_token"
            autocomplete="off"
            placeholder="pc_..."
            required
          />
        </div>

        <div class="field">
          <label for="presscart_profile_id">Default profile ID</label>
          <input
            id="presscart_profile_id"
            type="text"
            name="presscart_profile_id"
            value="${escapeHtml(profileId ?? '')}"
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          />
          <p class="field-hint">Optional. Pre-selects a profile for tool calls.</p>
        </div>

        <button class="btn" type="submit">Authorize</button>
      </form>

      <div class="footer">
        Your token is verified server-side. If invalid, you can retry without restarting the flow.
      </div>
    </div>
  </body>
</html>`;
}

function renderErrorPage(message: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Error \u2014 Presscart MCP</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Newsreader:wght@400;500&family=Work+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
    <style>
      *,*::before,*::after{box-sizing:border-box;margin:0}
      body{
        min-height:100vh;
        display:flex;align-items:center;justify-content:center;
        padding:24px;
        background:#f2f2f2;
        color:#1e1a1c;
        font-family:'Work Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
        -webkit-font-smoothing:antialiased;
      }
      .card{
        width:100%;max-width:440px;
        background:#fff;
        border-radius:20px;
        border:1px solid #e7e7e7;
        padding:36px 32px 32px;
        box-shadow:
          0 44px 27px rgba(0,0,0,0.01),
          0 20px 20px rgba(0,0,0,0.02),
          0 5px 11px rgba(0,0,0,0.02);
      }
      .brand{
        display:flex;align-items:center;gap:10px;
        margin-bottom:28px;
      }
      .brand-mark{
        width:34px;height:34px;border-radius:10px;
        background:#1e1a1c;color:#fff;
        display:flex;align-items:center;justify-content:center;
        font-size:11px;font-weight:600;letter-spacing:0.08em;
      }
      .brand-name{font-size:15px;font-weight:600;letter-spacing:-0.16px}
      .error-badge{
        display:inline-block;
        font-size:12px;font-weight:500;
        padding:5px 10px;border-radius:8px;
        background:#fef2f2;color:#991b1b;
        border:1px solid #fecaca;
        margin-bottom:16px;
      }
      h1{
        font-family:'Newsreader',Georgia,serif;
        font-size:28px;font-weight:500;line-height:1.15;
        letter-spacing:-0.56px;
        margin-bottom:12px;
      }
      p{
        font-size:15px;color:#3c3c3c;line-height:1.6;
      }
      @media(max-width:480px){
        body{padding:16px}
        .card{padding:28px 22px 24px;border-radius:16px}
      }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="brand">
        <span class="brand-mark">PC</span>
        <span class="brand-name">Presscart</span>
      </div>
      <span class="error-badge">Authorization error</span>
      <h1>Something went wrong</h1>
      <p>${escapeHtml(message)}</p>
    </div>
  </body>
</html>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function readBodyValue(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}
