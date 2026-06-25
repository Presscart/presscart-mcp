import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTPayload } from 'jose';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

type SupabaseOAuthVerifierOptions = {
  issuerUrl: URL;
  audience: URL;
};

export class SupabaseOAuthVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly options: SupabaseOAuthVerifierOptions) {
    this.jwks = createRemoteJWKSet(new URL('.well-known/jwks.json', ensureTrailingSlash(options.issuerUrl)));
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: normalizeIssuer(this.options.issuerUrl),
        audience: normalizeAudience(this.options.audience),
      });

      return toAuthInfo(token, payload, this.options.audience);
    } catch (error) {
      if (error instanceof InvalidTokenError) throw error;
      if (error instanceof joseErrors.JOSEError) {
        throw new InvalidTokenError('Invalid or expired token');
      }

      throw error;
    }
  }
}

function toAuthInfo(token: string, payload: JWTPayload, audience: URL): AuthInfo {
  const clientId = readStringClaim(payload, 'client_id');
  const grantId = readStringClaim(payload, 'grant_id');
  const subject = readStringClaim(payload, 'sub');
  const permissions = readStringArrayClaim(payload, 'permissions');

  if (!clientId || !grantId || !subject || permissions.length === 0) {
    throw new InvalidTokenError('Invalid token claims');
  }

  return {
    token,
    clientId,
    scopes: permissions,
    expiresAt: payload.exp,
    resource: audience,
    extra: {
      source: 'oauth',
      sub: subject,
      oauth_client_id: clientId,
      oauth_grant_id: grantId,
      permissions,
      scope: readStringClaim(payload, 'scope'),
      email: readStringClaim(payload, 'email'),
      first_name: readUserMetadataStringClaim(payload, 'first_name'),
      last_name: readUserMetadataStringClaim(payload, 'last_name'),
    },
  };
}

function readStringClaim(payload: JWTPayload, key: string) {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readStringArrayClaim(payload: JWTPayload, key: string) {
  const value = payload[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

function readUserMetadataStringClaim(payload: JWTPayload, key: string) {
  const userMetadata = payload.user_metadata;
  if (!userMetadata || typeof userMetadata !== 'object' || Array.isArray(userMetadata)) {
    return undefined;
  }

  const value = (userMetadata as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function ensureTrailingSlash(url: URL) {
  return url.href.endsWith('/') ? url : new URL(`${url.href}/`);
}

function normalizeIssuer(url: URL) {
  return url.href.endsWith('/') ? url.href.slice(0, -1) : url.href;
}

function normalizeAudience(url: URL) {
  return url.href.endsWith('/') ? url.href.slice(0, -1) : url.href;
}
