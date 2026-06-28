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
import { additiveWriteTool, readOnlyTool, updateTool } from './metadata.js';
import { paginationSchema, sortSchema, teamSlugSchema } from './schemas.js';

const exampleLinkSchema = z.object({
  id: z.string().optional().describe('Existing example-link ID. Use this when updating a link.'),
  url: z.string().trim().min(1),
});

type ProductListingLocationsResponse = {
  countries: string[];
  states: string[];
  cities: string[];
};

const marketplaceDiscoveryLimitSchema = z
  .number()
  .int()
  .positive()
  .max(100)
  .optional()
  .default(100)
  .describe(
    'Defaults to 100. Use 100 for broad marketplace recommendation or discovery tasks; use a smaller limit only for exact lookups or narrow refinements.'
  );

const productPayloadSchema = {
  name: z.string().trim().min(1),
  description: z.string().optional().default(''),
  image: z.string().nullable().optional().default(''),
  logo: z.string().nullable().optional().default(''),
  example_screenshot: z.string().nullable().optional().default(''),
  type_id: z
    .string()
    .uuid()
    .describe('Product type ID. Use list_product_types before creating a product.'),
  active: z
    .boolean()
    .describe('Set false for a draft/inactive product. Set true only when the user wants it active.'),
  requirements: z.string().optional().default(''),
  min_delivery_days: z.number().int().nonnegative().nullable().optional(),
  max_delivery_days: z.number().int().nonnegative().nullable().optional(),
  is_featured: z.boolean().optional().default(false),
  llm_aeo: z.string().nullable().optional().default(null),
  internal_cost: z
    .number()
    .nonnegative()
    .describe(
      'Your Cost in USD dollars. The marketplace Price is calculated automatically from this amount by the API; do not provide basic/pro prices, prices[], or Stripe unit_amount values.'
    ),
  outlet_channel_ids: z
    .array(z.string().uuid())
    .min(1)
    .describe('Outlet channel IDs. Use list_outlet_channels before creating or updating a product.'),
  example_links: z.array(exampleLinkSchema).default([]),
};

