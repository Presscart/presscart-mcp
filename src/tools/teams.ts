import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  createPresscartApiClient,
  requirePermission,
  requireTeamId,
  type ServerOptions,
} from '../utils/tool-context.js';
import { jsonResult } from '../utils/tool-result.js';
import { teamBySlugRoute } from '../utils/team-routes.js';
import { paginationSchema, sortSchema, teamSlugSchema } from './schemas.js';

export function registerTeamTools(server: McpServer, options: ServerOptions) {
  server.registerTool(
    'list_teams',
    {
      title: 'List Teams',
      description:
        'List Presscart teams available to the authenticated account. Use this first when a team_id or team_slug is needed and the user has not provided one; call list_profiles with the selected team_id when a profile_id is needed.',
      inputSchema: {
        ...paginationSchema,
        ...sortSchema,
        include_archived: z.boolean().optional(),
      },
    },
    async (input, extra) => {
      requirePermission(extra, options, 'teams.lists');
      const api = createPresscartApiClient(extra, options);
      const response = await api.get('/teams', {
        limit: input.limit,
        page: input.page,
        sort_by: input.sort_by,
        order_by: input.order_by,
        include_archived: input.include_archived,
      });
      return jsonResult(response);
    }
  );

  server.registerTool(
    'get_team',
    {
      title: 'Get Team',
      description: 'Fetch a team workspace by slug. Use list_teams first if the team slug is unknown.',
      inputSchema: {
        team_slug: teamSlugSchema,
      },
    },
    async (input, extra) => {
      requirePermission(extra, options, 'teams.read');
      const api = createPresscartApiClient(extra, options);
      const response = await api.get(teamBySlugRoute(input.team_slug));
      return jsonResult(response);
    }
  );

  server.registerTool(
    'list_profiles',
    {
      title: 'List Profiles',
      description:
        'List profiles for a Presscart team. If team_id is unknown, call list_teams first and use one of the returned team IDs.',
      inputSchema: {
        team_id: z.string().uuid().optional(),
        ...paginationSchema,
        ...sortSchema,
        include_archived: z.boolean().optional(),
      },
    },
    async (input, extra) => {
      requirePermission(extra, options, 'profiles.lists');
      const api = createPresscartApiClient(extra, options);
      const teamId = input.team_id ?? requireTeamId(extra, options);
      const response = await api.get(`/teams/${teamId}/profiles`, {
        limit: input.limit,
        page: input.page,
        sort_by: input.sort_by,
        order_by: input.order_by,
        include_archived: input.include_archived,
      });
      return jsonResult(response);
    }
  );
}
