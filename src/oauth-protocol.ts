import { z } from 'zod';

export const FACADE_SCOPE = 'profile offline_access';
export const UPSTREAM_SCOPE = 'profile';

const tokenEndpointAuthMethodSchema = z.enum([
  'none',
  'client_secret_basic',
  'client_secret_post',
]);
const grantTypesSchema = uniqueStringArray(
  z.enum(['authorization_code', 'refresh_token']),
).refine(values => values.includes('authorization_code'));
const responseTypesSchema = z.array(z.literal('code')).length(1);
const uriSchema = z.string().min(1).url();
const textSchema = z.string().min(1);
const redirectUrisSchema = uniqueStringArray(uriSchema, 1);
const optionalRegistrationMetadataFields = {
  client_name: textSchema.optional(),
  client_uri: uriSchema.optional(),
  logo_uri: uriSchema.optional(),
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
  grant_types: grantTypesSchema.default(['authorization_code']),
  response_types: responseTypesSchema.default(['code']),
  ...optionalRegistrationMetadataFields,
  scope: z.string().optional(),
}).strict();

const registrationResponseSchema = z.object({
  redirect_uris: redirectUrisSchema,
  token_endpoint_auth_method: tokenEndpointAuthMethodSchema,
  grant_types: grantTypesSchema,
  response_types: responseTypesSchema,
  ...optionalRegistrationMetadataFields,
  scope: z.string(),
  client_id: z.string().min(1),
  client_secret: z.string().min(1).optional(),
  client_id_issued_at: z.number().int().nonnegative().optional(),
  client_secret_expires_at: z.number().int().nonnegative().optional(),
  registration_access_token: z.string().min(1).optional(),
  registration_client_uri: uriSchema.optional(),
}).strict();

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
  if (unique.size !== 2 || !unique.has('profile') || !unique.has('offline_access')) {
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
  if (!parsed.success || parsed.data.scope !== UPSTREAM_SCOPE) {
    throw upstreamResponseError('registration');
  }

  const upstream = parsed.data;
  const matchesRequest = sameStringSet(upstream.redirect_uris, request.redirect_uris)
    && upstream.token_endpoint_auth_method === request.token_endpoint_auth_method
    && sameStringSet(upstream.grant_types, request.grant_types)
    && sameStringSet(upstream.response_types, request.response_types);
  if (!matchesRequest) {
    throw upstreamResponseError('registration');
  }

  const {
    registration_access_token: _registrationAccessToken,
    registration_client_uri: _registrationClientUri,
    ...publicResponse
  } = upstream;
  return { ...publicResponse, scope: FACADE_SCOPE };
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

function upstreamResponseError(operation: 'registration' | 'token') {
  return new OAuthProtocolError(
    'server_error',
    `upstream ${operation} response is invalid`,
    502,
  );
}
