export type SanitizeSensitiveFieldsOptions = {
  /** create_order keeps checkout_link: it is how the buyer pays for the order just created. */
  keepCheckoutLink?: boolean;
};

const exactSensitiveKeys = new Set([
  'checkout_link',
  'checkout_session_id',
  'metadata',
  'payment_intent_id',
  'posthog_distinct_id',
  'vendor_invoice_id',
  'vendor_invoice_url',
]);

const emailKeyPattern = /(^|_)emails?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSensitiveKey(key: string, options: SanitizeSensitiveFieldsOptions) {
  const normalized = key.toLowerCase();
  if (options.keepCheckoutLink && normalized === 'checkout_link') {
    return false;
  }

  return (
    exactSensitiveKeys.has(normalized) ||
    normalized.endsWith('_client_secret') ||
    normalized.includes('secret') ||
    normalized.includes('stripe') ||
    normalized.startsWith('customer_') ||
    emailKeyPattern.test(normalized)
  );
}

export function sanitizeSensitiveFields(
  data: unknown,
  options: SanitizeSensitiveFieldsOptions = {}
): unknown {
  if (Array.isArray(data)) {
    return data.map((item) => sanitizeSensitiveFields(item, options));
  }

  if (!isRecord(data)) {
    return data;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (isSensitiveKey(key, options)) {
      continue;
    }

    sanitized[key] = sanitizeSensitiveFields(value, options);
  }

  return sanitized;
}
