export type QueryParamValue = string | number | boolean;
export type QueryParams = Record<string, QueryParamValue>;
export type RangeFilter = { min?: number; max?: number };
export type QueryFilters = Record<
  string,
  QueryParamValue | QueryParamValue[] | RangeFilter | null | undefined
>;

/**
 * Flattens a `filters` object into Presscart-compatible query parameters.
 *
 * This mirrors the format parsed by `parseQueryFilters` in `presscart-backend`:
 * - scalar values become `filters[key]=value`
 * - array values become `filters[key][index]=value`
 * - nested objects become `filters[key][subkey]=value`
 *
 * Null and undefined values are ignored.
 */
export function appendQueryFilters(query: QueryParams, filters?: QueryFilters): QueryParams {
  if (!filters) return query;

  const nextQuery: QueryParams = { ...query };

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        nextQuery[`filters[${key}][${index}]`] = item;
      });
      continue;
    }

    // Handle nested objects (e.g. { min: 100, max: 500 } → filters[key][min]=100&filters[key][max]=500)
    if (typeof value === 'object') {
      for (const [subKey, subValue] of Object.entries(value)) {
        if (subValue === undefined || subValue === null) continue;
        nextQuery[`filters[${key}][${subKey}]`] = subValue;
      }
      continue;
    }

    nextQuery[`filters[${key}]`] = value;
  }

  return nextQuery;
}
