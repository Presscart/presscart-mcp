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
  const authInfo = getSessionAuthInfo(extra, options);
  const credential = resolvePresscartApiCredential(authInfo);

  if (!credential) {
    throw new Error(
      'No Presscart API credential is bound to the MCP session. Authenticate with MCP OAuth or provide X-Presscart-API-Token when OAuth is disabled.'
    );
  }

  return new PresscartApiClient(env.PRESSCART_API_URL, credential, env.PRESSCART_API_TIMEOUT_MS);
}

export function requireTeamId(extra: ToolExtraLike | undefined, options: ServerOptions) {
  const authInfo = getSessionAuthInfo(extra, options);
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
  void extra;
  void options;
  void permission;
}

export function resolveProfileId(profileId: string | undefined) {
  if (profileId) return profileId;

  throw new Error(
    'profile_id is required. Call list_teams, then list_profiles, and pass the selected profile_id.'
  );
}

export function getSessionAuthInfo(extra: ToolExtraLike | undefined, options: ServerOptions) {
  return extra?.authInfo ?? options.getSessionAuthInfo?.(extra?.sessionId);
}

export function isOAuthSession(authInfo: AuthInfoLike | undefined) {
  return (
    authInfo?.extra?.source === 'mcp' ||
    typeof authInfo?.extra?.oauth_grant_id === 'string'
  );
}

function resolvePresscartApiCredential(authInfo: AuthInfoLike | undefined) {
  if (!authInfo) return undefined;

  if (typeof authInfo?.extra?.presscart_api_token === 'string') {
    return authInfo.extra.presscart_api_token;
  }

  if (isOAuthSession(authInfo)) {
    const grantId = authInfo.extra?.oauth_grant_id;
    if (typeof grantId !== 'string' || grantId.length === 0) return undefined;

    if (!env.MCP_INTERNAL_AUTH_TOKEN) {
      console.error('Missing MCP_INTERNAL_AUTH_TOKEN while MCP OAuth is enabled.');
      throw new Error('Unable to complete this request right now. Please try again later.');
    }

    return {
      bearerToken: env.MCP_INTERNAL_AUTH_TOKEN,
      oauthGrantId: grantId,
    };
  }

  return authInfo?.token;
}
