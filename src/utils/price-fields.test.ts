import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizePriceFields } from './price-fields.js';

test('normalizes nested Presscart price fields for MCP responses', () => {
  const normalized = normalizePriceFields({
    records: [
      {
        id: 'product-1',
        prices: [
          {
            unit_amount: 1200,
            currency: 'usd',
            pricing_tier: 'basic',
          },
        ],
      },
    ],
  });

  assert.deepEqual(normalized, {
    records: [
      {
        id: 'product-1',
        prices: [
          {
            price: 1200,
            display_price: '$1,200.00',
            currency: 'USD',
            pricing_tier: 'basic',
          },
        ],
      },
    ],
  });
});

test('leaves non-price objects unchanged', () => {
  assert.deepEqual(normalizePriceFields({ id: 'x', unit_amount: 500 }), {
    id: 'x',
    unit_amount: 500,
  });
});
