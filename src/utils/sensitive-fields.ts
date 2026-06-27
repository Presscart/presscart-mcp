const exactSensitiveKeys = new Set([
  'client_secret',
  'payment_client_secret',
  'payment_intent_client_secret',
  'stripe_client_secret',
  'stripe_payment_intent_client_secret',
  'stripe_setup_intent_client_secret',
  'guest_stripe_customer_id',
  'stripe_customer_id',
  'stripe_payment_intent_id',
  'stripe_checkout_session_id',
  'stripe_session_id',
  'customer_invoice_id',
  'customer_invoice_source',
  'customer_invoice_url',
  'vendor_invoice_id',
  'vendor_invoice_url',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSensitiveKey(key: string) {
  const normalized = key.toLowerCase();
  return (
    exactSensitiveKeys.has(normalized) ||
    normalized.endsWith('_client_secret') ||
    normalized.includes('secret')
  );
}

export function sanitizeSensitiveFields(data: unknown): unknown {
  if (Array.isArray(data)) {
    return data.map((item) => sanitizeSensitiveFields(item));
  }

  if (!isRecord(data)) {
    return data;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (isSensitiveKey(key)) {
      continue;
    }

    sanitized[key] = sanitizeSensitiveFields(value);
  }

  return sanitized;
}
