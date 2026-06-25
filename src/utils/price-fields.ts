export function normalizePriceFields(data: unknown): unknown {
  if (Array.isArray(data)) {
    return data.map(item => normalizePriceFields(item));
  }

  if (!isRecord(data)) return data;

  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (key === 'prices' && Array.isArray(value)) {
      const prices = normalizePrices(value);
      normalized[key] = prices;

      const defaultPrice = prices.find(isDefaultPrice);
      if (defaultPrice && normalized.default_price === undefined) {
        normalized.default_price = defaultPrice;
      }

      continue;
    }

    normalized[key] = normalizePriceFields(value);
  }

  return normalized;
}

function normalizePrices(values: unknown[]) {
  const prices = values.map(normalizePrice);
  const defaultIndex = findDefaultPriceIndex(prices);

  if (defaultIndex === -1) return prices;

  return prices
    .map((price, index) => addDefaultPriceFlag(price, index === defaultIndex))
    .sort((left, right) => Number(isDefaultPrice(right)) - Number(isDefaultPrice(left)));
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

function findDefaultPriceIndex(prices: unknown[]) {
  const proIndex = prices.findIndex(price => isPricingTier(price, 'pro'));
  if (proIndex !== -1) return proIndex;

  const basicIndex = prices.findIndex(price => isPricingTier(price, 'basic'));
  if (basicIndex !== -1) return basicIndex;

  return prices.findIndex(isRecord);
}

function addDefaultPriceFlag(price: unknown, isDefault: boolean) {
  if (!isRecord(price)) return price;

  return {
    ...price,
    is_default_price: isDefault,
  };
}

function isDefaultPrice(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.is_default_price === true;
}

function isPricingTier(value: unknown, tier: string) {
  return isRecord(value) && value.pricing_tier === tier;
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
