import test from 'node:test';
import assert from 'node:assert/strict';

import { toTeamDetailsResponse } from './team-details.js';

test('returns only public team detail fields', () => {
  assert.deepEqual(
    toTeamDetailsResponse({
      id: 'team-1',
      slug: 'raintech',
      name: 'RainTech',
      type: 'AGENCY',
      billing_email: 'billing@example.com',
      contact_email: 'contact@example.com',
      user_id: 'user-1',
      is_publisher: true,
      pro_pricing_enabled: true,
    }),
    {
      name: 'RainTech',
      type: 'AGENCY',
      billing_email: 'billing@example.com',
      contact_email: 'contact@example.com',
    }
  );
});
