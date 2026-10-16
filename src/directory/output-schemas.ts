import { z } from 'zod';

import type { DirectoryToolName } from './policy.js';

// Directory outputs are builder-shaped, not backend-shaped: every object node is
// .strict() so a key a builder did not intend fails the call instead of leaking.
export type DirectoryResultSchema = z.ZodObject<z.ZodRawShape, 'strict'>;

const nullableString = z.string().nullable();
const nullableNumber = z.number().nullable();
const nullableBoolean = z.boolean().nullable();

const paginationShape = {
  total_records: nullableNumber,
  total_pages: nullableNumber,
  current_page: nullableNumber,
  next_page: nullableNumber,
  previous_page: nullableNumber,
};

const profileRefSchema = z.object({ id: nullableString, name: nullableString }).strict();

const includeSchema = z
  .object({ channel_type: nullableString, placement_type: nullableString })
  .strict();

const outletRefSchema = z.object({ name: nullableString, website_url: nullableString }).strict();

const orderLineItemShape = {
  id: nullableString,
  name: nullableString,
  product_type_name: nullableString,
  quantity: nullableNumber,
  outlet: outletRefSchema.nullable(),
  includes: z.array(includeSchema).nullable(),
};

const orderLineItemSchema = z.object(orderLineItemShape).strict();

const orderDetailLineItemSchema = z
  .object({
    ...orderLineItemShape,
    order_items: z
      .array(z.object({ id: nullableString, campaign_id: nullableString }).strict())
      .nullable(),
  })
  .strict();

const orderShape = {
  id: nullableString,
  reference_number: nullableString,
  status: nullableString,
  created_at: nullableString,
  date_paid: nullableString,
};

export const getUserResultSchema = z
  .object({
    id: z.string().optional(),
    name: z
      .string()
      .optional()
      .describe("The account holder's first and last name from their Presscart profile."),
    team_id: z.string().optional(),
  })
  .strict();

export const teamSummarySchema = z
  .object({
    id: nullableString,
    name: nullableString,
    slug: nullableString,
    type: nullableString,
    is_publisher: nullableBoolean,
    role: nullableString,
    profiles: z.array(profileRefSchema).nullable(),
  })
  .strict();

export const listTeamsResultSchema = z
  .object({ records: z.array(teamSummarySchema), ...paginationShape })
  .strict();

export const getTeamResultSchema = z
  .object({
    id: nullableString,
    name: nullableString,
    slug: nullableString,
    type: nullableString,
    profiles: z.array(profileRefSchema).nullable(),
  })
  .strict();

export const profileSummarySchema = z
  .object({
    id: nullableString,
    name: nullableString,
    team_id: nullableString,
    type: nullableString,
    website_url: nullableString,
  })
  .strict();

export const listProfilesResultSchema = z
  .object({ records: z.array(profileSummarySchema), ...paginationShape })
  .strict();

export const orderSummarySchema = z
  .object({ ...orderShape, line_items: z.array(orderLineItemSchema).nullable() })
  .strict();

export const listProfileOrdersResultSchema = z
  .object({ records: z.array(orderSummarySchema), ...paginationShape })
  .strict();

export const getOrderResultSchema = z
  .object({ ...orderShape, line_items: z.array(orderDetailLineItemSchema).nullable() })
  .strict();

export const campaignSummarySchema = z
  .object({
    id: nullableString,
    name: nullableString,
    reference: nullableString,
    profile_id: nullableString,
    created_at: nullableString,
    updated_at: nullableString,
    article_count: nullableNumber,
    published_count: nullableNumber,
  })
  .strict();

export const listCampaignsResultSchema = z
  .object({ records: z.array(campaignSummarySchema), ...paginationShape })
  .strict();

export const getCampaignResultSchema = z
  .object({
    id: nullableString,
    name: nullableString,
    reference: nullableString,
    status: nullableString,
    description: nullableString,
    target_date: nullableString,
    profile: profileRefSchema.nullable(),
    objectives: nullableString,
    keywords: nullableString,
    target_audience: nullableString,
    tone: nullableString,
    total_articles: nullableNumber,
  })
  .strict();

export const campaignArticleSchema = z
  .object({
    id: nullableString,
    name: nullableString,
    live_url: nullableString,
    article_page_url: nullableString,
    status: z
      .object({ name: nullableString, prefix: nullableString, effective_at: nullableString })
      .strict()
      .nullable(),
    outlet: outletRefSchema.nullable(),
    includes: z.array(includeSchema).nullable(),
    expected_completion_date: nullableString,
  })
  .strict();

export const listCampaignArticlesResultSchema = z
  .object({ records: z.array(campaignArticleSchema), total_records: nullableNumber })
  .strict();

export const getCampaignArticleStatusResultSchema = z
  .object({
    statuses: z
      .array(z.object({ name: nullableString, prefix: nullableString, count: z.number() }).strict()),
  })
  .strict();

export const DIRECTORY_RESULT_SCHEMAS = {
  get_user: getUserResultSchema,
  list_teams: listTeamsResultSchema,
  get_team: getTeamResultSchema,
  list_profiles: listProfilesResultSchema,
  list_profile_orders: listProfileOrdersResultSchema,
  get_order: getOrderResultSchema,
  list_campaigns: listCampaignsResultSchema,
  get_campaign: getCampaignResultSchema,
  list_campaign_articles: listCampaignArticlesResultSchema,
  get_campaign_article_status: getCampaignArticleStatusResultSchema,
} as const satisfies Record<DirectoryToolName, DirectoryResultSchema>;

export type GetUserResult = z.infer<typeof getUserResultSchema>;
export type ListTeamsResult = z.infer<typeof listTeamsResultSchema>;
export type GetTeamResult = z.infer<typeof getTeamResultSchema>;
export type ListProfilesResult = z.infer<typeof listProfilesResultSchema>;
export type ListProfileOrdersResult = z.infer<typeof listProfileOrdersResultSchema>;
export type GetOrderResult = z.infer<typeof getOrderResultSchema>;
export type ListCampaignsResult = z.infer<typeof listCampaignsResultSchema>;
export type GetCampaignResult = z.infer<typeof getCampaignResultSchema>;
export type ListCampaignArticlesResult = z.infer<typeof listCampaignArticlesResultSchema>;
export type GetCampaignArticleStatusResult = z.infer<typeof getCampaignArticleStatusResultSchema>;
