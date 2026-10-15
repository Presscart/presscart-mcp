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

test('keeps product and user identifiers while removing Stripe product ids', () => {
  assert.deepEqual(
    sanitizeSensitiveFields({
      client_id: 'user-1',
      stripe_product_id: 'prod_placeholder',
      product_id: 'product-1',
    }),
    {
      client_id: 'user-1',
      product_id: 'product-1',
    }
  );
});

const publicOrderFields = {
  id: 'order-1',
  profile_id: 'profile-1',
  client_id: 'user-1',
  checkout_by_id: 'user-2',
  team_id: 'team-1',
  total: 3965.5,
  subtotal: 3800,
  processing_fee: 165.5,
  discount: 0,
  credits_applied: 0,
  coupon: null,
  date_paid: null,
  status: 'pending',
  reference_number: 'ABC123',
  external_reference_number: 'EXT-1',
  is_guest_order: false,
  payment_status: 'requires_payment_method',
  payment_expires_at: '2026-01-02T00:00:00.000Z',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  deleted_at: null,
  name: 'Ada Lovelace',
};

const sensitiveOrderFields = {
  client_secret: 'pi_placeholder_secret_placeholder',
  customer_invoice_id: 'in_placeholder',
  customer_invoice_source: 'stripe',
  customer_invoice_date: '2026-01-01T00:00:00.000Z',
  customer_invoice_url: 'https://invoice.example.com/placeholder',
  guest_email: 'guest@example.com',
  account_owner_email: 'owner@example.com',
  guest_stripe_customer_id: 'cus_placeholder',
  checkout_session_id: 'cs_placeholder',
  payment_intent_id: 'pi_placeholder',
  posthog_distinct_id: 'posthog_placeholder',
  metadata: { source: 'placeholder' },
  email: 'billing@example.com',
  checkout_link: 'https://app.presscart.com/orders/checkout/ABC123',
};

const publicLineItemFields = {
  id: 'line-item-1',
  order_id: 'order-1',
  product_id: 'product-1',
  quantity: 1,
  price: 2400,
  is_add_on: false,
  linked_order_line_item_id: null,
  source: 'marketplace',
  niche_snapshot: { niche: 'music', price: 2400 },
  name: 'Digital Music News',
  product_type_name: 'Article',
  type_id: 'type-1',
  pending_units: 1,
  outlet: {
    id: 'outlet-1',
    name: 'Digital Music News',
    logo: 'https://cdn.example.com/logo.png',
    website_url: 'https://publisher.example',
  },
  order_items: [{ id: 'order-item-1', status: 'pending' }],
  includes: [],
  created_at: '2026-01-01T00:00:00.000Z',
};

const sensitiveLineItemFields = {
  stripe_product_id: 'prod_placeholder',
  stripe_price_id: 'price_placeholder',
};

function apiOrder() {
  return {
    ...publicOrderFields,
    ...sensitiveOrderFields,
    team: { name: 'Raintech', contact_email: 'team@example.com' },
    line_items: [{ ...publicLineItemFields, ...sensitiveLineItemFields }],
  };
}

test('removes the payment, Stripe, invoice, email and analytics fields the order API sends', () => {
  assert.deepEqual(sanitizeSensitiveFields(apiOrder()), {
    ...publicOrderFields,
    team: { name: 'Raintech' },
    line_items: [publicLineItemFields],
  });
});

test('removes Stripe, customer_ and email fields by name pattern at any depth', () => {
  assert.deepEqual(
    sanitizeSensitiveFields({
      id: 'order-1',
      stripe_subscription_id: 'sub_placeholder',
      STRIPE_SESSION_ID: 'cs_placeholder',
      customer_portal_url: 'https://billing.example.com/placeholder',
      vendor_invoice_id: 'vendor-invoice-1',
      vendor_invoice_url: 'https://invoice.example.com/vendor',
      emails: ['user@example.com'],
      nested: [
        {
          id: 'nested-1',
          billing_email: 'billing@example.com',
          notification_emails: ['user@example.com'],
          Guest_Email: 'guest@example.com',
        },
      ],
    }),
    {
      id: 'order-1',
      nested: [{ id: 'nested-1' }],
    }
  );
});

test('removes checkout_link by default and keeps it only when keepCheckoutLink is set', () => {
  const order = {
    reference_number: 'ABC123',
    total: 3965.5,
    checkout_link: 'https://app.presscart.com/orders/checkout/ABC123',
    client_secret: 'pi_placeholder_secret_placeholder',
    payment_intent_id: 'pi_placeholder',
    guest_stripe_customer_id: 'cus_placeholder',
    guest_email: 'guest@example.com',
  };

  assert.deepEqual(sanitizeSensitiveFields(order), {
    reference_number: 'ABC123',
    total: 3965.5,
  });

  assert.deepEqual(sanitizeSensitiveFields(order, { keepCheckoutLink: true }), {
    reference_number: 'ABC123',
    total: 3965.5,
    checkout_link: 'https://app.presscart.com/orders/checkout/ABC123',
  });
});

