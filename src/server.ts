import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { TokenSessionResponse } from './api.js';
import { normalizePriceFields } from './utils/price-fields.js';
import { appendQueryFilters, type QueryParams } from './utils/query-filters.js';
import {
  createPresscartApiClient,
  requirePermission,
  requireTeamId,
  resolveProfileId,
  type ServerOptions,
} from './utils/tool-context.js';
import { jsonResult } from './utils/tool-result.js';

export function createPresscartMcpServer(options: ServerOptions = {}) {
  const server = new McpServer({
    name: 'presscart',
    version: '0.2.0',
  });

  server.registerTool(
    'auth_whoami',
    {
      title: 'Auth Whoami',
      description: 'Return the current Presscart MCP session details.',
      inputSchema: {},
    },
    async (_input, extra) => {
      const api = createPresscartApiClient(extra, options);
      const response = await api.get<TokenSessionResponse>('/auth/token');
      return jsonResult(response);
    }
  );

  server.registerTool(
    'list_profiles',
    {
      title: 'List Profiles',
      description: 'List profiles for the authenticated team.',
      inputSchema: {
        team_id: z.string().uuid().optional(),
        limit: z.number().int().positive().max(100).optional(),
        page: z.number().int().positive().optional(),
        sort_by: z.string().trim().min(1).optional(),
        order_by: z.enum(['asc', 'desc']).optional(),
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

  server.registerTool(
    'list_outlets',
    {
      title: 'List Product Listings',
      description:
        'List reseller-visible Presscart product listings and their outlet details. Supports basic pagination, search, and sorting. Price fields are returned as prices[].price in the listed currency, with prices[].display_price formatted for display. Do not divide price by 100.',
      inputSchema: {
        limit: z.number().int().positive().max(100).optional(),
        page: z.number().int().positive().optional(),
        sort_by: z
          .enum(['name', 'created_at', 'domain_authority', 'domain_ranking'])
          .optional()
          .describe('Field to sort results by'),
        order_by: z.enum(['asc', 'desc']).optional(),
        filters: z
          .object({
            search: z.string().trim().optional().describe('Search by product or outlet name'),
            status: z
              .enum([
                'DRAFT',
                'PENDING_REVIEW',
                'PENDING_AGREEMENT',
                'REJECTED',
                'ACTIVE',
                'INACTIVE',
                'ARCHIVED',
                'SUSPENDED',
              ])
              .optional()
              .describe('Product listing publication status (defaults to ACTIVE)'),
            channel_type: z
              .enum([
                'WEBSITE',
                'NEWSLETTER',
                'INSTAGRAM',
                'LINKEDIN',
                'YOUTUBE',
                'TIKTOK',
                'TWITTER_X',
                'PODCAST',
                'OTHER',
              ])
              .optional(),
            placement_type: z
              .enum(['FULL_FEATURE', 'PRESS_RELEASE', 'MENTION', 'QUOTE', 'LISTICLE'])
              .optional(),
            is_do_follow: z.boolean().optional(),
            is_indexed: z.boolean().optional(),
            disclaimer: z.string().optional(),
            tags: z.array(z.string()).optional().describe('Filter by tag names'),
            turnaround_time: z
              .object({
                min: z.number().optional().describe('Minimum delivery days'),
                max: z.number().optional().describe('Maximum delivery days'),
              })
              .optional()
              .describe('Filter by turnaround/delivery time in days'),
            pricing: z
              .object({
                min: z.number().optional().describe('Minimum price in USD dollars'),
                max: z.number().optional().describe('Maximum price in USD dollars'),
              })
              .optional()
              .describe('Filter by price range in the listed currency. Do not divide by 100.'),
            domain_authority: z
              .object({
                min: z.number().optional().describe('Minimum DA score'),
                max: z.number().optional().describe('Maximum DA score'),
              })
              .optional()
              .describe('Filter by domain authority score range'),
            domain_ranking: z
              .object({
                min: z.number().optional().describe('Minimum DR score'),
                max: z.number().optional().describe('Maximum DR score'),
              })
              .optional()
              .describe('Filter by domain ranking score range'),
            country: z.string().optional(),
            state: z.string().optional(),
            city: z.string().optional(),
          })
          .optional(),
      },
    },
    async (input, extra) => {
      requirePermission(extra, options, 'outlets.lists');
      const api = createPresscartApiClient(extra, options);
      const { filters, ...params } = input;
      const query = appendQueryFilters(params as QueryParams, filters);
      const response = await api.get('/outlets', query);
      return jsonResult(normalizePriceFields(response));
    }
  );

  server.registerTool(
    'get_product',
    {
      title: 'Get Product',
      description:
        'Fetch a Presscart product by UUID. Price fields are returned as prices[].price in the listed currency, with prices[].display_price formatted for display. Do not divide price by 100.',
      inputSchema: {
        product_id: z.string().uuid(),
      },
    },
    async (input, extra) => {
      requirePermission(extra, options, 'products.read');
      const api = createPresscartApiClient(extra, options);
      const response = await api.get(`/products/${input.product_id}`);
      return jsonResult(normalizePriceFields(response));
    }
  );

  server.registerTool(
    'create_order_checkout',
    {
      title: 'Create Order Checkout',
      description: 'Create a Presscart checkout order for a profile and one or more line items.',
      inputSchema: {
        profile_id: z.string().uuid().optional(),
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
      const response = await api.post('/orders/checkout', {
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
        order_id: z.string().uuid(),
        include_outlets_data: z.boolean().optional(),
        include_order_items_data: z.boolean().optional(),
      },
    },
    async (input, extra) => {
      requirePermission(extra, options, 'orders.read');
      const api = createPresscartApiClient(extra, options);
      const response = await api.get(`/orders/${input.order_id}`, {
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
      description: 'List team-scoped Presscart order items/status rows.',
      inputSchema: {
        limit: z.number().int().positive().max(100).optional(),
        page: z.number().int().positive().optional(),
        search: z.string().trim().min(1).optional(),
        sort_by: z.string().trim().min(1).optional(),
        order_by: z.enum(['asc', 'desc']).optional(),
        order_line_item_id: z.string().uuid().optional(),
        include_article: z.boolean().optional(),
      },
    },
    async (input, extra) => {
      requirePermission(extra, options, 'orders.lists');
      const api = createPresscartApiClient(extra, options);
      const response = await api.get('/order-items', input);
      return jsonResult(response);
    }
  );

  server.registerTool(
    'create_campaign',
    {
      title: 'Create Campaign',
      description: 'Create a Presscart campaign for a profile.',
      inputSchema: {
        profile_id: z.string().uuid().optional(),
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
      const response = await api.post('/campaigns', {
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
      description: 'List team-scoped Presscart campaigns.',
      inputSchema: {
        limit: z.number().int().positive().max(100).optional(),
        page: z.number().int().positive().optional(),
        search: z.string().trim().min(1).optional(),
        sort_by: z.string().trim().min(1).optional(),
        order_by: z.enum(['asc', 'desc']).optional(),
        include_archived: z.boolean().optional(),
      },
    },
    async (input, extra) => {
      requirePermission(extra, options, 'campaigns.lists');
      const api = createPresscartApiClient(extra, options);
      const response = await api.get('/campaigns', input);
      return jsonResult(response);
    }
  );

  server.registerTool(
    'get_campaign',
    {
      title: 'Get Campaign',
      description: 'Fetch a Presscart campaign by UUID.',
      inputSchema: {
        campaign_id: z.string().uuid(),
      },
    },
    async (input, extra) => {
      requirePermission(extra, options, 'campaigns.read');
      const api = createPresscartApiClient(extra, options);
      const response = await api.get(`/campaigns/${input.campaign_id}`);
      return jsonResult(response);
    }
  );

  server.registerTool(
    'assign_order_items_to_campaign',
    {
      title: 'Assign Order Items To Campaign',
      description: 'Assign purchased order items to a Presscart campaign.',
      inputSchema: {
        campaign_id: z.string().uuid(),
        order_item_ids: z.array(z.string().uuid()).min(1),
      },
    },
    async (input, extra) => {
      requirePermission(extra, options, 'campaigns.update');
      const api = createPresscartApiClient(extra, options);
      const response = await api.post(`/campaigns/${input.campaign_id}/order-items`, {
        order_item_ids: input.order_item_ids,
      });
      return jsonResult(response);
    }
  );

  server.registerTool(
    'get_campaign_article_status',
    {
      title: 'Get Campaign Article Status',
      description: 'Get article status counts for a Presscart campaign.',
      inputSchema: {
        campaign_id: z.string().uuid(),
      },
    },
    async (input, extra) => {
      requirePermission(extra, options, 'campaigns.read');
      const api = createPresscartApiClient(extra, options);
      const response = await api.get(`/campaigns/${input.campaign_id}/articles/status-count`);
      return jsonResult(response);
    }
  );

  server.registerTool(
    'list_profile_order_items',
    {
      title: 'List Profile Order Items',
      description: 'List purchased order items for a Presscart profile.',
      inputSchema: {
        profile_id: z.string().uuid().optional(),
        type: z.string().trim().optional(),
        is_add_on: z.boolean().optional(),
        search: z.string().trim().min(1).optional(),
        aggregate_add_ons: z.boolean().optional(),
      },
    },
    async (input, extra) => {
      requirePermission(extra, options, 'orders.lists');
      const api = createPresscartApiClient(extra, options);
      const profileId = resolveProfileId(input.profile_id);
      const response = await api.get(`/profiles/${profileId}/order-items`, {
        type: input.type,
        is_add_on: input.is_add_on,
        search: input.search,
        aggregate_add_ons: input.aggregate_add_ons,
      });
      return jsonResult(response);
    }
  );

  return server;
}
