import { isIP } from 'node:net';

import { z } from 'zod';

export const FACADE_SCOPE = 'profile offline_access';
export const UPSTREAM_SCOPE = 'profile';

const tokenEndpointAuthMethodSchema = z.enum([
  'none',
  'client_secret_basic',
  'client_secret_post',
]);
const clientTypeSchema = z.enum(['public', 'confidential']);
const grantTypesSchema = z.array(
  z.enum(['authorization_code', 'refresh_token']),
).length(2).refine(values => new Set(values).size === 2);
const responseTypesSchema = z.array(z.literal('code')).length(1);
const uriSchema = z.string().min(1).url();
const redirectUriSchema = z.string().min(1).refine(isAllowedRedirectUri);
const textSchema = z.string().min(1);
const redirectUrisSchema = uniqueStringArray(redirectUriSchema, 1);
const supportedRegistrationMetadataFields = {
  client_name: textSchema.optional(),
  client_uri: uriSchema.optional(),
  logo_uri: uriSchema.optional(),
} as const;
const ignoredRegistrationRequestMetadataFields = {
  contacts: uniqueStringArray(z.string().email()).optional(),
  tos_uri: uriSchema.optional(),
  policy_uri: uriSchema.optional(),
  jwks_uri: uriSchema.optional(),
  jwks: z.record(z.unknown()).optional(),
  software_id: textSchema.optional(),
  software_version: textSchema.optional(),
} as const;

const registrationRequestSchema = z.object({
  redirect_uris: redirectUrisSchema,
  token_endpoint_auth_method: tokenEndpointAuthMethodSchema.default('client_secret_basic'),
  grant_types: grantTypesSchema.default(['authorization_code', 'refresh_token']),
  response_types: responseTypesSchema.default(['code']),
  ...supportedRegistrationMetadataFields,
  ...ignoredRegistrationRequestMetadataFields,
  scope: z.string().optional(),
}).strict();

const registrationResponseSchema = z.object({
  redirect_uris: redirectUrisSchema,
  token_endpoint_auth_method: tokenEndpointAuthMethodSchema,
  grant_types: grantTypesSchema,
  response_types: responseTypesSchema,
  ...supportedRegistrationMetadataFields,
  scope: z.string().optional(),
  client_id: z.string().uuid(),
  client_secret: z.string().min(1).optional(),
  client_type: clientTypeSchema,
  registration_type: z.literal('dynamic'),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
}).strict().superRefine((response, context) => {
  const hasClientSecret = response.client_secret !== undefined;
  const credentialsMatchAuthMethod = response.token_endpoint_auth_method === 'none'
    ? !hasClientSecret
    : hasClientSecret;

  if (!credentialsMatchAuthMethod) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'client credentials do not match token endpoint authentication method',
    });
  }

  const expectedClientType = response.token_endpoint_auth_method === 'none'
    ? 'public'
    : 'confidential';
  if (response.client_type !== expectedClientType) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'client type does not match token endpoint authentication method',
    });
  }
});

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().regex(/^bearer$/i),
  expires_in: z.number().int().nonnegative(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
}).strict();

export class OAuthProtocolError extends Error {
  constructor(
    readonly code: 'invalid_request' | 'invalid_scope' | 'invalid_target' | 'server_error',
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'OAuthProtocolError';
  }
}

export function parseFacadeScope(scope: string | undefined) {
  if (scope === undefined) return { facade: FACADE_SCOPE, upstream: UPSTREAM_SCOPE } as const;
  const values = scope.trim().split(/\s+/).filter(Boolean);
  const unique = new Set(values);
  if (values.length !== 2
    || unique.size !== 2
    || !unique.has('profile')
    || !unique.has('offline_access')) {
    throw new OAuthProtocolError('invalid_scope', 'scope must contain profile and offline_access');
  }
  return { facade: FACADE_SCOPE, upstream: UPSTREAM_SCOPE } as const;
}

export function parseCanonicalResource(value: string | undefined, canonical: URL) {
  if (value === undefined) return undefined;
  if (value !== canonical.href) {
    throw new OAuthProtocolError('invalid_target', 'resource is not supported');
  }
  return value;
}

export function parseRedirectUri(value: string) {
  if (!isAllowedRedirectUri(value)) {
    throw new OAuthProtocolError('invalid_request', 'redirect_uri is invalid');
  }
  return value;
}

export function validateUpstreamIssuer(issuer: URL) {
  if (issuer.protocol === 'https:') return;
  if (issuer.protocol === 'http:' && isLoopbackHostname(issuer.hostname)) return;
  throw new Error(
    'MCP_OAUTH_ISSUER_URL must use HTTPS, except for loopback HTTP development issuers.'
  );
}