test('keeps publisher business fields on order items while removing guest emails', () => {
  const publisherFields = {
    id: 'order-item-1',
    order_line_item_id: 'line-item-1',
    status: 'pending',
    price: 2400,
    quantity: 1,
    internal_cost: 1200,
    vendor_cost: 1000,
    commission_amount: 240,
    reseller_price: 2000,
  };

  assert.deepEqual(
    sanitizeSensitiveFields({
      total_records: 1,
      records: [{ ...publisherFields, guest_email: 'guest@example.com' }],
    }),
    {
      total_records: 1,
      records: [publisherFields],
    }
  );
});

test('removes camelCase and PascalCase variants of sensitive keys', () => {
  assert.deepEqual(
    sanitizeSensitiveFields({
      id: 'order-1',
      paymentIntentId: 'pi_placeholder',
      clientSecret: 'pi_placeholder_secret_placeholder',
      checkoutSessionId: 'cs_placeholder',
      checkoutLink: 'https://app.presscart.com/orders/checkout/ABC123',
      stripeCustomerId: 'cus_placeholder',
      customerInvoiceUrl: 'https://invoice.example.com/placeholder',
      guestEmail: 'guest@example.com',
      posthogDistinctId: 'posthog_placeholder',
      PaymentMethodId: 'pm_placeholder',
      SetupIntentId: 'seti_placeholder',
      paymentStatus: 'requires_payment_method',
      referenceNumber: 'ABC123',
    }),
    {
      id: 'order-1',
      paymentStatus: 'requires_payment_method',
      referenceNumber: 'ABC123',
    }
  );
});

test('removes kebab-case variants of sensitive keys', () => {
  assert.deepEqual(
    sanitizeSensitiveFields({
      id: 'order-1',
      'guest-email': 'guest@example.com',
      'payment-intent-id': 'pi_placeholder',
      'customer-invoice-url': 'https://invoice.example.com/placeholder',
      'checkout-link': 'https://app.presscart.com/orders/checkout/ABC123',
      'checkout-session-id': 'cs_placeholder',
      'reference-number': 'ABC123',
    }),
    {
      id: 'order-1',
      'reference-number': 'ABC123',
    }
  );
});

test('removes invoice, customer, email, payment intent/method and charge fields by token', () => {
  assert.deepEqual(
    sanitizeSensitiveFields({
      id: 'order-1',
      hosted_invoice_url: 'https://invoice.example.com/hosted',
      invoice_pdf: 'https://invoice.example.com/pdf',
      vendor_invoice_date: '2026-01-01T00:00:00.000Z',
      invoice_customer_id: 'cus_placeholder',
      customer_id: 'cus_placeholder',
      email_address: 'billing@example.com',
      contact_email: 'team@example.com',
      payment_intent: 'pi_placeholder',
      payment_method: 'pm_placeholder',
      payment_method_id: 'pm_placeholder',
      setup_intent_id: 'seti_placeholder',
      setup_intent_client_secret: 'seti_placeholder_secret_placeholder',
      charge_id: 'ch_placeholder',
      receipt_url: 'https://receipt.example.com/placeholder',
      payment_status: 'paid',
    }),
    {
      id: 'order-1',
      payment_status: 'paid',
    }
  );
});

test('keeps order amounts, statuses, identifiers and publisher business fields', () => {
  const keptFields = {
    id: 'order-1',
    client_id: 'user-1',
    product_id: 'product-1',
    team_id: 'team-1',
    profile_id: 'profile-1',
    checkout_by_id: 'user-2',
    total: 3965.5,
    subtotal: 3800,
    discount: 0,
    processing_fee: 165.5,
    credits_applied: 0,
    coupon: null,
    price: 2400,
    niche_snapshot: { niche: 'music', price_cents: 240000 },
    payment_status: 'requires_payment_method',
    payment_expires_at: '2026-01-02T00:00:00.000Z',
    status: 'pending',
    date_paid: null,
    reference_number: 'ABC123',
    external_reference_number: 'EXT-1',
    is_guest_order: false,
    name: 'Digital Music News',
    quantity: 1,
    outlet: { id: 'outlet-1', name: 'Digital Music News' },
    internal_cost: 1200,
    vendor_cost: 1000,
    commission_amount: 240,
    reseller_price: 2000,
  };

  assert.deepEqual(sanitizeSensitiveFields(keptFields), keptFields);
});
