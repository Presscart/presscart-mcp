import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  OAuthProtocolError,
  createAuthorizationServerMetadata,
  createProtectedResourceMetadata,
  parseCanonicalResource,
  parseFacadeScope,
  resolveOAuthAudiences,
  translateRegistrationRequest,
  translateRegistrationResponse,
  translateTokenResponse,
  validatePublicOAuthUrl,
  validateUpstreamIssuer,
} from './oauth-protocol.js';

const resource = new URL('https://mcp.presscart.com/mcp');
const facade = new URL('https://mcp.presscart.com');
const facadeIssuer = facade.href.replace(/\/$/, '');
const upstream = new URL('https://project.supabase.co/auth/v1');
const publicClientId = 'a7f2616f-caf6-47d6-8f46-fabf13f11397';
const confidentialClientId = '849f3adf-54e5-4fff-936c-5939fe05a666';
const createdAt = '2026-07-17T09:00:00Z';
const updatedAt = '2026-07-17T09:01:00Z';

function officialRegistrationResponse(args: {
  tokenEndpointAuthMethod?: 'none' | 'client_secret_basic' | 'client_secret_post';
  clientName?: string;
  clientUri?: string;
  logoUri?: string;
} = {}) {
  const tokenEndpointAuthMethod = args.tokenEndpointAuthMethod ?? 'none';
  const confidential = tokenEndpointAuthMethod !== 'none';
  return {
    client_id: confidential ? confidentialClientId : publicClientId,
    client_type: confidential ? 'confidential' : 'public',
    redirect_uris: ['https://client.example/callback'],
    token_endpoint_auth_method: tokenEndpointAuthMethod,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    ...(args.clientName === undefined ? {} : { client_name: args.clientName }),
    ...(args.clientUri === undefined ? {} : { client_uri: args.clientUri }),
    ...(args.logoUri === undefined ? {} : { logo_uri: args.logoUri }),
    ...(confidential ? { client_secret: 'client-secret' } : {}),
    registration_type: 'dynamic',
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

describe('scope translation', () => {
  test('defaults an omitted scope to the full facade set', () => {
    assert.deepEqual(parseFacadeScope(undefined), { facade: 'profile offline_access', upstream: 'profile' });
  });
  test('accepts the two scopes in either order', () => {
    assert.equal(parseFacadeScope('offline_access profile').upstream, 'profile');
  });
  for (const value of [
    'profile',
    'offline_access',
    'profile email',
    'profile profile offline_access',
    'profile offline_access offline_access',
    '',
  ]) {
    test(`rejects partial or unsupported scope: ${JSON.stringify(value)}`, () => {
      assert.throws(() => parseFacadeScope(value), (error: unknown) =>
        error instanceof OAuthProtocolError && error.code === 'invalid_scope');
    });
  }
});

test('accepts only the exact canonical resource', () => {
  assert.equal(parseCanonicalResource(resource.href, resource), resource.href);
  assert.throws(() => parseCanonicalResource(facade.href, resource), (error: unknown) =>
    error instanceof OAuthProtocolError && error.code === 'invalid_target');
});

test('accepts only HTTPS or loopback HTTP for the upstream OAuth issuer', () => {
  for (const value of [
    'https://project.supabase.co/auth/v1',
    'http://localhost:54321/auth/v1',
    'http://127.0.0.42:54321/auth/v1',
    'http://[::1]:54321/auth/v1',
  ]) {
    assert.doesNotThrow(() => validateUpstreamIssuer(new URL(value)));
  }

  for (const value of [
    'http://project.supabase.co/auth/v1',
    'http://localhost.attacker.example/auth/v1',
    'ftp://project.supabase.co/auth/v1',
  ]) {
    assert.throws(
      () => validateUpstreamIssuer(new URL(value)),
      /MCP_OAUTH_ISSUER_URL must use HTTPS/,
    );
  }
});

test('accepts only HTTPS or loopback HTTP for public OAuth URLs', () => {
  for (const value of [
    'https://mcp.presscart.com/mcp',
    'http://localhost:8080/mcp',
    'http://127.0.0.42:8080/mcp',
    'http://[::1]:8080/mcp',
  ]) {
    assert.doesNotThrow(() => validatePublicOAuthUrl(new URL(value), 'MCP_SERVER_URL'));
  }

  for (const value of [
    'http://mcp.presscart.com/mcp',
    'http://localhost.attacker.example/mcp',
    'ftp://mcp.presscart.com/mcp',
  ]) {
    assert.throws(
      () => validatePublicOAuthUrl(new URL(value), 'MCP_SERVER_URL'),
      /MCP_SERVER_URL must use HTTPS/,
    );
  }
});

test('allows only the configured MCP server origin as a legacy verification audience', () => {
  const serverUrl = new URL('https://mcp.presscart.com/mcp');
  assert.deepEqual(
    resolveOAuthAudiences({ resource, serverUrl }).map(value => value.href),
    ['https://mcp.presscart.com/mcp'],
  );
  assert.deepEqual(
    resolveOAuthAudiences({
      resource,
      serverUrl,
      legacyAudience: new URL('https://mcp.presscart.com'),
    }).map(value => value.href),
    ['https://mcp.presscart.com/mcp', 'https://mcp.presscart.com/'],
  );

  for (const legacyAudience of [
    new URL('https://mcp.presscart.com/mcp'),
    new URL('https://mcp.presscart.com/legacy'),
    new URL('https://api.presscart.com'),
  ]) {
    assert.throws(
      () => resolveOAuthAudiences({ resource, serverUrl, legacyAudience }),
      /MCP_OAUTH_LEGACY_AUDIENCE must match the MCP server origin/,
    );
  }
});

test('builds facade and direct-Supabase metadata without mixing issuers', () => {
  assert.equal(createAuthorizationServerMetadata(facade).issuer, facadeIssuer);
  assert.deepEqual(createProtectedResourceMetadata({ resource, authorizationServer: facade, translatorEnabled: true }).authorization_servers, [facadeIssuer]);
  assert.deepEqual(createProtectedResourceMetadata({ resource, authorizationServer: upstream, translatorEnabled: false }).scopes_supported, ['openid', 'profile']);
});

test('accepts the exact official public Supabase DCR response and emits only portable fields', () => {
  const request = translateRegistrationRequest({
    redirect_uris: ['https://client.example/callback'],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: 'profile offline_access',
    client_name: 'Example client',
    client_uri: 'https://client.example',
    logo_uri: 'https://client.example/logo.png',
    contacts: ['ignored@example.com'],
  });
  assert.equal(request.upstream.scope, 'profile');
  const response = translateRegistrationResponse({
    request: request.facade,
    upstream: officialRegistrationResponse({
      clientName: 'Example client',
      clientUri: 'https://client.example',
      logoUri: 'https://client.example/logo.png',
    }),
  });
  assert.deepEqual(response, {
    client_id: publicClientId,
    redirect_uris: ['https://client.example/callback'],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    client_name: 'Example client',
    client_uri: 'https://client.example',
    logo_uri: 'https://client.example/logo.png',
    scope: 'profile offline_access',
  });
  assert.equal('contacts' in response, false);
});

test('defaults an omitted DCR grant_types field to authorization code plus refresh token', () => {
  const request = translateRegistrationRequest({
    redirect_uris: ['https://client.example/callback'],
    token_endpoint_auth_method: 'none',
  });

  assert.deepEqual(request.facade.grant_types, ['authorization_code', 'refresh_token']);
  assert.deepEqual(request.upstream.grant_types, ['authorization_code', 'refresh_token']);
});

test('rejects DCR grant_types that do not contain the exact supported pair', () => {
  for (const grantTypes of [
    ['authorization_code'],
    ['refresh_token'],
    ['authorization_code', 'refresh_token', 'authorization_code'],
  ]) {
    assert.throws(() => translateRegistrationRequest({
      redirect_uris: ['https://client.example/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: grantTypes,
    }), (error: unknown) => error instanceof OAuthProtocolError
      && error.code === 'invalid_request');
  }
});

test('mirrors Supabase DCR metadata bounds in UTF-8 bytes', () => {
  const tenRedirectUris = Array.from(
    { length: 10 },
    (_, index) => `https://client.example/callback/${index}`,
  );
  const clientNameAtLimit = 'é'.repeat(512);
  const uriPrefix = 'https://client.example/';
  const uriAtLimit = `${uriPrefix}${'é'.repeat(1_012)}x`;

  assert.equal(Buffer.byteLength(clientNameAtLimit, 'utf8'), 1_024);
  assert.equal(Buffer.byteLength(uriAtLimit, 'utf8'), 2_048);
  assert.doesNotThrow(() => translateRegistrationRequest({
    redirect_uris: tenRedirectUris,
    token_endpoint_auth_method: 'none',
    client_name: clientNameAtLimit,
    client_uri: uriAtLimit,
    logo_uri: uriAtLimit,
  }));

  for (const registration of [
    {
      redirect_uris: [...tenRedirectUris, 'https://client.example/callback/10'],
      client_name: clientNameAtLimit,
      client_uri: uriAtLimit,
      logo_uri: uriAtLimit,
    },
    {
      redirect_uris: tenRedirectUris,
      client_name: `${clientNameAtLimit}x`,
      client_uri: uriAtLimit,
      logo_uri: uriAtLimit,
    },
    {
      redirect_uris: tenRedirectUris,
      client_name: clientNameAtLimit,
      client_uri: `${uriAtLimit}x`,
      logo_uri: uriAtLimit,
    },
    {
      redirect_uris: tenRedirectUris,
      client_name: clientNameAtLimit,
      client_uri: uriAtLimit,
      logo_uri: `${uriAtLimit}x`,
    },
  ]) {
    assert.throws(() => translateRegistrationRequest({
      ...registration,
      token_endpoint_auth_method: 'none',
    }), (error: unknown) => error instanceof OAuthProtocolError
      && error.code === 'invalid_request');
  }
});

test('accepts HTTPS and loopback HTTP registration redirect URIs', () => {
  for (const redirectUri of [
    'https://client.example/callback',
    'http://localhost/callback',
    'http://127.0.0.42/callback',
    'http://[::1]/callback',
  ]) {
    const request = translateRegistrationRequest({
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
    });
    assert.deepEqual(request.facade.redirect_uris, [redirectUri]);
  }
});

test('rejects external HTTP, non-HTTP, credentialed, and fragment registration redirect URIs', () => {
  for (const redirectUri of [
    'http://client.example/callback',
    'http://localhost.attacker.example/callback',
    'http://127.0.0.1.attacker.example/callback',
    'ftp://client.example/callback',
    'javascript:alert(1)',
    'https://user:password@client.example/callback',
    'https://client.example/callback#fragment',
  ]) {
    assert.throws(() => translateRegistrationRequest({
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
    }), (error: unknown) => error instanceof OAuthProtocolError
      && error.code === 'invalid_request');
  }
});

test('rejects unsupported registration request fields without echoing their values', () => {
  const sentinel = 'credential-must-stay-private';
  assert.throws(() => translateRegistrationRequest({
    redirect_uris: ['https://client.example/callback'],
    scope: 'profile offline_access',
    registration_access_token: sentinel,
  }), (error: unknown) => error instanceof OAuthProtocolError
    && error.code === 'invalid_request'
    && !error.message.includes(sentinel));
});

test('requires returned registration metadata to match the accepted request', () => {
  const request = translateRegistrationRequest({
    redirect_uris: ['https://client.example/callback'],
    token_endpoint_auth_method: 'client_secret_post',
    grant_types: ['refresh_token', 'authorization_code'],
    response_types: ['code'],
  });
  const validUpstream = {
    ...officialRegistrationResponse({ tokenEndpointAuthMethod: 'client_secret_post' }),
    grant_types: ['refresh_token', 'authorization_code'],
  };
  assert.equal(translateRegistrationResponse({
    request: request.facade,
    upstream: validUpstream,
  }).client_id, confidentialClientId);

  for (const upstreamResponse of [
    { ...validUpstream, redirect_uris: ['https://client.example/other'] },
    { ...validUpstream, token_endpoint_auth_method: 'client_secret_basic' },
    { ...validUpstream, grant_types: ['authorization_code'] },
    { ...validUpstream, response_types: [] },
  ]) {
    assert.throws(() => translateRegistrationResponse({
      request: request.facade,
      upstream: upstreamResponse,
    }), (error: unknown) => error instanceof OAuthProtocolError
      && error.code === 'server_error'
      && error.status === 502);
  }
});

test('rejects incomplete or unknown registration response fields', () => {
  const request = translateRegistrationRequest({
    redirect_uris: ['https://client.example/callback'],
    token_endpoint_auth_method: 'none',
  });
  const validUpstream = officialRegistrationResponse();
  assert.equal(translateRegistrationResponse({
    request: request.facade,
    upstream: validUpstream,
  }).client_id, publicClientId);

  for (const upstreamResponse of [
    {
      ...validUpstream,
      client_type: undefined,
    },
    {
      ...validUpstream,
      client_secret_jwt_key: 'must-not-escape',
    },
  ]) {
    assert.throws(() => translateRegistrationResponse({
      request: request.facade,
      upstream: upstreamResponse,
    }), (error: unknown) => error instanceof OAuthProtocolError
      && error.code === 'server_error');
  }
});

test('rejects malformed official Supabase registration metadata', () => {
  const request = translateRegistrationRequest({
    redirect_uris: ['https://client.example/callback'],
    token_endpoint_auth_method: 'none',
    client_name: 'Example client',
    client_uri: 'https://client.example',
    logo_uri: 'https://client.example/logo.png',
  });
  const validUpstream = officialRegistrationResponse({
    clientName: 'Example client',
    clientUri: 'https://client.example',
    logoUri: 'https://client.example/logo.png',
  });

  for (const upstreamResponse of [
    { ...validUpstream, client_id: 'not-a-uuid' },
    { ...validUpstream, client_type: 'private' },
    { ...validUpstream, client_type: 'confidential' },
    { ...validUpstream, registration_type: 'manual' },
    { ...validUpstream, created_at: 'not-a-timestamp' },
    { ...validUpstream, updated_at: 1_752_739_200 },
    { ...validUpstream, scope: 'profile email' },
    { ...validUpstream, client_name: 'Different client' },
    { ...validUpstream, client_uri: 'https://other.example' },
    { ...validUpstream, logo_uri: 'https://other.example/logo.png' },
    { ...validUpstream, client_name: undefined },
    { ...validUpstream, client_uri: undefined },
    { ...validUpstream, logo_uri: undefined },
  ]) {
    assert.throws(() => translateRegistrationResponse({
      request: request.facade,
      upstream: upstreamResponse,
    }), (error: unknown) => error instanceof OAuthProtocolError
      && error.code === 'server_error'
      && error.status === 502);
  }
});

test('rejects optional client metadata returned when the accepted request omitted it', () => {
  const request = translateRegistrationRequest({
    redirect_uris: ['https://client.example/callback'],
    token_endpoint_auth_method: 'none',
  });
  const validUpstream = officialRegistrationResponse();

  for (const upstreamResponse of [
    { ...validUpstream, client_name: 'Unexpected client' },
    { ...validUpstream, client_uri: 'https://client.example' },
    { ...validUpstream, logo_uri: 'https://client.example/logo.png' },
  ]) {
    assert.throws(() => translateRegistrationResponse({
      request: request.facade,
      upstream: upstreamResponse,
    }), (error: unknown) => error instanceof OAuthProtocolError
      && error.code === 'server_error'
      && error.status === 502);
  }
});

test('rejects client secrets in public-client registration responses', () => {
  const request = translateRegistrationRequest({
    redirect_uris: ['https://client.example/callback'],
    token_endpoint_auth_method: 'none',
  });
  const base = officialRegistrationResponse();

  for (const upstreamResponse of [
    { ...base, client_secret: 'unexpected-secret' },
    { ...base, client_secret_expires_at: 0 },
    { ...base, client_secret: 'unexpected-secret', client_secret_expires_at: 1_800_000_000 },
  ]) {
    assert.throws(() => translateRegistrationResponse({
      request: request.facade,
      upstream: upstreamResponse,
    }), (error: unknown) => error instanceof OAuthProtocolError
      && error.code === 'server_error'
      && error.status === 502);
  }
});

test('requires a secret in confidential-client registration responses', () => {
  for (const tokenEndpointAuthMethod of ['client_secret_basic', 'client_secret_post'] as const) {
    const request = translateRegistrationRequest({
      redirect_uris: ['https://client.example/callback'],
      token_endpoint_auth_method: tokenEndpointAuthMethod,
    });
    const base = officialRegistrationResponse({ tokenEndpointAuthMethod });
    const { client_secret: _clientSecret, ...withoutSecret } = base;

    for (const upstreamResponse of [
      withoutSecret,
      { ...withoutSecret, client_secret: '' },
    ]) {
      assert.throws(() => translateRegistrationResponse({
        request: request.facade,
        upstream: upstreamResponse,
      }), (error: unknown) => error instanceof OAuthProtocolError
        && error.code === 'server_error'
        && error.status === 502);
    }
  }
});

test('accepts the exact official confidential Supabase DCR response for both secret methods', () => {
  for (const tokenEndpointAuthMethod of ['client_secret_basic', 'client_secret_post'] as const) {
    const request = translateRegistrationRequest({
      redirect_uris: ['https://client.example/callback'],
      token_endpoint_auth_method: tokenEndpointAuthMethod,
    });
    const response = translateRegistrationResponse({
      request: request.facade,
      upstream: officialRegistrationResponse({ tokenEndpointAuthMethod }),
    });

    assert.equal(response.client_id, confidentialClientId);
    assert.equal(response.token_endpoint_auth_method, tokenEndpointAuthMethod);
    assert.equal(response.client_secret, 'client-secret');
    assert.equal('client_type' in response, false);
    assert.equal('registration_type' in response, false);
    assert.equal('created_at' in response, false);
    assert.equal('updated_at' in response, false);
  }
});

test('normalizes a successful token response and preserves refresh rotation', () => {
  assert.deepEqual(translateTokenResponse({
    grantType: 'refresh_token',
    upstream: {
      access_token: 'access-next',
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: 'refresh-next',
      scope: 'profile',
    },
  }), {
    access_token: 'access-next',
    token_type: 'bearer',
    expires_in: 3600,
    refresh_token: 'refresh-next',
    scope: 'profile offline_access',
  });
});

test('rejects an authorization-code response without a refresh token', () => {
  assert.throws(() => translateTokenResponse({
    grantType: 'authorization_code',
    upstream: { access_token: 'access', token_type: 'bearer', expires_in: 3600, scope: 'profile' },
  }), (error: unknown) => error instanceof OAuthProtocolError && error.code === 'server_error');
});

test('rejects expanded scopes and non-OAuth token fields', () => {
  const base = {
    access_token: 'access',
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_token: 'refresh',
  };
  for (const upstreamResponse of [
    { ...base, scope: 'openid profile' },
    { ...base, scope: 'profile', id_token: 'must-not-escape' },
  ]) {
    assert.throws(() => translateTokenResponse({
      grantType: 'authorization_code',
      upstream: upstreamResponse,
    }), (error: unknown) => error instanceof OAuthProtocolError
      && error.code === 'server_error'
      && error.status === 502);
  }
});
