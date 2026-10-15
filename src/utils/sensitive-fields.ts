export type SanitizeSensitiveFieldsOptions = {
  /** create_order keeps checkout_link: it is how the buyer pays for the order just created. */
  keepCheckoutLink?: boolean;
};

const exactSensitiveKeys = new Set([
  'checkout_link',
  'checkout_session_id',
  'metadata',
  'posthog_distinct_id',
  'charge_id',
  'receipt_url',
]);

const sensitiveSubstrings = [
  'secret',
  'stripe',
  'payment_intent',
  'setup_intent',
  'payment_method',
];

const sensitiveTokenPatterns = [/(^|_)customer(_|$)/, /(^|_)invoices?(_|$)/, /(^|_)emails?(_|$)/];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** paymentIntentId, PaymentIntentID and payment-intent-id all become payment_intent_id. */
function toSnakeCase(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toLowerCase();
}

function isSensitiveKey(key: string, options: SanitizeSensitiveFieldsOptions) {
  const normalized = toSnakeCase(key);
  if (options.keepCheckoutLink && normalized === 'checkout_link') {
    return false;
  }

  return (
    exactSensitiveKeys.has(normalized) ||
    sensitiveSubstrings.some((substring) => normalized.includes(substring)) ||
    sensitiveTokenPatterns.some((pattern) => pattern.test(normalized))
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
