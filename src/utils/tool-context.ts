import { PresscartApiClient } from '../api.js';
import { env } from '../env.js';

export type AuthInfoLike = {
  token: string;
  scopes?: string[];
  extra?: Record<string, unknown>;
};

export type ToolExtraLike = {
  authInfo?: AuthInfoLike;
  sessionId?: string;
};

export type ServerOptions = {
  getSessionAuthInfo?: (sessionId?: string) => AuthInfoLike | undefined;
};

export function createPresscartApiClient(extra: ToolExtraLike | undefined, options: ServerOptions) {
  const authInfo = resolveAuthInfo(extra, options);
  const tokenFromSession =
    typeof authInfo?.extra?.presscart_api_token === 'string'
      ? authInfo.extra.presscart_api_token
      : authInfo?.token;

  if (!tokenFromSession) {
    throw new Error(
      'No Presscart API credential is bound to the MCP session. Authenticate with MCP OAuth or provide X-Presscart-API-Token when OAuth is disabled.'
    );
  }

  return new PresscartApiClient(env.PRESSCART_API_URL, tokenFromSession);
}

export function requireTeamId(extra: ToolExtraLike | undefined, options: ServerOptions) {
  const authInfo = resolveAuthInfo(extra, options);
  const teamId = authInfo?.extra?.team_id;
  if (typeof teamId === 'string' && teamId.length > 0) return teamId;

  throw new Error(
    'team_id is required. Pass team_id explicitly or bind the Presscart credential to the MCP session.'
  );
}

export function requirePermission(
  extra: ToolExtraLike | undefined,
  options: ServerOptions,
  permission: string
) {
  const authInfo = resolveAuthInfo(extra, options);

  if (!isOAuthSession(authInfo)) return;

  const permissions = new Set(readOAuthPermissions(authInfo));
  if (permissions.has(permission)) return;

  throw new Error(`OAuth grant is missing required permission: ${permission}`);
}

export function resolveProfileId(profileId: string | undefined) {
  const resolved = profileId ?? env.PRESSCART_PROFILE_ID;

  if (!resolved) {
    throw new Error(
      'profile_id is required. Pass profile_id explicitly or configure PRESSCART_PROFILE_ID.'
    );
  }

  return resolved;
}

function resolveAuthInfo(extra: ToolExtraLike | undefined, options: ServerOptions) {
  return extra?.authInfo ?? options.getSessionAuthInfo?.(extra?.sessionId);
}

function isOAuthSession(authInfo: AuthInfoLike | undefined): authInfo is AuthInfoLike {
  return (
    authInfo?.extra?.source === 'oauth' ||
    typeof authInfo?.extra?.oauth_grant_id === 'string'
  );
}

function readOAuthPermissions(authInfo: AuthInfoLike) {
  const extraPermissions = authInfo.extra?.permissions;
  if (Array.isArray(extraPermissions)) {
    return extraPermissions.filter(
      (permission): permission is string => typeof permission === 'string' && permission.length > 0
    );
  }

  return authInfo.scopes ?? [];
}
