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
import {
  additiveWriteTool,
  addOrderItemsToCampaignOutputSchema,
  readOnlyTool,
  updateTool,
} from './metadata.js';
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
      annotations: additiveWriteTool,
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
      annotations: readOnlyTool,
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
      annotations: readOnlyTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'campaigns.read');
      const api = createPresscartApiClient(extra, options);
      const response = await api.get(teamRoute(input.team_slug, `/campaigns/${input.campaign_id}`));
      return jsonResult(response);
    }
  );

  server.registerTool(
    'add_order_items_to_campaign',
    {
      title: 'Add Order Items To Campaign',
      description:
        'Add all eligible unassigned paid items from an order to a campaign. If the user wants an existing campaign, call list_campaigns first and pass campaign_id. If the user wants a new campaign, pass campaign_name. If the user has not said whether to use a new or existing campaign, ask before calling this tool. Provide exactly one of campaign_id or campaign_name.',
      inputSchema: {
        team_slug: teamSlugSchema,
        profile_id: z.string().uuid(),
        order_id: z.string().uuid(),
        campaign_id: z.string().uuid().optional(),
        campaign_name: z.string().trim().min(1).optional(),
      },
      outputSchema: addOrderItemsToCampaignOutputSchema,
      annotations: updateTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'campaigns.update');
      const hasCampaignId = Boolean(input.campaign_id);
      const hasCampaignName = Boolean(input.campaign_name);

      if (hasCampaignId === hasCampaignName) {
        throw new Error('Provide exactly one of campaign_id or campaign_name.');
      }

      const api = createPresscartApiClient(extra, options);
      const profileId = resolveProfileId(input.profile_id);
      const response = await api.post<UploadContentResponse>(
        teamRoute(input.team_slug, '/campaigns/upload-content'),
        {
          profile_id: profileId,
          order_id: input.order_id,
          ...(input.campaign_id
            ? { campaign_id: input.campaign_id }
            : { campaign_name: input.campaign_name }),
        }
      );

      const articleQueue = await readCampaignArticleQueue(api, input.team_slug, response.campaign_id);
      return jsonResult(buildAddOrderItemsToCampaignResult(response, articleQueue));
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
      annotations: readOnlyTool,
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

type UploadContentResponse = {
  campaign_id: string;
};

type CampaignArticleStatus = {
  name?: string | null;
  prefix?: string | null;
};

type CampaignArticleRecord = {
  id?: string;
  name?: string | null;
  status?: CampaignArticleStatus[] | null;
  expected_completion_date_title?: string | null;
  expected_completion_date?: string | null;
  order_item?: {
    name?: string | null;
    addons?: {
      name?: string | null;
    }[] | null;
    outlet?: {
      name?: string | null;
    } | null;
  } | null;
};

type CampaignArticlesResponse = {
  records?: CampaignArticleRecord[];
  total_records?: number;
};

type ArticleQueueResult =
  | {
      available: true;
      records: CampaignArticleRecord[];
      total_records: number;
    }
  | {
      available: false;
      reason: string;
    };

type ArticleQueueItem = {
  article_id?: string;
  name: string | null | undefined;
  product_name: string | null;
  outlet_name: string | null;
  addons: string[];
  has_addons: boolean;
  status: string | null;
  status_prefix: string | null;
  expected_completion_date_title: string | null;
  expected_completion_date: string | null;
};

async function readCampaignArticleQueue(
  api: ReturnType<typeof createPresscartApiClient>,
  teamSlug: string,
  campaignId: string
): Promise<ArticleQueueResult> {
  try {
    const response = await api.get<CampaignArticlesResponse>(
      teamRoute(teamSlug, `/campaigns/${campaignId}/articles`),
      {
        limit: 25,
        page: 1,
        sort_by: 'created_at',
        order_by: 'desc',
      }
    );

    return {
      available: true,
      records: response.records ?? [],
      total_records: response.total_records ?? response.records?.length ?? 0,
    };
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : 'Unable to load campaign articles.',
    };
  }
}

