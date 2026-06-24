import type { TokenSessionResponse } from '../api.js';
import type { AuthInfoLike } from './tool-context.js';

export function includeOAuthSessionClaims(
  response: TokenSessionResponse,
  authInfo: AuthInfoLike | undefined
) {
  if (response.source !== 'oauth') return response;

  return {
    ...response,
    email: readString(authInfo?.extra?.email),
    sub: readString(authInfo?.extra?.sub),
  };
}

function readString(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
