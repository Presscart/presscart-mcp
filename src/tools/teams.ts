import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  createPresscartApiClient,
  requirePermission,
  requireTeamId,
  type ServerOptions,
} from '../utils/tool-context.js';
import { jsonResult } from '../utils/tool-result.js';
import { toTeamDetailsResponse } from '../utils/team-details.js';
import { teamBySlugRoute, teamRoute } from '../utils/team-routes.js';
import { readOnlyTool, updateTool } from './metadata.js';
import { paginationSchema, sortSchema, teamSlugSchema } from './schemas.js';

const profileListFieldSchema = z.array(z.string().trim().min(1));

export function registerTeamTools(server: McpServer, options: ServerOptions) {
  server.registerTool(
    'list_teams',
    {
      title: 'List Teams',
      description:
        'List Presscart teams available to the authenticated account. Use this first when a team_id or team_slug is needed and the user has not provided one; call list_profiles with the selected team_id when a profile_id is needed. For marketplace recommendation tasks, this is usually enough to choose the workspace/profile context; do not call order tools unless the user asks about existing orders, purchases, or checkout state.',
      inputSchema: {
        ...paginationSchema,
        ...sortSchema,
        include_archived: z.boolean().optional(),
      },
      annotations: readOnlyTool,
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
      annotations: readOnlyTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'teams.read');
      const api = createPresscartApiClient(extra, options);
      const response = await api.get(teamBySlugRoute(input.team_slug));
      return jsonResult(toTeamDetailsResponse(response));
    }
  );

  server.registerTool(
    'list_profiles',
    {
      title: 'List Profiles',
      description:
        'List profiles for a Presscart team. If team_id is unknown, call list_teams first and use one of the returned team IDs. Use this to choose a real profile when list_teams is ambiguous; do not call campaigns or orders solely to recommend marketplace publications.',
      inputSchema: {
        team_id: z.string().uuid().optional(),
        ...paginationSchema,
        ...sortSchema,
        include_archived: z.boolean().optional(),
      },
      annotations: readOnlyTool,
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

  server.registerTool(
    'update_profile',
    {
      title: 'Update Profile',
      description:
        'Update editable profile details in a Presscart team workspace. Use only when the user explicitly asks to change profile information; send only the fields the user asked to update. Use list_teams and list_profiles first if team_slug or profile_id is unknown.',
      inputSchema: {
        team_slug: teamSlugSchema,
        profile_id: z.string().uuid(),
        name: z.string().trim().min(1).optional(),
        website_url: z.string().trim().min(1).optional(),
        overview: z.string().trim().min(1).optional(),
        products_and_services: z.string().trim().min(1).optional(),
        key_achievements: profileListFieldSchema.optional(),
        unique_value_propositions: profileListFieldSchema.optional(),
        industry: profileListFieldSchema.optional(),
        target_audience: profileListFieldSchema.optional(),
      },
      annotations: updateTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'profiles.update');
      const { team_slug, profile_id, ...profileValues } = input;
      const body = Object.fromEntries(
        Object.entries(profileValues).filter(([, value]) => value !== undefined)
      );

      if (Object.keys(body).length === 0) {
        throw new Error(
          'At least one profile field is required. Ask the user what profile detail to update.'
        );
      }

      const api = createPresscartApiClient(extra, options);
      const response = await api.patch(teamRoute(team_slug, `/profiles/${profile_id}`), body);
      return jsonResult(response);
    }
  );
}
