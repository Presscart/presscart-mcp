import test from 'node:test';
import assert from 'node:assert/strict';

import { includeOAuthSessionClaims } from './session-claims.js';

test('adds OAuth token claims to auth_whoami response', () => {
  assert.deepEqual(
    includeOAuthSessionClaims(
      {
        source: 'oauth',
        oauth_client_id: 'client-1',
        oauth_grant_id: 'grant-1',
        scopes: ['outlets.lists'],
      },
      {
        token: 'token',
        extra: {
          email: 'renz@presscart.com',
          sub: 'user-1',
        },
      }
    ),
    {
      source: 'oauth',
      oauth_client_id: 'client-1',
      oauth_grant_id: 'grant-1',
      scopes: ['outlets.lists'],
      email: 'renz@presscart.com',
      sub: 'user-1',
    }
  );
});

test('does not add OAuth-only claims to API-token sessions', () => {
  assert.deepEqual(
    includeOAuthSessionClaims(
      {
        source: 'api_token',
        team_id: 'team-1',
        token_type: 'api_token',
        scopes: ['outlets.lists'],
        pro_pricing_enabled: false,
      },
      {
        token: 'token',
        extra: {
          email: 'renz@presscart.com',
        },
      }
    ),
    {
      source: 'api_token',
      team_id: 'team-1',
      token_type: 'api_token',
      scopes: ['outlets.lists'],
      pro_pricing_enabled: false,
    }
  );
});
