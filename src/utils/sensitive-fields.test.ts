import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeSensitiveFields } from './sensitive-fields.js';

test('removes nested order payment and invoice fields from MCP responses', () => {
  const sanitized = sanitizeSensitiveFields({
    records: [
      {
        id: 'order-1',
        client_id: 'user-1',
        client_secret: 'pi_secret',
        guest_stripe_customer_id: 'cus_guest',
        customer_invoice_id: 'invoice-1',
        reference_number: 'ABC123',
        total: 3965.5,
        line_items: [
          {
            id: 'line-item-1',
            product_id: 'product-1',
            price: 2400,
            stripe_payment_intent_id: 'pi_123',
          },
        ],
      },
    ],
  });

  assert.deepEqual(sanitized, {
    records: [
      {
        id: 'order-1',
        client_id: 'user-1',
        reference_number: 'ABC123',
        total: 3965.5,
        line_items: [
          {
            id: 'line-item-1',
            product_id: 'product-1',
            price: 2400,
          },
        ],
      },
    ],
  });
});

test('does not remove normal product and user identifiers', () => {
  assert.deepEqual(
    sanitizeSensitiveFields({
      client_id: 'user-1',
      stripe_product_id: 'prod_123',
      product_id: 'product-1',
    }),
    {
      client_id: 'user-1',
      stripe_product_id: 'prod_123',
      product_id: 'product-1',
    }
  );
});