export function buildAddOrderItemsToCampaignResult(
  response: UploadContentResponse,
  articleQueue: ArticleQueueResult
) {
  if (!articleQueue.available) {
    return {
      campaign_id: response.campaign_id,
      message: 'Order items were added to the campaign.',
      next_step:
        'Open the campaign article list before telling the user which article to work on next.',
      article_queue_available: false,
      article_queue_error: articleQueue.reason,
    };
  }

  const articles: ArticleQueueItem[] = articleQueue.records.map(article => {
    const latestStatus = article.status?.[0];
    return {
      article_id: article.id,
      name: article.name,
      product_name: article.order_item?.name ?? null,
      outlet_name: article.order_item?.outlet?.name ?? null,
      addons: article.order_item?.addons?.map(addon => addon.name).filter(isString) ?? [],
      has_addons: Boolean(article.order_item?.addons?.length),
      status: latestStatus?.name ?? null,
      status_prefix: latestStatus?.prefix ?? null,
      expected_completion_date_title: article.expected_completion_date_title ?? null,
      expected_completion_date: article.expected_completion_date ?? null,
    };
  });

  const recommendedArticle = pickRecommendedArticle(articles);
  const status_counts = countArticleStatuses(articles);

  return {
    campaign_id: response.campaign_id,
    message: `Order items were added to the campaign. The campaign now has ${articleQueue.total_records} article${articleQueue.total_records === 1 ? '' : 's'}.`,
    next_step: buildNextStep(articles.length, recommendedArticle),
    article_queue: articles,
    status_counts,
    recommended_article_id: recommendedArticle?.article_id ?? null,
  };
}

function buildNextStep(articleCount: number, recommendedArticle: ArticleQueueItem | undefined) {
  if (articleCount === 0) {
    return 'No campaign articles were returned yet. Refresh the campaign articles before giving the user a next step.';
  }

  if (!recommendedArticle) {
    return 'Review the campaign article queue and ask the user which article they want to work on first.';
  }

  const articleLabel = recommendedArticle.name ?? recommendedArticle.product_name ?? 'the first article';
  const appApprovalMessage =
    'Approve it in the application so you can review the content thoroughly before moving it forward.';
  const hasAddOns = recommendedArticle.has_addons;

  if (
    recommendedArticle.status_prefix === 'brief-ready-for-review' ||
    recommendedArticle.status_prefix === 'draft-ready-for-review'
  ) {
    return `${articleLabel} is ready for review. ${appApprovalMessage}`;
  }

  if (recommendedArticle.status_prefix === 'pending-content-brief') {
    return `${articleLabel} is queued for internal writing. The user does not need to upload their own article for this item; wait for the brief or draft to be ready for review.`;
  }

  if (hasAddOns) {
    const addOnLabel = recommendedArticle.addons.length
      ? ` Add-ons: ${recommendedArticle.addons.join(', ')}.`
      : '';
    return `${articleLabel} includes an add-on, so suggest request_article_writing instead of asking the user to upload their own article.${addOnLabel}`;
  }

  if (
    recommendedArticle.status_prefix === 'request-revision' ||
    recommendedArticle.status_prefix === 'needs-info' ||
    recommendedArticle.status_prefix === 'brief-update-requested' ||
    recommendedArticle.status_prefix === 'draft-update-requested' ||
    recommendedArticle.status_prefix === 'rejected'
  ) {
    return `${articleLabel} needs a user response before it can move forward. Current status: ${recommendedArticle.status ?? 'unknown'}.`;
  }

  if (articleCount === 1) {
    return `Start working on ${articleLabel}. Current status: ${recommendedArticle.status ?? 'unknown'}.`;
  }

  return `Start with ${articleLabel}. It is the first actionable article in the campaign queue. Current status: ${recommendedArticle.status ?? 'unknown'}.`;
}

function pickRecommendedArticle(articles: ArticleQueueItem[]) {
  return [...articles].sort((left, right) => {
    return getStatusPriority(left.status_prefix) - getStatusPriority(right.status_prefix);
  })[0];
}

function getStatusPriority(statusPrefix: string | null | undefined) {
  switch (statusPrefix) {
    case 'action-required':
      return 0;
    case 'brief-update-requested':
    case 'draft-update-requested':
    case 'request-revision':
    case 'needs-info':
    case 'rejected':
      return 1;
    case 'brief-ready-for-review':
    case 'draft-ready-for-review':
      return 2;
    case 'pending-content-brief':
      return 3;
    case 'pending-publishing':
      return 4;
    default:
      return 5;
  }
}

function countArticleStatuses(articles: ArticleQueueItem[]) {
  return articles.reduce<Record<string, number>>((counts, article) => {
    const key = article.status_prefix ?? 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function isString(value: string | null | undefined): value is string {
  return typeof value === 'string';
}