export function resolveOAuthAudiences(args: {
  resource: URL;
  serverUrl: URL;
  legacyAudience?: URL;
}): [URL, ...URL[]] {
  if (args.legacyAudience === undefined) return [args.resource];

  const expectedLegacyAudience = new URL(args.serverUrl.origin);
  const legacy = normalizeUrlForComparison(args.legacyAudience);
  if (legacy !== normalizeUrlForComparison(expectedLegacyAudience)
    || legacy === normalizeUrlForComparison(args.resource)) {
    throw new Error(
      'MCP_OAUTH_LEGACY_AUDIENCE must match the MCP server origin and differ from the canonical resource.'
    );
  }

  return [args.resource, expectedLegacyAudience];
}

export function createAuthorizationServerMetadata(authorizationServer: URL) {
  const issuer = authorizationServer.href.replace(/\/$/, '');
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    scopes_supported: ['profile', 'offline_access'],
  };
}

export function createProtectedResourceMetadata(args: {
  resource: URL;
  authorizationServer: URL;
  translatorEnabled: boolean;
}) {
  return {
    resource: args.resource.href,
    authorization_servers: [args.authorizationServer.href.replace(/\/$/, '')],
    scopes_supported: args.translatorEnabled ? ['profile', 'offline_access'] : ['openid', 'profile'],
    bearer_methods_supported: ['header'],
    resource_name: 'Presscart MCP',
  };
}

export function translateRegistrationRequest(value: unknown) {
  const parsed = registrationRequestSchema.safeParse(value);
  if (!parsed.success) {
    throw new OAuthProtocolError('invalid_request', 'client registration request is invalid');
  }

  const scope = parseFacadeScope(parsed.data.scope);
  return {
    facade: { ...parsed.data, scope: scope.facade },
    upstream: { ...parsed.data, scope: scope.upstream },
  };
}

export function translateRegistrationResponse(args: { request: unknown; upstream: unknown }) {
  const request = translateRegistrationRequest(args.request).facade;
  const parsed = registrationResponseSchema.safeParse(args.upstream);
  if (!parsed.success
    || (parsed.data.scope !== undefined && parsed.data.scope !== UPSTREAM_SCOPE)) {
    throw upstreamResponseError('registration');
  }

  const upstream = parsed.data;
  const matchesRequest = sameStringSet(upstream.redirect_uris, request.redirect_uris)
    && upstream.token_endpoint_auth_method === request.token_endpoint_auth_method
    && sameStringSet(upstream.grant_types, request.grant_types)
    && sameStringSet(upstream.response_types, request.response_types)
    && upstream.client_name === request.client_name
    && upstream.client_uri === request.client_uri
    && upstream.logo_uri === request.logo_uri;
  if (!matchesRequest) {
    throw upstreamResponseError('registration');
  }

  return {
    client_id: upstream.client_id,
    ...(upstream.client_secret === undefined ? {} : { client_secret: upstream.client_secret }),
    redirect_uris: upstream.redirect_uris,
    token_endpoint_auth_method: upstream.token_endpoint_auth_method,
    grant_types: upstream.grant_types,
    response_types: upstream.response_types,
    ...(upstream.client_name === undefined ? {} : { client_name: upstream.client_name }),
    ...(upstream.client_uri === undefined ? {} : { client_uri: upstream.client_uri }),
    ...(upstream.logo_uri === undefined ? {} : { logo_uri: upstream.logo_uri }),
    scope: FACADE_SCOPE,
  };
}

export function translateTokenResponse(args: {
  grantType: 'authorization_code' | 'refresh_token';
  upstream: unknown;
}) {
  const parsed = tokenResponseSchema.safeParse(args.upstream);
  if (!parsed.success || (parsed.data.scope !== undefined && parsed.data.scope !== UPSTREAM_SCOPE)) {
    throw upstreamResponseError('token');
  }
  if (args.grantType === 'authorization_code' && parsed.data.refresh_token === undefined) {
    throw new OAuthProtocolError(
      'server_error',
      'upstream token response did not include offline access',
      502,
    );
  }

  return { ...parsed.data, scope: FACADE_SCOPE };
}

function uniqueStringArray<T extends z.ZodType<string>>(item: T, min = 0) {
  return z.array(item).min(min).refine(values => new Set(values).size === values.length);
}

function sameStringSet(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every(value => right.includes(value));
}

function isAllowedRedirectUri(value: string) {
  try {
    const redirectUri = new URL(value);
    if (redirectUri.username.length > 0 || redirectUri.password.length > 0 || value.includes('#')) {
      return false;
    }
    if (redirectUri.protocol === 'https:') return true;
    return redirectUri.protocol === 'http:' && isLoopbackHostname(redirectUri.hostname);
  } catch {
    return false;
  }
}

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost'
    || normalized === '[::1]'
    || (isIP(normalized) === 4 && normalized.startsWith('127.'));
}

function normalizeUrlForComparison(url: URL) {
  return url.href.endsWith('/') ? url.href.slice(0, -1) : url.href;
}

function upstreamResponseError(operation: 'registration' | 'token') {
  return new OAuthProtocolError(
    'server_error',
    `upstream ${operation} response is invalid`,
    502,
  );
}
