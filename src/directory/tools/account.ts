import { z } from 'zod';

import { fetchAccountName } from '../../utils/account-name.js';
import { teamBySlugRoute } from '../../utils/team-routes.js';
import {
  createPresscartApiClient,
  getSessionAuthInfo,
  isOAuthSession,
} from '../../utils/tool-context.js';
import {
  getTeamResultSchema,
  getUserResultSchema,
  listProfilesResultSchema,
  listTeamsResultSchema,
} from '../output-schemas.js';
import {
  buildApiTokenUserResult,
  buildGetTeamResult,
  buildListProfilesResult,
  buildListTeamsResult,
  buildOAuthUserResult,
} from '../results.js';
import { defineDirectoryTool, directoryPaginationSchema, directoryTeamSlugSchema } from './definition.js';

export const getUserTool = defineDirectoryTool({
  name: 'get_user',
  title: 'Get User',
  description:
    "Return the connected Presscart account. OAuth connections: id and name, the account holder's first and last name from their Presscart profile (omitted when none is on file). API-token connections: team_id only. Never returns email or other contact details. Takes no input. Use list_teams next to see the teams this account can read.",
  inputSchema: {},
  outputSchema: getUserResultSchema,
  handler: async (_input, extra, options) => {
    const authInfo = getSessionAuthInfo(extra, options);
    if (isOAuthSession(authInfo)) {
      return buildOAuthUserResult(authInfo, await fetchAccountName(extra, options));
    }

    const api = createPresscartApiClient(extra, options);
    return buildApiTokenUserResult(await api.get<unknown>('/auth/token'));
  },
});

export const listTeamsTool = defineDirectoryTool({
  name: 'list_teams',
  title: 'List Teams',
  description:
    "List the Presscart teams the connected account belongs to, with each team's id, slug, type, the caller's role, and its profiles (id and name). Call this first when team_slug or team_id is unknown. Next: get_team for one team, list_profiles for profile details, list_campaigns or list_profile_orders for a profile's work.",
  inputSchema: { ...directoryPaginationSchema },
  outputSchema: listTeamsResultSchema,
  handler: async (input, extra, options) => {
    const api = createPresscartApiClient(extra, options);
    const response = await api.get<unknown>('/teams', { limit: input.limit, page: input.page });
    return buildListTeamsResult(response);
  },
});

export const getTeamTool = defineDirectoryTool({
  name: 'get_team',
  title: 'Get Team',
  description:
    'Get one Presscart team by team_slug: id, name, slug, type, and its profiles (id and name). Call list_teams first if team_slug is unknown.',
  inputSchema: { team_slug: directoryTeamSlugSchema },
  outputSchema: getTeamResultSchema,
  handler: async (input, extra, options) => {
    const api = createPresscartApiClient(extra, options);
    return buildGetTeamResult(await api.get<unknown>(teamBySlugRoute(input.team_slug)));
  },
});

export const listProfilesTool = defineDirectoryTool({
  name: 'list_profiles',
  title: 'List Profiles',
  description:
    'List the profiles (brands) in a Presscart team: id, name, type, and website_url. Requires team_id from list_teams. Use a returned profile id with list_campaigns or list_profile_orders.',
  inputSchema: {
    team_id: z.string().uuid().describe('Team id from list_teams.'),
    ...directoryPaginationSchema,
  },
  outputSchema: listProfilesResultSchema,
  handler: async (input, extra, options) => {
    const api = createPresscartApiClient(extra, options);
    const response = await api.get<unknown>(
      `/teams/${encodeURIComponent(input.team_id)}/profiles`,
      { limit: input.limit, page: input.page }
    );
    return buildListProfilesResult(response);
  },
});
