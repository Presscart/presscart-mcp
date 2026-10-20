import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.PRESSCART_API_URL = 'https://api.presscart.test';

const { readAccountNameFromTeams } = await import('./account-name.js');

function teamsWithMembership(membership: unknown) {
  return { records: [{ id: 'team-1', name: 'Acme Media', membership }] };
}

test('reads the first and last name from the caller membership only', () => {
  const name = readAccountNameFromTeams(
    teamsWithMembership({
      first_name: ' Grace ',
      last_name: 'Hopper',
      email: 'grace@example.com',
      phone: '+1-555-0100',
    })
  );

  assert.equal(name, 'Grace Hopper');
});

test('uses whichever name part is on file', () => {
  assert.equal(readAccountNameFromTeams(teamsWithMembership({ first_name: 'Grace', last_name: '' })), 'Grace');
  assert.equal(readAccountNameFromTeams(teamsWithMembership({ first_name: null, last_name: 'Hopper' })), 'Hopper');
});

test('returns null when the response carries no name', () => {
  for (const response of [
    teamsWithMembership({ first_name: '', last_name: '  ' }),
    teamsWithMembership({ first_name: 1, last_name: false }),
    teamsWithMembership(null),
    { records: [{ id: 'team-1' }] },
    { records: [] },
    { records: 'not-an-array' },
    null,
    'Grace Hopper',
  ]) {
    assert.equal(readAccountNameFromTeams(response), null, JSON.stringify(response));
  }
});
