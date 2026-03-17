export type QueryParamValue = string | number | boolean;
export type QueryParams = Record<string, QueryParamValue>;
export type QueryFilters = Record<string, QueryParamValue | QueryParamValue[] | null | undefined>;

/**
 * Flattens a `filters` object into Presscart-compatible query parameters.
 *
 * This mirrors the format parsed by `parseQueryFilters` in `presscart-backend`:
 * - scalar values become `filters[key]=value`
 * - array values become `filters[key][index]=value`
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

    nextQuery[`filters[${key}]`] = value;
  }

  return nextQuery;
}
