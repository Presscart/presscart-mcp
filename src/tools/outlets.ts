import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  createPresscartApiClient,
  requirePermission,
  type ServerOptions,
} from '../utils/tool-context.js';
import { jsonResult } from '../utils/tool-result.js';
import { teamRoute } from '../utils/team-routes.js';
import { additiveWriteTool, readOnlyTool, updateTool } from './metadata.js';
import { paginationSchema, sortSchema, teamSlugSchema } from './schemas.js';

const outletTagSchema = z.object({
  tag_id: z.string().uuid(),
});

const outletPayloadSchema = {
  name: z.string().trim().min(1),
  description: z.string().nullable(),
  logo: z.string().nullable(),
  website_url: z.string().nullable(),
  country: z.string().nullable(),
  state: z.string().nullable(),
  city: z.string().nullable(),
  is_indexed: z.boolean(),
  has_author: z.boolean(),
  has_date: z.boolean(),
  tags: z.array(outletTagSchema),
  metadata_id: z.string().uuid().nullable().optional(),
};

export function registerOutletTools(server: McpServer, options: ServerOptions) {
  server.registerTool(
    'list_outlets',
    {
      title: 'List Outlets',
      description:
        'List outlet records owned by the selected team. Use this for publisher/team outlet management. For buyer marketplace discovery, use list_product_listings instead.',
      inputSchema: {
        team_slug: teamSlugSchema,
        ...paginationSchema,
        ...sortSchema,
        search: z.string().trim().optional(),
      },
      annotations: readOnlyTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'outlets.lists');
      const api = createPresscartApiClient(extra, options);
      const { team_slug, ...query } = input;
      const response = await api.get(teamRoute(team_slug, '/outlets'), query);
      return jsonResult(response);
    }
  );

  server.registerTool(
    'get_outlet',
    {
      title: 'Get Outlet',
      description:
        'Fetch one outlet record owned by the selected team. Use this before editing an outlet or creating outlet channels/product listings.',
      inputSchema: {
        team_slug: teamSlugSchema,
        outlet_id: z.string().uuid(),
      },
      annotations: readOnlyTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'outlets.read');
      const api = createPresscartApiClient(extra, options);
      const response = await api.get(teamRoute(input.team_slug, `/outlets/${input.outlet_id}`));
      return jsonResult(response);
    }
  );

  server.registerTool(
    'create_outlet',
    {
      title: 'Create Outlet',
      description:
        'Create an outlet for the selected team. The API associates it with the authenticated publisher provider team. Collect the outlet name, website URL, location fields, index/date/author flags, and tag IDs before calling this tool. Use status=DRAFT when the user wants to save without submitting/publishing.',
      inputSchema: {
        team_slug: teamSlugSchema,
        ...outletPayloadSchema,
        status: z.literal('DRAFT').optional(),
      },
      annotations: additiveWriteTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'outlets.create');
      const api = createPresscartApiClient(extra, options);
      const { team_slug, ...body } = input;
      const response = await api.post(teamRoute(team_slug, '/outlets'), body);
      return jsonResult(response);
    }
  );

  server.registerTool(
    'update_outlet',
    {
      title: 'Update Outlet',
      description:
        'Update an outlet owned by the selected team. Send the full outlet payload, not just changed fields. Use get_outlet first if the user only wants to change one value. Use status=DRAFT to keep it as a draft, or status=ACTIVE only when the user explicitly wants to publish and the publisher agreement is signed.',
      inputSchema: {
        team_slug: teamSlugSchema,
        outlet_id: z.string().uuid(),
        ...outletPayloadSchema,
        status: z.enum(['DRAFT', 'ACTIVE']).optional(),
      },
      annotations: updateTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'outlets.update');
      const api = createPresscartApiClient(extra, options);
      const { team_slug, outlet_id, ...body } = input;
      const response = await api.put(teamRoute(team_slug, `/outlets/${outlet_id}`), body);
      return jsonResult(response);
    }
  );
}
