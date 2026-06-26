import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { normalizePriceFields } from '../utils/price-fields.js';
import { appendQueryFilters, type QueryParams } from '../utils/query-filters.js';
import {
  createPresscartApiClient,
  requirePermission,
  type ServerOptions,
} from '../utils/tool-context.js';
import { jsonResult } from '../utils/tool-result.js';
import { teamRoute } from '../utils/team-routes.js';
import { readOnlyTool } from './metadata.js';
import { paginationSchema, teamSlugSchema } from './schemas.js';

export function registerProductTools(server: McpServer, options: ServerOptions) {
  server.registerTool(
    'list_outlets',
    {
      title: 'List Product Listings',
      description:
        'List reseller-visible product listings and their outlet details. Supports basic pagination, search, and sorting. Price fields are returned as prices[].price in the listed currency, with prices[].display_price formatted for display. Use default_price, or the prices[] item with is_default_price=true, unless the user explicitly asks for a specific tier such as basic. Do not divide price by 100.',
      inputSchema: {
        team_slug: teamSlugSchema,
        ...paginationSchema,
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
      annotations: readOnlyTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'products.lists');
      const api = createPresscartApiClient(extra, options);
      const { team_slug, filters, ...params } = input;
      const query = appendQueryFilters(params as QueryParams, filters);
      const response = await api.get(teamRoute(team_slug, '/products/marketplace/listings'), query);
      return jsonResult(normalizePriceFields(response));
    }
  );

  server.registerTool(
    'get_product',
    {
      title: 'Get Product',
      description:
        'Fetch a product by UUID. Price fields are returned as prices[].price in the listed currency, with prices[].display_price formatted for display. Use default_price, or the prices[] item with is_default_price=true, unless the user explicitly asks for a specific tier such as basic. Do not divide price by 100.',
      inputSchema: {
        team_slug: teamSlugSchema,
        product_id: z.string().uuid(),
      },
      annotations: readOnlyTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'products.read');
      const api = createPresscartApiClient(extra, options);
      const response = await api.get(
        teamRoute(input.team_slug, `/products/marketplace/listings/${input.product_id}`)
      );
      return jsonResult(normalizePriceFields(response));
    }
  );
}
