import type { TokenSessionResponse } from '../api.js';
import type { AuthInfoLike } from './tool-context.js';

export type WhoamiResponse =
  | {
      id?: string;
      name?: string;
      email?: string;
    }
  | {
      team_id: string;
      token_type: string;
      pro_pricing_enabled: boolean;
    };

export function toWhoamiResponse(
  response: TokenSessionResponse,
  authInfo: AuthInfoLike | undefined
): WhoamiResponse {
  if (response.source !== 'oauth') {
    return {
      team_id: response.team_id,
      token_type: response.token_type,
      pro_pricing_enabled: response.pro_pricing_enabled,
    };
  }

  const email = readString(authInfo?.extra?.email);
  const firstName = readString(authInfo?.extra?.first_name);
  const lastName = readString(authInfo?.extra?.last_name);
  const fullName = [firstName, lastName].filter(Boolean).join(' ');

  return removeUndefinedValues({
    id: readString(authInfo?.extra?.sub),
    name: fullName || email,
    email,
  });
}

function readString(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function removeUndefinedValues<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}
