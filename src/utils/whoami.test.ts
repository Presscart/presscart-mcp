import test from 'node:test';
import assert from 'node:assert/strict';

import { toWhoamiResponse } from './whoami.js';

test('returns public OAuth identity fields for get_user', () => {
  assert.deepEqual(
    toWhoamiResponse(
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
          first_name: 'Renz',
          last_name: 'Vallinas',
        },
      }
    ),
    {
      id: 'user-1',
      name: 'Renz Vallinas',
      email: 'renz@presscart.com',
    }
  );
});

test('falls back to email identity values when OAuth name claims are unavailable', () => {
  assert.deepEqual(
    toWhoamiResponse(
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
      id: 'user-1',
      name: 'renz@presscart.com',
      email: 'renz@presscart.com',
    }
  );
});

test('does not expose OAuth grant metadata in get_user', () => {
  const response = toWhoamiResponse(
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
  );

  assert.equal('source' in response, false);
  assert.equal('client_id' in response, false);
  assert.equal('grant_id' in response, false);
  assert.equal('scopes' in response, false);
  assert.equal('permissions' in response, false);
  assert.equal('permissions_count' in response, false);
  assert.equal('teams' in response, false);
});

test('returns legacy API-token session fields without scopes', () => {
  assert.deepEqual(
    toWhoamiResponse(
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
      team_id: 'team-1',
      token_type: 'api_token',
      pro_pricing_enabled: false,
    }
  );
});
