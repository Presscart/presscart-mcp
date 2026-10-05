import { z } from 'zod';

import { teamRoute } from '../../utils/team-routes.js';
import { createPresscartApiClient } from '../../utils/tool-context.js';
import {
  getCampaignArticleStatusResultSchema,
  getCampaignResultSchema,
  listCampaignArticlesResultSchema,
  listCampaignsResultSchema,
} from '../output-schemas.js';
import {
  buildGetCampaignArticleStatusResult,
  buildGetCampaignResult,
  buildListCampaignArticlesResult,
  buildListCampaignsResult,
} from '../results.js';
import { defineDirectoryTool, directoryPaginationSchema, directoryTeamSlugSchema } from './definition.js';

const campaignIdSchema = z
  .string()
  .uuid()
  .describe('Campaign id from list_campaigns or get_order.');

export const listCampaignsTool = defineDirectoryTool({
  name: 'list_campaigns',
  title: 'List Campaigns',
  description:
    "List a profile's campaigns: id, name, reference, created and updated dates, article_count, and published_count (articles with a live URL). Requires team_slug from list_teams and profile_id from list_profiles. Next: get_campaign for details, list_campaign_articles for each article's status.",
  inputSchema: {
    team_slug: directoryTeamSlugSchema,
    profile_id: z.string().uuid().describe('Profile id from list_profiles or list_teams.'),
    ...directoryPaginationSchema,
    search: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe('Optional text to match against campaign names.'),
  },
  outputSchema: listCampaignsResultSchema,
  handler: async (input, extra, options) => {
    const api = createPresscartApiClient(extra, options);
    const response = await api.get<unknown>(
      teamRoute(input.team_slug, `/profiles/${encodeURIComponent(input.profile_id)}/campaigns`),
      { limit: input.limit, page: input.page, search: input.search }
    );
    return buildListCampaignsResult(response);
  },
});

export const getCampaignTool = defineDirectoryTool({
  name: 'get_campaign',
  title: 'Get Campaign',
  description:
    'Get one campaign by campaign_id: name, reference, status, description, target date, profile (id and name), objectives, keywords, target audience, tone, and total article count. Requires team_slug from list_teams and campaign_id from list_campaigns or get_order.',
  inputSchema: { team_slug: directoryTeamSlugSchema, campaign_id: campaignIdSchema },
  outputSchema: getCampaignResultSchema,
  handler: async (input, extra, options) => {
    const api = createPresscartApiClient(extra, options);
    const response = await api.get<unknown>(
      teamRoute(input.team_slug, `/campaigns/${encodeURIComponent(input.campaign_id)}`)
    );
    return buildGetCampaignResult(response);
  },
});

export const listCampaignArticlesTool = defineDirectoryTool({
  name: 'list_campaign_articles',
  title: 'List Campaign Articles',
  description:
    "List a campaign's articles: title, current status, publication name and website, placement details, expected completion date, live_url once published, and article_page_url (the article's Presscart page, returned only when profile_id is provided). Requires team_slug from list_teams and campaign_id from list_campaigns. Use get_campaign_article_status when only counts are needed.",
  inputSchema: {
    team_slug: directoryTeamSlugSchema,
    campaign_id: campaignIdSchema,
    profile_id: z
      .string()
      .uuid()
      .optional()
      .describe('Optional profile id; when provided, each article includes article_page_url.'),
    ...directoryPaginationSchema,
  },
  outputSchema: listCampaignArticlesResultSchema,
  handler: async (input, extra, options) => {
    const api = createPresscartApiClient(extra, options);
    const response = await api.get<unknown>(
      teamRoute(input.team_slug, `/campaigns/${encodeURIComponent(input.campaign_id)}/articles`),
      { limit: input.limit, page: input.page }
    );
    return buildListCampaignArticlesResult(response, {
      teamSlug: input.team_slug,
      campaignId: input.campaign_id,
      profileId: input.profile_id,
    });
  },
});

export const getCampaignArticleStatusTool = defineDirectoryTool({
  name: 'get_campaign_article_status',
  title: 'Get Campaign Article Status',
  description:
    "Count a campaign's articles by status (name, prefix, count; statuses with no articles are omitted). Requires team_slug from list_teams and campaign_id from list_campaigns. Use list_campaign_articles for per-article detail.",
  inputSchema: { team_slug: directoryTeamSlugSchema, campaign_id: campaignIdSchema },
  outputSchema: getCampaignArticleStatusResultSchema,
  handler: async (input, extra, options) => {
    const api = createPresscartApiClient(extra, options);
    const response = await api.get<unknown>(
      teamRoute(
        input.team_slug,
        `/campaigns/${encodeURIComponent(input.campaign_id)}/articles/status-count`
      )
    );
    return buildGetCampaignArticleStatusResult(response);
  },
});