export function registerProductTools(server: McpServer, options: ServerOptions) {
  server.registerTool(
    'list_product_types',
    {
      title: 'List Product Types',
      description:
        'List product types that can be used when creating publisher-owned products. Call this before create_product when the user does not know the product type ID.',
      inputSchema: {
        ...paginationSchema,
        ...sortSchema,
        search: z.string().trim().optional(),
        include_archived: z.boolean().optional(),
        fetch_all: z.boolean().optional(),
      },
      annotations: readOnlyTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'products.lists');
      const api = createPresscartApiClient(extra, options);
      const response = await api.get('/product-types', input);
      return jsonResult(response);
    }
  );

  server.registerTool(
    'list_product_listings',
    {
      title: 'List Product Listings',
      description:
        'List buyer marketplace product listings available for purchase, including outlet details. Use this for marketplace discovery and purchase planning, not for managing publisher-owned products. For recommendation tasks, make one broad call with limit=100 and relevant filters, tags, or search terms, then call get_product_listing only for shortlisted candidates. Do not make many narrow list calls unless refining after the broad result set. If the user is planning to buy and wants Presscart internal writers to write the article, call list_add_ons before create_order so you can recommend a writing add-on. Price fields are returned as prices[].price in the listed currency, with prices[].display_price formatted for display. These are Presscart currency amounts, not Stripe unit_amount cent values; do not divide by 100 or round as cents. Use default_price, or the prices[] item with is_default_price=true, unless the user explicitly asks for a specific tier such as basic.',
      inputSchema: {
        team_slug: teamSlugSchema,
        ...paginationSchema,
        limit: marketplaceDiscoveryLimitSchema,
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
      const query = appendQueryFilters(
        { ...(params as QueryParams), limit: input.limit ?? 100 },
        filters
      );
      const response = await api.get(teamRoute(team_slug, '/products/marketplace/listings'), query);
      return jsonResult(normalizePriceFields(response));
    }
  );

  server.registerTool(
    'list_add_ons',
    {
      title: 'List Add-ons',
      description:
        'List purchasable Presscart add-ons for a team using the same add-on catalog shown in the publication details modal. Use before create_order when the user wants Presscart internal writers to write the article, asks for writing support, or asks what add-ons are available. Also explain the no-writer option: the user can self-submit their own story for $0 add-on cost, but they must write it themselves according to Presscart editorial guidelines and the selected publisher/publication requirements. Prices are returned as prices[].price in the listed currency, with prices[].display_price formatted for display. These are Presscart currency amounts, not Stripe unit_amount cent values; do not divide by 100 or round as cents.',
      inputSchema: {
        team_slug: teamSlugSchema,
        ...paginationSchema,
        ...sortSchema,
        search: z.string().trim().optional(),
        include_archived: z.boolean().optional(),
      },
      annotations: readOnlyTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'products.lists');
      const api = createPresscartApiClient(extra, options);
      const { team_slug, ...query } = input;
      const response = await api.get(teamRoute(team_slug, '/products'), {
        ...query,
        type: 'add-ons',
      });
      return jsonResult(normalizePriceFields(response));
    }
  );

  server.registerTool(
    'list_countries',
    {
      title: 'List Countries',
      description:
        'List country values that currently have visible buyer marketplace product listings. Use this before list_product_listings when the user wants to filter product listings by location or asks what countries are available.',
      inputSchema: {
        team_slug: teamSlugSchema,
      },
      annotations: readOnlyTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'products.lists');
      const api = createPresscartApiClient(extra, options);
      const response = await api.get<ProductListingLocationsResponse>(
        teamRoute(input.team_slug, '/marketplace/locations')
      );
      return jsonResult({ countries: response.countries });
    }
  );

  server.registerTool(
    'list_states',
    {
      title: 'List States',
      description:
        'List state or region values that currently have visible buyer marketplace product listings. Pass country when the user has selected one, then use the returned state values as filters for list_product_listings.',
      inputSchema: {
        team_slug: teamSlugSchema,
        country: z.string().trim().optional(),
      },
      annotations: readOnlyTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'products.lists');
      const api = createPresscartApiClient(extra, options);
      const { team_slug, ...query } = input;
      const response = await api.get<ProductListingLocationsResponse>(
        teamRoute(team_slug, '/marketplace/locations'),
        query
      );
      return jsonResult({ states: response.states });
    }
  );

  server.registerTool(
    'list_cities',
    {
      title: 'List Cities',
      description:
        'List city values that currently have visible buyer marketplace product listings. Pass country and state when known, then use the returned city values as filters for list_product_listings.',
      inputSchema: {
        team_slug: teamSlugSchema,
        country: z.string().trim().optional(),
        state: z.string().trim().optional(),
      },
      annotations: readOnlyTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'products.lists');
      const api = createPresscartApiClient(extra, options);
      const { team_slug, ...query } = input;
      const response = await api.get<ProductListingLocationsResponse>(
        teamRoute(team_slug, '/marketplace/locations'),
        query
      );
      return jsonResult({ cities: response.cities });
    }
  );

  server.registerTool(
    'get_product_listing',
    {
      title: 'Get Product Listing',
      description:
        'Fetch one buyer marketplace product listing by UUID. Use this for shortlisted listings from list_product_listings, especially before final recommendations or purchase/order actions. Do not call this for every search result. Price fields are returned as prices[].price in the listed currency, with prices[].display_price formatted for display. These are Presscart currency amounts, not Stripe unit_amount cent values; do not divide by 100 or round as cents. Use default_price, or the prices[] item with is_default_price=true, unless the user explicitly asks for a specific tier such as basic.',
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

  server.registerTool(
    'list_products',
    {
      title: 'List Products',
      description:
        'List publisher-owned products under one outlet. Use list_outlets or get_outlet first to choose the outlet_id. This is for managing products owned by the selected publisher team, not buyer marketplace discovery.',
      inputSchema: {
        team_slug: teamSlugSchema,
        outlet_id: z.string().uuid(),
        ...paginationSchema,
        ...sortSchema,
        include_archived: z.boolean().optional(),
        fetch_all: z.boolean().optional(),
      },
      annotations: readOnlyTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'products.lists');
      const api = createPresscartApiClient(extra, options);
      const { team_slug, outlet_id, ...query } = input;
      const response = await api.get(
        teamRoute(team_slug, `/products/listings/outlets/${outlet_id}`),
        query
      );
      return jsonResult(normalizePriceFields(response));
    }
  );

  server.registerTool(
    'get_product',
    {
      title: 'Get Product',
      description:
        'Fetch one publisher-owned product by UUID. Use this before update_product when changing an existing product, because update_product expects the full editable product payload including current prices and example links. Price fields are returned as prices[].price in the listed currency, with prices[].display_price formatted for display. These are Presscart currency amounts, not Stripe unit_amount cent values; do not divide by 100 or round as cents.',
      inputSchema: {
        team_slug: teamSlugSchema,
        product_id: z.string().uuid(),
        include_outlets: z.boolean().optional(),
        include_prices: z.boolean().optional(),
      },
      annotations: readOnlyTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'products.read');
      const api = createPresscartApiClient(extra, options);
      const { team_slug, product_id, ...query } = input;
      const response = await api.get(teamRoute(team_slug, `/products/listings/${product_id}`), query);
      return jsonResult(normalizePriceFields(response));
    }
  );

  server.registerTool(
    'create_product',
    {
      title: 'Create Product',
      description:
        'Create a publisher-owned product under the selected team. Use list_product_types for type_id and list_outlet_channels for outlet_channel_ids before calling this tool. Provide internal_cost as the publisher Your Cost in USD dollars only; the API automatically calculates marketplace Price and Pro Price. Do not send prices[], unit_amount, or Stripe-style cent amounts. Set active=false unless the user explicitly wants the product active.',
      inputSchema: {
        team_slug: teamSlugSchema,
        ...productPayloadSchema,
      },
      annotations: additiveWriteTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'products.create');
      const api = createPresscartApiClient(extra, options);
      const { team_slug, ...body } = input;
      const response = await api.post(teamRoute(team_slug, '/products/listings'), body);
      return jsonResult(normalizePriceFields(response));
    }
  );

  server.registerTool(
    'update_product',
    {
      title: 'Update Product',
      description:
        'Update a publisher-owned product. Call get_product first and send the full editable payload with the intended changes. Preserve existing example_links that should remain. Provide internal_cost as the publisher Your Cost in USD dollars only; the API automatically recalculates marketplace Price and Pro Price. Do not send prices[], unit_amount, or Stripe-style cent amounts.',
      inputSchema: {
        team_slug: teamSlugSchema,
        product_id: z.string().uuid(),
        ...productPayloadSchema,
      },
      annotations: updateTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'products.update');
      const api = createPresscartApiClient(extra, options);
      const { team_slug, product_id, ...body } = input;
      const response = await api.put(
        teamRoute(team_slug, `/products/listings/${product_id}`),
        body
      );
      return jsonResult(normalizePriceFields(response));
    }
  );
}
