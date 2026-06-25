import test from 'node:test';
import assert from 'node:assert/strict';

process.env.PRESSCART_API_URL ??= 'https://api.presscart.test';

const { requirePermission, requireTeamId, resolveProfileId } = await import('./tool-context.js');

test('requires OAuth permissions when the session comes from an OAuth grant', () => {
  assert.doesNotThrow(() =>
    requirePermission(
      {
        authInfo: {
          token: 'oauth-access-token',
          extra: {
            source: 'oauth',
            permissions: ['orders.read'],
          },
        },
      },
      {},
      'orders.read'
    )
  );

  assert.throws(
    () =>
      requirePermission(
        {
          authInfo: {
            token: 'oauth-access-token',
            extra: {
              source: 'oauth',
              permissions: ['orders.read'],
            },
          },
        },
        {},
        'orders.create'
      ),
    /OAuth grant is missing required permission: orders\.create/
  );
});

test('leaves legacy API-token sessions to the upstream API authorization checks', () => {
  assert.doesNotThrow(() =>
    requirePermission(
      {
        authInfo: {
          token: 'legacy-api-token',
          extra: {
            source: 'api_token',
          },
        },
      },
      {},
      'orders.create'
    )
  );
});

test('resolves team_id from the bound session when present', () => {
  assert.equal(
    requireTeamId(
      {
        authInfo: {
          token: 'token',
          extra: {
            team_id: 'team-1',
          },
        },
      },
      {}
    ),
    'team-1'
  );
});

test('requires explicit profile_id for profile-scoped workflows', () => {
  assert.equal(
    resolveProfileId('8a42709c-dcdf-4a07-9d92-f3da9f82a902'),
    '8a42709c-dcdf-4a07-9d92-f3da9f82a902'
  );

  assert.throws(
    () => resolveProfileId(undefined),
    /profile_id is required\. Call list_teams, then list_profiles/
  );
});
