import assert from 'node:assert/strict';
import test from 'node:test';

process.env.PRESSCART_API_URL = 'https://api.presscart.test';

const { registerOrderTools } = await import('./orders.js');

const ids = {
  orderId: '0f9f6c55-4f8c-4c55-9a0a-3a7c1b2d4e5f',
  profileId: '6b2f4eb8-46db-4ef2-9c44-46b94a7049c7',
  productId: '9d1e2f3a-4b5c-4d6e-8f70-819203a4b5c6',
};

const checkoutLink = 'https://app.presscart.com/orders/checkout/ABC123';

function apiOrder() {
  return {
    id: ids.orderId,
    profile_id: ids.profileId,
    client_id: 'user-1',
    team_id: 'team-1',
    total: 3965.5,
    subtotal: 3800,
    processing_fee: 165.5,
    discount: 0,
    credits_applied: 0,
    status: 'pending',
    reference_number: 'ABC123',
    payment_status: 'requires_payment_method',
    client_secret: 'pi_placeholder_secret_placeholder',
    payment_intent_id: 'pi_placeholder',
    checkout_session_id: 'cs_placeholder',
    guest_stripe_customer_id: 'cus_placeholder',
    guest_email: 'guest@example.com',
    customer_invoice_url: 'https://invoice.example.com/placeholder',
    email: 'billing@example.com',
    checkout_link: checkoutLink,
    line_items: [
      {
        id: 'line-item-1',
        product_id: ids.productId,
        quantity: 1,
        price: 3800,
        stripe_product_id: 'prod_placeholder',
        stripe_price_id: 'price_placeholder',
      },
    ],
  };
}

