import { z } from 'zod';

import { teamRoute } from '../../utils/team-routes.js';
import { createPresscartApiClient } from '../../utils/tool-context.js';
import { getOrderResultSchema, listProfileOrdersResultSchema } from '../output-schemas.js';
import { buildGetOrderResult, buildListProfileOrdersResult } from '../results.js';
import { defineDirectoryTool, directoryPaginationSchema, directoryTeamSlugSchema } from './definition.js';

export const listProfileOrdersTool = defineDirectoryTool({
  name: 'list_profile_orders',
  title: 'List Profile Orders',
  description:
    "List a profile's existing orders: order id, reference number, status, created and paid dates, and line items with publication name, website, and placement details. Requires team_slug from list_teams and profile_id from list_profiles. Use get_order for one order, including the campaign each item belongs to.",
  inputSchema: {
    team_slug: directoryTeamSlugSchema,
    profile_id: z.string().uuid().describe('Profile id from list_profiles or list_teams.'),
    ...directoryPaginationSchema,
    start_date: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('Only orders created on or after this date (YYYY-MM-DD).'),
    end_date: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('Only orders created on or before this date (YYYY-MM-DD).'),
  },
  outputSchema: listProfileOrdersResultSchema,
  handler: async (input, extra, options) => {
    const api = createPresscartApiClient(extra, options);
    const response = await api.get<unknown>(
      teamRoute(input.team_slug, `/profiles/${encodeURIComponent(input.profile_id)}/orders`),
      {
        limit: input.limit,
        page: input.page,
        start_date: input.start_date,
        end_date: input.end_date,
      }
    );
    return buildListProfileOrdersResult(response);
  },
});

export const getOrderTool = defineDirectoryTool({
  name: 'get_order',
  title: 'Get Order',
  description:
    'Get one existing order by order_id: reference number, status, dates, and line items, including order_items[].campaign_id for the campaign each delivered item belongs to. Requires team_slug from list_teams; order ids come from list_profile_orders. Use get_campaign or list_campaign_articles with a returned campaign_id.',
  inputSchema: {
    team_slug: directoryTeamSlugSchema,
    order_id: z.string().uuid().describe('Order id from list_profile_orders.'),
  },
  outputSchema: getOrderResultSchema,
  handler: async (input, extra, options) => {
    const api = createPresscartApiClient(extra, options);
    const response = await api.get<unknown>(
      teamRoute(input.team_slug, `/orders/${encodeURIComponent(input.order_id)}`)
    );
    return buildGetOrderResult(response);
  },
});
