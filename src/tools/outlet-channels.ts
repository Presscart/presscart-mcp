import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  createPresscartApiClient,
  requirePermission,
  type ServerOptions,
} from '../utils/tool-context.js';
import { jsonResult } from '../utils/tool-result.js';
import { teamRoute } from '../utils/team-routes.js';
import { additiveWriteTool, readOnlyTool, replaceTool, updateTool } from './metadata.js';
import { teamSlugSchema } from './schemas.js';

const channelTypeSchema = z
  .enum([
    'WEBSITE',
    'NEWSLETTER',
    'INSTAGRAM',
    'LINKEDIN',
    'TWITTER_X',
    'TIKTOK',
    'YOUTUBE',
    'PODCAST',
  ])
  .describe('Distribution channel type.');

const placementTypeSchema = z
  .enum(['FULL_FEATURE', 'PRESS_RELEASE', 'MENTION', 'QUOTE'])
  .nullable()
  .optional()
  .describe('Website placement type. Use null for non-website channels.');

const channelPayloadSchema = {
  channel_type: channelTypeSchema,
  placement_type: placementTypeSchema,
  channel_handle: z.string().trim().nullable().optional(),
  channel_url: z.string().trim().nullable().optional(),
  example_links: z.array(z.string().trim().min(1)).optional(),
  social_links: z.array(z.string().trim().min(1)).optional(),
  is_do_follow: z.boolean().optional(),
  do_follow_links_allowed: z.string().trim().nullable().optional(),
  domain_authority: z.number().nullable().optional(),
  domain_ranking: z.number().nullable().optional(),
  disclaimer_id: z.string().uuid().nullable().optional(),
};

export function registerOutletChannelTools(server: McpServer, options: ServerOptions) {
  server.registerTool(
    'list_outlet_channels',
    {
      title: 'List Outlet Channels',
      description:
        'List distribution channels for an outlet owned by the selected publisher team. Use this before creating product listings so the user can choose the correct outlet channel.',
      inputSchema: {
        team_slug: teamSlugSchema,
        outlet_id: z.string().uuid(),
      },
      annotations: readOnlyTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'outlets.read');
      const api = createPresscartApiClient(extra, options);
      const response = await api.get(
        teamRoute(input.team_slug, `/outlets/${input.outlet_id}/channels`)
      );
      return jsonResult(response);
    }
  );

  server.registerTool(
    'create_outlet_channel',
    {
      title: 'Create Outlet Channel',
      description:
        'Create a distribution channel for an outlet owned by the selected publisher team. Website channels should usually include placement_type, channel_url, SEO metrics, do-follow settings, and disclaimer_id. Non-website channels should use placement_type=null.',
      inputSchema: {
        team_slug: teamSlugSchema,
        outlet_id: z.string().uuid(),
        ...channelPayloadSchema,
      },
      annotations: additiveWriteTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'outlet_channels.create');
      const api = createPresscartApiClient(extra, options);
      const { team_slug, outlet_id, ...body } = input;
      const response = await api.post(teamRoute(team_slug, `/outlets/${outlet_id}/channels`), body);
      return jsonResult(response);
    }
  );

  server.registerTool(
    'update_outlet_channel',
    {
      title: 'Update Outlet Channel',
      description:
        'Update a distribution channel for an outlet owned by the selected publisher team. Use list_outlet_channels first if the user only wants to change one value.',
      inputSchema: {
        team_slug: teamSlugSchema,
        outlet_id: z.string().uuid(),
        channel_id: z.string().uuid(),
        channel_type: channelTypeSchema.optional(),
        placement_type: placementTypeSchema,
        channel_handle: z.string().trim().nullable().optional(),
        channel_url: z.string().trim().nullable().optional(),
        example_links: z.array(z.string().trim().min(1)).optional(),
        social_links: z.array(z.string().trim().min(1)).optional(),
        is_do_follow: z.boolean().optional(),
        do_follow_links_allowed: z.string().trim().nullable().optional(),
        domain_authority: z.number().nullable().optional(),
        domain_ranking: z.number().nullable().optional(),
        disclaimer_id: z.string().uuid().nullable().optional(),
      },
      annotations: updateTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'outlet_channels.update');
      const api = createPresscartApiClient(extra, options);
      const { team_slug, outlet_id, channel_id, ...body } = input;
      const response = await api.patch(
        teamRoute(team_slug, `/outlets/${outlet_id}/channels/${channel_id}`),
        body
      );
      return jsonResult(response);
    }
  );

  server.registerTool(
    'delete_outlet_channel',
    {
      title: 'Delete Outlet Channel',
      description:
        'Soft-delete a distribution channel from an outlet owned by the selected publisher team. Use only after the user explicitly confirms which channel should be removed.',
      inputSchema: {
        team_slug: teamSlugSchema,
        outlet_id: z.string().uuid(),
        channel_id: z.string().uuid(),
      },
      annotations: replaceTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'outlet_channels.delete');
      const api = createPresscartApiClient(extra, options);
      const response = await api.delete(
        teamRoute(input.team_slug, `/outlets/${input.outlet_id}/channels/${input.channel_id}`)
      );
      return jsonResult(response);
    }
  );
}
