import { getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

import { createOAuthRouter, type OAuthRouterOptions } from './oauth-router.js';

export type OAuthHttpLayerOptions = OAuthRouterOptions & {
  serverUrl: URL;
  verifier: OAuthTokenVerifier;
};

export class OAuthSessionAuthError extends Error {
  readonly statusCode = 401;

  constructor(message: string) {
    super(message);
    this.name = 'OAuthSessionAuthError';
  }
}

export function createOAuthHttpLayer(options: OAuthHttpLayerOptions) {
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(options.serverUrl);
  return {
    router: createOAuthRouter(options),
    bearerAuth: requireBearerAuth({
      verifier: options.verifier,
      requiredScopes: [],
      resourceMetadataUrl,
    }),
    resourceMetadataUrl,
  };
}

export function validateOAuthSessionAuth(
  sessionAuthInfo: AuthInfo | undefined,
  requestAuthInfo: AuthInfo | undefined
): AuthInfo {
  if (!requestAuthInfo) {
    throw new OAuthSessionAuthError('Missing Authorization header');
  }

  const requestIdentity = readOAuthSessionIdentity(requestAuthInfo);
  if (!sessionAuthInfo) {
    return requestAuthInfo;
  }

  const sessionIdentity = readOAuthSessionIdentity(sessionAuthInfo);

  if (
    sessionIdentity.clientId !== requestIdentity.clientId ||
    sessionIdentity.subject !== requestIdentity.subject ||
    sessionIdentity.grantId !== requestIdentity.grantId
  ) {
    throw sessionIdentityError();
  }

  return requestAuthInfo;
}

function readAuthExtraValue(authInfo: AuthInfo, key: string) {
  const value = authInfo.extra?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readOAuthSessionIdentity(authInfo: AuthInfo) {
  const clientId = authInfo.clientId;
  const subject = readAuthExtraValue(authInfo, 'sub');
  const grantId = readAuthExtraValue(authInfo, 'oauth_grant_id');
  if (!clientId || !subject || !grantId) throw sessionIdentityError();
  return { clientId, subject, grantId };
}

function sessionIdentityError() {
  return new OAuthSessionAuthError(
    'Authorization token does not match the OAuth grant bound to the active MCP session.'
  );
}
