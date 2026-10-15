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
