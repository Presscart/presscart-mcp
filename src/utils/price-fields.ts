export function normalizePriceFields(data: unknown): unknown {
  if (Array.isArray(data)) {
    return data.map(item => normalizePriceFields(item));
  }

  if (!isRecord(data)) return data;

  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (key === 'prices' && Array.isArray(value)) {
      normalized[key] = value.map(normalizePrice);
      continue;
    }

    normalized[key] = normalizePriceFields(value);
  }

  return normalized;
}

function normalizePrice(value: unknown): unknown {
  if (!isRecord(value)) return value;

  const { unit_amount: unitAmount, currency, ...rest } = value;
  const normalized: Record<string, unknown> = {};

  if (typeof unitAmount === 'number') {
    normalized.price = unitAmount;
    normalized.display_price = formatDisplayPrice(unitAmount, currency);
  }

  if (currency !== undefined) {
    normalized.currency = typeof currency === 'string' ? currency.toUpperCase() : currency;
  }

  return { ...normalized, ...rest };
}

function formatDisplayPrice(price: number, currency: unknown) {
  const currencyCode = typeof currency === 'string' && currency.length > 0 ? currency : 'USD';

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode.toUpperCase(),
    }).format(price);
  } catch {
    return `${price} ${currencyCode.toUpperCase()}`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
