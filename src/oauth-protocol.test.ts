import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

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

const resource = new URL('https://mcp.presscart.com/mcp');
const facade = new URL('https://mcp.presscart.com');
const facadeIssuer = facade.href.replace(/\/$/, '');
const upstream = new URL('https://project.supabase.co/auth/v1');

describe('scope translation', () => {
  test('defaults an omitted scope to the full facade set', () => {
    assert.deepEqual(parseFacadeScope(undefined), { facade: 'profile offline_access', upstream: 'profile' });
  });
  test('accepts the two scopes in either order', () => {
    assert.equal(parseFacadeScope('offline_access profile').upstream, 'profile');
  });
  for (const value of ['profile', 'offline_access', 'profile email', '']) {
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

test('builds facade and direct-Supabase metadata without mixing issuers', () => {
  assert.equal(createAuthorizationServerMetadata(facade).issuer, facadeIssuer);
  assert.deepEqual(createProtectedResourceMetadata({ resource, authorizationServer: facade, translatorEnabled: true }).authorization_servers, [facadeIssuer]);
  assert.deepEqual(createProtectedResourceMetadata({ resource, authorizationServer: upstream, translatorEnabled: false }).scopes_supported, ['openid', 'profile']);
});

test('translates DCR scope upstream and strips registration management fields on return', () => {
  const request = translateRegistrationRequest({
    redirect_uris: ['https://client.example/callback'],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: 'profile offline_access',
    client_name: 'Example client',
  });
  assert.equal(request.upstream.scope, 'profile');
  const response = translateRegistrationResponse({
    request: request.facade,
    upstream: {
      ...request.upstream,
      client_id: 'client-1',
      scope: 'profile',
      registration_access_token: 'must-not-escape',
      registration_client_uri: 'https://project.supabase.co/auth/v1/oauth/clients/client-1',
    },
  });
  assert.equal(response.scope, 'profile offline_access');
  assert.equal('registration_access_token' in response, false);
  assert.equal('registration_client_uri' in response, false);
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
    redirect_uris: ['https://client.example/one', 'https://client.example/two'],
    token_endpoint_auth_method: 'client_secret_post',
    grant_types: ['refresh_token', 'authorization_code'],
    response_types: ['code'],
  });
  const validUpstream = {
    ...request.upstream,
    client_id: 'client-1',
    client_secret: 'client-secret',
  };
  assert.equal(translateRegistrationResponse({
    request: request.facade,
    upstream: validUpstream,
  }).client_id, 'client-1');

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
  const validUpstream = { ...request.upstream, client_id: 'client-1' };
  assert.equal(translateRegistrationResponse({
    request: request.facade,
    upstream: validUpstream,
  }).client_id, 'client-1');

  for (const upstreamResponse of [
    {
      redirect_uris: request.upstream.redirect_uris,
      client_id: 'client-1',
      scope: 'profile',
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

test('rejects client secrets in public-client registration responses', () => {
  const request = translateRegistrationRequest({
    redirect_uris: ['https://client.example/callback'],
    token_endpoint_auth_method: 'none',
  });
  const base = { ...request.upstream, client_id: 'client-1' };

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
    const base = { ...request.upstream, client_id: 'client-1' };

    for (const upstreamResponse of [
      base,
      { ...base, client_secret_expires_at: 0 },
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

test('accepts a confidential-client response with a non-empty secret', () => {
  const request = translateRegistrationRequest({
    redirect_uris: ['https://client.example/callback'],
    token_endpoint_auth_method: 'client_secret_basic',
  });
  const response = translateRegistrationResponse({
    request: request.facade,
    upstream: {
      ...request.upstream,
      client_id: 'client-1',
      client_secret: 'client-secret',
      client_secret_expires_at: 0,
    },
  });

  assert.equal(response.client_secret, 'client-secret');
  assert.equal(response.client_secret_expires_at, 0);
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
