import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  createPresscartApiClient,
  requirePermission,
  type ServerOptions,
} from '../utils/tool-context.js';
import {
  buildPublisherArticlePageUrl,
  getArticleLiveUrl,
  omitInternalArticleUrls,
} from '../utils/article-urls.js';
import { appendQueryFilters, type QueryParams } from '../utils/query-filters.js';
import { assertGoogleDocUrl } from '../utils/file-upload.js';
import { jsonResult } from '../utils/tool-result.js';
import { teamRoute } from '../utils/team-routes.js';
import { readOnlyTool, replaceTool, updateTool } from './metadata.js';
import { paginationSchema, sortSchema, teamSlugSchema } from './schemas.js';

const articleSourceSchema = z.enum(['google_doc', 'file_attachment']);
const publisherArticleStatusSchema = z.enum([
  'pending-publishing',
  'publishing',
  'completed',
  'published',
  'revision-requested',
  'needs-info',
  'rejected',
]);

const articleFileInputSchema = {
  team_slug: teamSlugSchema,
  article_id: z.string().uuid(),
  source: articleSourceSchema,
  google_doc_url: z.string().trim().url().optional(),
  file_id: z.string().uuid().optional(),
};

type ArticleFileInput = z.infer<z.ZodObject<typeof articleFileInputSchema>>;

export function registerArticleTools(server: McpServer, options: ServerOptions) {
  server.registerTool(
    'list_publisher_articles',
    {
      title: 'List Publisher Articles',
      description:
        'List publisher-owned content/articles for a publisher team, matching the dashboard publisher content page. Use this when a publisher asks for their content, submitted articles, published content, articles needing updates, content status, or article URLs. This does not list buyer campaign articles; use list_campaign_articles after selecting a buyer campaign. When the user asks for an article URL, use article_page_url for the Presscart article page and live_url only when available; do not present brief or draft document links as article URLs.',
      inputSchema: {
        team_slug: teamSlugSchema,
        ...paginationSchema,
        ...sortSchema,
        include_archived: z.boolean().optional(),
        filters: z
          .object({
            search: z.string().trim().min(1).optional(),
            status: z
              .union([publisherArticleStatusSchema, z.array(publisherArticleStatusSchema)])
              .optional(),
            overdue: z.boolean().optional(),
            start_date: z
              .string()
              .trim()
              .min(1)
              .optional()
              .describe('Filter by start date using the API-supported date format.'),
            end_date: z
              .string()
              .trim()
              .min(1)
              .optional()
              .describe('Filter by end date using the API-supported date format.'),
            product_ids: z
              .array(z.string().uuid())
              .optional()
              .describe('Filter to publisher articles for specific product IDs.'),
          })
          .optional()
          .describe('Publisher-safe article filters from the dashboard content page.'),
      },
      annotations: readOnlyTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'articles.lists');
      const api = createPresscartApiClient(extra, options);
      const { team_slug, filters, ...params } = input;
      const query = appendQueryFilters(params as QueryParams, filters);
      const response = await api.get(teamRoute(team_slug, '/articles'), query);
      return jsonResult(withPublisherArticleUrls(response));
    }
  );

  server.registerTool(
    'upload_article',
    {
      title: 'Upload Article',
      description:
        'Use when the user already wrote their own article and wants to submit that article for review. For an uploaded file, call upload_files first and pass source=file_attachment with the returned file_id. For a Google Doc, pass source=google_doc with an HTTPS docs.google.com URL. Do not use this when the article has a writing add-on or the user wants Presscart internal writers to write the article; use request_article_writing instead.',
      inputSchema: articleFileInputSchema,
      annotations: updateTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'articles.update');
      const api = createPresscartApiClient(extra, options);
      const body = buildArticleFileBody(input);
      const response = await api.post(
        teamRoute(input.team_slug, `/articles/${input.article_id}/upload-own-article`),
        body
      );
      return jsonResult(response);
    }
  );

  server.registerTool(
    'replace_article_file',
    {
      title: 'Replace Article File',
      description:
        'Use when the user already submitted their own article and wants to replace it with a newer article file or Google Doc. For an uploaded file, call upload_files first and pass source=file_attachment with the returned file_id. For a Google Doc, pass source=google_doc with an HTTPS docs.google.com URL. Do not use this for internal writer requests.',
      inputSchema: articleFileInputSchema,
      annotations: replaceTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'articles.update');
      const api = createPresscartApiClient(extra, options);
      const body = buildArticleFileBody(input);
      const response = await api.post(
        teamRoute(input.team_slug, `/articles/${input.article_id}/replace-file`),
        body
      );
      return jsonResult(response);
    }
  );

  server.registerTool(
    'submit_article',
    {
      title: 'Submit Article',
      description:
        'Submit an article workflow action only after the user has confirmed the article is ready for the next step. Use draft-ready-for-review when the uploaded or written draft should be reviewed, and pending-publishing when the user has approved the draft for publishing.',
      inputSchema: {
        team_slug: teamSlugSchema,
        article_id: z.string().uuid(),
        action: z.enum(['draft-ready-for-review', 'pending-publishing']),
        feedback: z.string().trim().nullable().optional(),
      },
      annotations: updateTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'articles.update');
      const api = createPresscartApiClient(extra, options);
      const response = await api.post(teamRoute(input.team_slug, `/articles/${input.article_id}/submit`), {
        action: input.action,
        feedback: input.feedback ?? null,
      });
      return jsonResult(response);
    }
  );

  server.registerTool(
    'request_article_writing',
    {
      title: 'Request Article Writing',
      description:
        'Use when the user does not have their own written article, the article has a writing add-on, or the user wants Presscart internal writers to write it. This starts the internal writing flow for the article. If the campaign questionnaire is missing, call upload_campaign_questionnaire first or ask the user for the questionnaire. Do not use upload_article unless the user is providing their own finished article file or Google Doc.',
      inputSchema: {
        team_slug: teamSlugSchema,
        article_id: z.string().uuid(),
      },
      annotations: updateTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'articles.update');
      const api = createPresscartApiClient(extra, options);
      const response = await api.patch(
        teamRoute(input.team_slug, `/articles/${input.article_id}/request-writing`)
      );
      return jsonResult(response);
    }
  );
}

function buildArticleFileBody(input: ArticleFileInput) {
  if (input.source === 'google_doc') {
    if (!input.google_doc_url || input.file_id) {
      throw new Error('For source=google_doc, provide google_doc_url and do not provide file_id.');
    }

    assertGoogleDocUrl(input.google_doc_url);
    return {
      source: input.source,
      google_doc_url: input.google_doc_url,
      file_id: null,
    };
  }

  if (!input.file_id || input.google_doc_url) {
    throw new Error('For source=file_attachment, provide file_id and do not provide google_doc_url.');
  }

  return {
    source: input.source,
    google_doc_url: null,
    file_id: input.file_id,
  };
}

function withPublisherArticleUrls(data: unknown) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;

  const response = data as Record<string, unknown>;
  if (!Array.isArray(response.records)) return data;

  return {
    ...response,
    records: response.records.map((record) => {
      if (!record || typeof record !== 'object' || Array.isArray(record)) return record;

      const article = record as Record<string, unknown>;
      if (typeof article.id !== 'string') return record;

      return {
        ...omitInternalArticleUrls(article),
        article_page_url: buildPublisherArticlePageUrl(article.id),
        live_url: getArticleLiveUrl(article),
      };
    }),
  };
}
