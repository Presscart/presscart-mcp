import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  createPresscartApiClient,
  requirePermission,
  resolveProfileId,
  type ServerOptions,
} from '../utils/tool-context.js';
import { jsonResult } from '../utils/tool-result.js';
import { teamRoute } from '../utils/team-routes.js';
import { paginationSchema, sortSchema, teamSlugSchema } from './schemas.js';

export function registerCampaignTools(server: McpServer, options: ServerOptions) {
  server.registerTool(
    'create_campaign',
    {
      title: 'Create Campaign',
      description: 'Create a Presscart campaign for a profile.',
      inputSchema: {
        team_slug: teamSlugSchema,
        profile_id: z.string().uuid(),
        name: z.string().trim().min(1),
        objectives: z.string().trim().min(1),
        description: z.string().trim().nullable().optional(),
        keywords: z.string().trim().nullable().optional(),
        target_audience: z.string().trim().nullable().optional(),
        tone: z.string().trim().nullable().optional(),
        writing_samples: z.string().trim().nullable().optional(),
        file_id: z.string().trim().nullable().optional(),
      },
    },
    async (input, extra) => {
      requirePermission(extra, options, 'campaigns.create');
      const api = createPresscartApiClient(extra, options);
      const profileId = resolveProfileId(input.profile_id);
      const response = await api.post(teamRoute(input.team_slug, '/campaigns'), {
        profile_id: profileId,
        name: input.name,
        objectives: input.objectives,
        description: input.description ?? null,
        keywords: input.keywords ?? null,
        target_audience: input.target_audience ?? null,
        tone: input.tone ?? null,
        writing_samples: input.writing_samples ?? null,
        file_id: input.file_id ?? null,
      });
      return jsonResult(response);
    }
  );

  server.registerTool(
    'list_campaigns',
    {
      title: 'List Campaigns',
      description: 'List campaigns for a profile in a team workspace.',
      inputSchema: {
        team_slug: teamSlugSchema,
        profile_id: z.string().uuid(),
        ...paginationSchema,
        ...sortSchema,
        search: z.string().trim().min(1).optional(),
        include_archived: z.boolean().optional(),
      },
    },
    async (input, extra) => {
      requirePermission(extra, options, 'campaigns.lists');
      const api = createPresscartApiClient(extra, options);
      const { team_slug, profile_id, ...query } = input;
      const response = await api.get(
        teamRoute(team_slug, `/profiles/${profile_id}/campaigns`),
        query
      );
      return jsonResult(response);
    }
  );

  server.registerTool(
    'get_campaign',
    {
      title: 'Get Campaign',
      description: 'Fetch a Presscart campaign by UUID.',
      inputSchema: {
        team_slug: teamSlugSchema,
        campaign_id: z.string().uuid(),
      },
    },
    async (input, extra) => {
      requirePermission(extra, options, 'campaigns.read');
      const api = createPresscartApiClient(extra, options);
      const response = await api.get(teamRoute(input.team_slug, `/campaigns/${input.campaign_id}`));
      return jsonResult(response);
    }
  );

  server.registerTool(
    'assign_order_items_to_campaign',
    {
      title: 'Assign Order Items To Campaign',
      description: 'Assign purchased order items to a Presscart campaign.',
      inputSchema: {
        team_slug: teamSlugSchema,
        campaign_id: z.string().uuid(),
        order_item_ids: z.array(z.string().uuid()).min(1),
      },
    },
    async (input, extra) => {
      requirePermission(extra, options, 'campaigns.update');
      const api = createPresscartApiClient(extra, options);
      const response = await api.post(
        teamRoute(input.team_slug, `/campaigns/${input.campaign_id}/order-items`),
        {
          order_item_ids: input.order_item_ids,
        }
      );
      return jsonResult(response);
    }
  );

  server.registerTool(
    'get_campaign_article_status',
    {
      title: 'Get Campaign Article Status',
      description: 'Get article status counts for a Presscart campaign.',
      inputSchema: {
        team_slug: teamSlugSchema,
        campaign_id: z.string().uuid(),
      },
    },
    async (input, extra) => {
      requirePermission(extra, options, 'campaigns.read');
      const api = createPresscartApiClient(extra, options);
      const response = await api.get(
        teamRoute(input.team_slug, `/campaigns/${input.campaign_id}/articles/status-count`)
      );
      return jsonResult(response);
    }
  );
}
