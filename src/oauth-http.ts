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
  return {
    router: createOAuthRouter(options),
    bearerAuth: requireBearerAuth({
      verifier: options.verifier,
      requiredScopes: [],
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(options.serverUrl),
    }),
  };
}

export function validateOAuthSessionAuth(
  sessionAuthInfo: AuthInfo | undefined,
  requestAuthInfo: AuthInfo | undefined
): AuthInfo {
  if (!requestAuthInfo) {
    throw new OAuthSessionAuthError('Missing Authorization header');
  }

  if (!sessionAuthInfo) {
    return requestAuthInfo;
  }

  const sessionClientId = sessionAuthInfo.clientId;
  const requestClientId = requestAuthInfo.clientId;
  const sessionSubject = readAuthExtraValue(sessionAuthInfo, 'sub');
  const requestSubject = readAuthExtraValue(requestAuthInfo, 'sub');
  const sessionGrantId = readAuthExtraValue(sessionAuthInfo, 'oauth_grant_id');
  const requestGrantId = readAuthExtraValue(requestAuthInfo, 'oauth_grant_id');

  if (
    sessionClientId !== requestClientId ||
    sessionSubject !== requestSubject ||
    sessionGrantId !== requestGrantId
  ) {
    throw new OAuthSessionAuthError(
      'Authorization token does not match the OAuth grant bound to the active MCP session.'
    );
  }

  return requestAuthInfo;
}

function readAuthExtraValue(authInfo: AuthInfo, key: string) {
  const value = authInfo.extra?.[key];
  return typeof value === 'string' ? value : undefined;
}