test('get_order returns order amounts without payment, Stripe, invoice or email fields', async () => {
  const calls: Array<{ url: string; method?: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    calls.push({ url: String(input), method: init?.method });
    return jsonResponse(apiOrder());
  }) as typeof fetch;

  try {
    const result = await registerTools()
      .get('get_order')
      ?.handler({ team_slug: 'raintech', order_id: ids.orderId }, apiTokenExtra());

    assert.equal(calls[0]?.method, 'GET');
    assert.equal(new URL(calls[0].url).pathname, `/teams/raintech/orders/${ids.orderId}`);

    const order = toolOutput(result);
    for (const key of [
      'checkout_link',
      'payment_intent_id',
      'stripe_price_id',
      'guest_email',
      'customer_invoice_url',
    ]) {
      assert.equal(collectKeys(order).has(key), false, `${key} should not reach the AI client`);
    }
    assert.equal(order.total, 3965.5);
    assert.equal(order.reference_number, 'ABC123');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('create_order keeps the checkout link but removes payment secrets and Stripe ids', async () => {
  const calls: Array<{ url: string; method?: string; body?: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    return jsonResponse(apiOrder());
  }) as typeof fetch;

  try {
    const result = await registerTools()
      .get('create_order')
      ?.handler(
        {
          team_slug: 'raintech',
          profile_id: ids.profileId,
          line_items: [{ product_id: ids.productId, quantity: 1, is_add_on: false }],
        },
        apiTokenExtra()
      );

    assert.equal(calls[0]?.method, 'POST');
    assert.equal(new URL(calls[0].url).pathname, '/teams/raintech/orders/checkout');
    assert.match(calls[0].body ?? '', new RegExp(ids.productId));

    const order = toolOutput(result);
    assert.equal(order.checkout_link, checkoutLink);
    for (const key of ['payment_intent_id', 'client_secret', 'guest_stripe_customer_id']) {
      assert.equal(collectKeys(order).has(key), false, `${key} should not reach the AI client`);
    }
    assert.equal(order.total, 3965.5);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const pagination = { total_records: 1, total_pages: 1, current_page: 1, next_page: null };

test('list_profile_orders returns orders and pagination without payment, Stripe, invoice or email fields', async () => {
  const calls: Array<{ url: string; method?: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    calls.push({ url: String(input), method: init?.method });
    return jsonResponse({
      records: [
        {
          ...apiOrder(),
          customer_invoice_id: 'in_placeholder',
          posthog_distinct_id: 'posthog_placeholder',
          metadata: { source: 'placeholder' },
          team: {
            id: 'team-1',
            name: 'Raintech',
            contact_email: 'team@example.com',
            account_owner_email: 'owner@example.com',
          },
        },
      ],
      ...pagination,
    });
  }) as typeof fetch;

  try {
    const result = await registerTools()
      .get('list_profile_orders')
      ?.handler(
        {
          team_slug: 'raintech',
          profile_id: ids.profileId,
          limit: 10,
          page: 1,
          paid_orders_only: true,
        },
        apiTokenExtra()
      );

    assert.equal(calls[0]?.method, 'GET');
    const url = new URL(calls[0].url);
    assert.equal(url.pathname, `/teams/raintech/profiles/${ids.profileId}/orders`);
    assert.equal(url.searchParams.get('limit'), '10');
    assert.equal(url.searchParams.get('page'), '1');
    assert.equal(url.searchParams.get('paid_orders_only'), 'true');

    const output = toolOutput(result);
    const keys = collectKeys(output);
    for (const key of [
      'checkout_link',
      'client_secret',
      'payment_intent_id',
      'checkout_session_id',
      'guest_stripe_customer_id',
      'guest_email',
      'email',
      'customer_invoice_id',
      'customer_invoice_url',
      'posthog_distinct_id',
      'metadata',
      'stripe_product_id',
      'stripe_price_id',
      'contact_email',
      'account_owner_email',
    ]) {
      assert.equal(keys.has(key), false, `${key} should not reach the AI client`);
    }

    assert.deepEqual(
      {
        total_records: output.total_records,
        total_pages: output.total_pages,
        current_page: output.current_page,
        next_page: output.next_page,
      },
      pagination
    );
    assert.ok(Array.isArray(output.records));
    const [order] = output.records;
    assert.ok(isRecord(order));
    assert.equal(order.total, 3965.5);
    assert.equal(order.subtotal, 3800);
    assert.equal(order.reference_number, 'ABC123');
    assert.equal(order.payment_status, 'requires_payment_method');
    assert.deepEqual(order.team, { id: 'team-1', name: 'Raintech' });
    assert.deepEqual(order.line_items, [
      { id: 'line-item-1', product_id: ids.productId, quantity: 1, price: 3800 },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('list_order_items keeps publisher cost fields but drops guest emails, vendor invoices and Stripe ids', async () => {
  const calls: Array<{ url: string; method?: string }> = [];
  const originalFetch = globalThis.fetch;
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
  globalThis.fetch = (async (input, init) => {
    calls.push({ url: String(input), method: init?.method });
    return jsonResponse({
      records: [
        {
          ...publisherFields,
          guest_email: 'guest@example.com',
          vendor_invoice_id: 'vendor-invoice-1',
          vendor_invoice_url: 'https://invoice.example.com/vendor',
          vendor_invoice_date: '2026-01-01T00:00:00.000Z',
          line_item: {
            id: 'line-item-1',
            product_id: ids.productId,
            price: 2400,
            stripe_product_id: 'prod_placeholder',
            stripe_price_id: 'price_placeholder',
          },
          team: { id: 'team-1', name: 'Raintech', contact_email: 'team@example.com' },
        },
      ],
      ...pagination,
    });
  }) as typeof fetch;

  try {
    const result = await registerTools()
      .get('list_order_items')
      ?.handler({ team_slug: 'raintech', limit: 25, page: 2, search: 'music' }, apiTokenExtra());

    assert.equal(calls[0]?.method, 'GET');
    const url = new URL(calls[0].url);
    assert.equal(url.pathname, '/teams/raintech/order-items');
    assert.equal(url.searchParams.get('limit'), '25');
    assert.equal(url.searchParams.get('page'), '2');
    assert.equal(url.searchParams.get('search'), 'music');
    assert.equal(url.searchParams.has('team_slug'), false);

    const output = toolOutput(result);
    const keys = collectKeys(output);
    for (const key of [
      'guest_email',
      'vendor_invoice_id',
      'vendor_invoice_url',
      'vendor_invoice_date',
      'stripe_product_id',
      'stripe_price_id',
      'contact_email',
    ]) {
      assert.equal(keys.has(key), false, `${key} should not reach the AI client`);
    }

    assert.deepEqual(output, {
      records: [
        {
          ...publisherFields,
          line_item: { id: 'line-item-1', product_id: ids.productId, price: 2400 },
          team: { id: 'team-1', name: 'Raintech' },
        },
      ],
      ...pagination,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
};

type RegisteredTool = {
  handler: (input: Record<string, unknown>, extra: unknown) => Promise<ToolResult>;
};

function registerTools() {
  const tools = new Map<string, RegisteredTool>();

  registerOrderTools(
    {
      registerTool(name: string, _config: unknown, handler: RegisteredTool['handler']) {
        tools.set(name, { handler });
      },
    } as never,
    {}
  );

  return tools;
}

function apiTokenExtra() {
  return {
    authInfo: {
      token: 'api-token-placeholder',
      extra: { source: 'api_token', presscart_api_token: 'api-token-placeholder' },
    },
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function toolOutput(result: ToolResult | undefined): Record<string, unknown> {
  assert.ok(result, 'tool handler should return a result');
  const parsed: unknown = JSON.parse(result.content[0]?.text ?? 'null');
  assert.deepEqual(result.structuredContent, parsed);
  assert.ok(isRecord(parsed), 'tool output should be a JSON object');
  return parsed;
}

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
  } else if (isRecord(value)) {
    for (const [key, nested] of Object.entries(value)) {
      keys.add(key);
      collectKeys(nested, keys);
    }
  }
  return keys;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
