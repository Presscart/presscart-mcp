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

export function registerOrderTools(server: McpServer, options: ServerOptions) {
  server.registerTool(
    'create_order',
    {
      title: 'Create Order',
      description:
        'Create a Presscart checkout order for a profile and one or more line items. If profile_id is unknown, call list_teams first, choose the team_id, then call list_profiles with that team_id. Before checkout is created, refer to any summed item prices only as an estimated item subtotal, not the order total. After checkout is created, use the returned subtotal, discount, processing_fee, credits_applied, and total fields as the authoritative order amounts.',
      inputSchema: {
        team_slug: teamSlugSchema,
        profile_id: z.string().uuid(),
        line_items: z
          .array(
            z.object({
              product_id: z.string().uuid(),
              quantity: z.number().int().positive(),
              is_add_on: z.boolean(),
              linked_order_line_item_id: z.string().uuid().optional(),
            })
          )
          .min(1),
      },
    },
    async (input, extra) => {
      requirePermission(extra, options, 'orders.create');
      const api = createPresscartApiClient(extra, options);
      const profileId = resolveProfileId(input.profile_id);
      const response = await api.post(teamRoute(input.team_slug, '/orders/checkout'), {
        profile_id: profileId,
        line_items: input.line_items,
      });
      return jsonResult(response);
    }
  );

  server.registerTool(
    'get_order',
    {
      title: 'Get Order',
      description: 'Fetch a Presscart order by UUID.',
      inputSchema: {
        team_slug: teamSlugSchema,
        order_id: z.string().uuid(),
        include_outlets_data: z.boolean().optional(),
        include_order_items_data: z.boolean().optional(),
      },
    },
    async (input, extra) => {
      requirePermission(extra, options, 'orders.read');
      const api = createPresscartApiClient(extra, options);
      const response = await api.get(teamRoute(input.team_slug, `/orders/${input.order_id}`), {
        include_outlets_data: input.include_outlets_data,
        include_order_items_data: input.include_order_items_data,
      });
      return jsonResult(response);
    }
  );

  server.registerTool(
    'list_order_items',
    {
      title: 'List Order Items',
      description: 'List publisher team order items/status rows.',
      inputSchema: {
        team_slug: teamSlugSchema,
        ...paginationSchema,
        ...sortSchema,
        search: z.string().trim().min(1).optional(),
        order_line_item_id: z.string().uuid().optional(),
        include_article: z.boolean().optional(),
      },
    },
    async (input, extra) => {
      requirePermission(extra, options, 'orders.lists');
      const api = createPresscartApiClient(extra, options);
      const { team_slug, ...query } = input;
      const response = await api.get(teamRoute(team_slug, '/order-items'), query);
      return jsonResult(response);
    }
  );

  server.registerTool(
    'list_profile_orders',
    {
      title: 'List Profile Orders',
      description: 'List orders and line items for a profile in a team workspace.',
      inputSchema: {
        team_slug: teamSlugSchema,
        profile_id: z.string().uuid(),
        ...paginationSchema,
        ...sortSchema,
        include_archived: z.boolean().optional(),
        start_date: z.string().trim().optional(),
        end_date: z.string().trim().optional(),
        paid_orders_only: z.boolean().optional(),
      },
    },
    async (input, extra) => {
      requirePermission(extra, options, 'orders.lists');
      const api = createPresscartApiClient(extra, options);
      const profileId = resolveProfileId(input.profile_id);
      const response = await api.get(teamRoute(input.team_slug, `/profiles/${profileId}/orders`), {
        limit: input.limit,
        page: input.page,
        sort_by: input.sort_by,
        order_by: input.order_by,
        include_archived: input.include_archived,
        start_date: input.start_date,
        end_date: input.end_date,
        paid_orders_only: input.paid_orders_only,
      });
      return jsonResult(response);
    }
  );
}
