import test from 'node:test';
import assert from 'node:assert/strict';

import { teamBySlugRoute, teamRoute } from './team-routes.js';

test('builds encoded team-scoped route paths', () => {
  assert.equal(teamRoute('team one', '/orders'), '/teams/team%20one/orders');
  assert.equal(teamBySlugRoute('team one'), '/teams/slug/team%20one');
});
