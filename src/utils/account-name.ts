import { PresscartApiError } from '../api.js';
import { appendQueryFilters } from './query-filters.js';
import { createPresscartApiClient, type ServerOptions, type ToolExtraLike } from './tool-context.js';

// Presscart keeps names on its users table, and OAuth token claims often carry none.
// GET /teams already serves MCP grants (teams.lists); include_membership adds the caller's own
// membership row with their first and last name, so one team is enough.
const ACCOUNT_NAME_ROUTE = '/teams';
const ACCOUNT_NAME_QUERY = appendQueryFilters({ limit: 1 }, { include_membership: true });

/**
 * Returns the connected account's name from Presscart, or null when it has none on file or the
 * lookup fails, so callers can fall back to token claims.
 */
export async function fetchAccountName(
  extra: ToolExtraLike | undefined,
  options: ServerOptions
): Promise<string | null> {
  try {
    const api = createPresscartApiClient(extra, options);
    return readAccountNameFromTeams(await api.get<unknown>(ACCOUNT_NAME_ROUTE, ACCOUNT_NAME_QUERY));
  } catch (error) {
    console.error(
      JSON.stringify({
        message: 'Account name lookup failed; using token claims.',
        reason: error instanceof PresscartApiError ? `status ${error.status}` : errorName(error),
      })
    );
    return null;
  }
}

/** Reads only first_name and last_name from the caller's membership on the first team. */
export function readAccountNameFromTeams(response: unknown): string | null {
  const records = asRecord(response)?.records;
  if (!Array.isArray(records)) return null;

  const membership = asRecord(asRecord(records[0])?.membership);
  const name = [readTrimmedString(membership, 'first_name'), readTrimmedString(membership, 'last_name')]
    .filter((part): part is string => part !== null)
    .join(' ');

  return name.length > 0 ? name : null;
}

function readTrimmedString(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function errorName(error: unknown) {
  return error instanceof Error ? error.name : typeof error;
}
