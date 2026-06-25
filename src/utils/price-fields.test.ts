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
            is_default_price: true,
          },
        ],
        default_price: {
          price: 1200,
          display_price: '$1,200.00',
          currency: 'USD',
          pricing_tier: 'basic',
          is_default_price: true,
        },
      },
    ],
  });
});

test('uses pro pricing as the default price when present', () => {
  const normalized = normalizePriceFields({
    id: 'product-1',
    prices: [
      {
        unit_amount: 1200,
        currency: 'usd',
        pricing_tier: 'basic',
      },
      {
        unit_amount: 900,
        currency: 'usd',
        pricing_tier: 'pro',
      },
    ],
  });

  assert.deepEqual(normalized, {
    id: 'product-1',
    prices: [
      {
        price: 900,
        display_price: '$900.00',
        currency: 'USD',
        pricing_tier: 'pro',
        is_default_price: true,
      },
      {
        price: 1200,
        display_price: '$1,200.00',
        currency: 'USD',
        pricing_tier: 'basic',
        is_default_price: false,
      },
    ],
    default_price: {
      price: 900,
      display_price: '$900.00',
      currency: 'USD',
      pricing_tier: 'pro',
      is_default_price: true,
    },
  });
});

test('normalizes single product price arrays for get_product responses', () => {
  const normalized = normalizePriceFields({
    id: 'product-1',
    name: 'Example Product',
    prices: [
      {
        id: 'price-1',
        unit_amount: 1700,
        internal_cost: 850,
        pricing_tier: 'basic',
      },
    ],
  });

  assert.deepEqual(normalized, {
    id: 'product-1',
    name: 'Example Product',
    prices: [
      {
        price: 1700,
        display_price: '$1,700.00',
        id: 'price-1',
        internal_cost: 850,
        pricing_tier: 'basic',
        is_default_price: true,
      },
    ],
    default_price: {
      price: 1700,
      display_price: '$1,700.00',
      id: 'price-1',
      internal_cost: 850,
      pricing_tier: 'basic',
      is_default_price: true,
    },
  });
});

test('leaves non-price objects unchanged', () => {
  assert.deepEqual(normalizePriceFields({ id: 'x', unit_amount: 500 }), {
    id: 'x',
    unit_amount: 500,
  });
});
