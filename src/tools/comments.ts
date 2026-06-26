import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  createPresscartApiClient,
  requirePermission,
  type ServerOptions,
} from '../utils/tool-context.js';
import { appendQueryFilters, type QueryParams } from '../utils/query-filters.js';
import { teamRoute } from '../utils/team-routes.js';
import { jsonResult } from '../utils/tool-result.js';
import { additiveWriteTool, readOnlyTool, replaceTool, updateTool } from './metadata.js';
import { paginationSchema, sortSchema, teamSlugSchema } from './schemas.js';

const commentEntityTypeSchema = z
  .string()
  .trim()
  .min(1)
  .describe('Entity type being commented on. For article comments, use article.');

const mentionUsersSchema = z
  .array(z.string().uuid())
  .optional()
  .describe('User IDs to mention in the comment.');

export function registerCommentTools(server: McpServer, options: ServerOptions) {
  server.registerTool(
    'list_comments',
    {
      title: 'List Comments',
      description:
        'List comments for an entity such as an article. Use entity_type=article and entity_id=<article_id> for article comments. Returns root comments with replies by default.',
      inputSchema: {
        team_slug: teamSlugSchema,
        entity_type: commentEntityTypeSchema,
        entity_id: z.string().uuid(),
        is_internal: z.boolean().optional(),
        parent_comment_id: z.string().trim().min(1).optional(),
        search: z.string().trim().min(1).optional(),
        include_replies: z.boolean().optional(),
        ...paginationSchema,
        ...sortSchema,
        include_archived: z.boolean().optional(),
      },
      annotations: readOnlyTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'comments.lists');
      const api = createPresscartApiClient(extra, options);
      const { team_slug, entity_type, entity_id, is_internal, parent_comment_id, search, ...query } =
        input;

      const response = await api.get(
        teamRoute(team_slug, '/comments'),
        appendQueryFilters(
          {
            limit: query.limit,
            page: query.page,
            sort_by: query.sort_by,
            order_by: query.order_by,
            include_archived: query.include_archived,
          } as QueryParams,
          {
            entity_type,
            entity_id,
            is_internal,
            parent_comment_id,
            search,
            include_replies: query.include_replies ?? true,
          }
        )
      );
      return jsonResult(response);
    }
  );

  server.registerTool(
    'get_comment',
    {
      title: 'Get Comment',
      description: 'Fetch one comment by its public comment ID/reference.',
      inputSchema: {
        team_slug: teamSlugSchema,
        comment_id: z.string().trim().min(1),
      },
      annotations: readOnlyTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'comments.read');
      const api = createPresscartApiClient(extra, options);
      const response = await api.get(teamRoute(input.team_slug, `/comments/${input.comment_id}`));
      return jsonResult(response);
    }
  );

  server.registerTool(
    'get_comments_count',
    {
      title: 'Get Comments Count',
      description: 'Get the number of comments for an entity such as an article.',
      inputSchema: {
        team_slug: teamSlugSchema,
        entity_type: commentEntityTypeSchema,
        entity_id: z.string().uuid(),
        is_internal: z.boolean().optional(),
      },
      annotations: readOnlyTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'comments.read');
      const api = createPresscartApiClient(extra, options);
      const response = await api.get(teamRoute(input.team_slug, '/comments/count'), {
        entity_type: input.entity_type,
        entity_id: input.entity_id,
        is_internal: input.is_internal,
      });
      return jsonResult(response);
    }
  );

  server.registerTool(
    'create_comment',
    {
      title: 'Create Comment',
      description:
        'Create a comment or reply on an entity. For article comments, use entity_type=article and entity_id=<article_id>. Pass parent_comment_id to reply to an existing comment. The tool accepts plain comment_text and formats it for the application.',
      inputSchema: {
        team_slug: teamSlugSchema,
        entity_type: commentEntityTypeSchema,
        entity_id: z.string().uuid(),
        comment_text: z.string().trim().min(1),
        is_internal: z.boolean().optional(),
        parent_comment_id: z.string().trim().min(1).nullable().optional(),
        mention_user_ids: mentionUsersSchema,
      },
      annotations: additiveWriteTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'comments.create');
      const api = createPresscartApiClient(extra, options);
      const response = await api.post(teamRoute(input.team_slug, '/comments'), {
        ...buildCommentContent(input.comment_text),
        is_internal: input.is_internal ?? false,
        entity_type: input.entity_type,
        entity_id: input.entity_id,
        parent_comment_id: input.parent_comment_id ?? null,
        mentions: toMentions(input.mention_user_ids),
      });
      return jsonResult(response);
    }
  );

  server.registerTool(
    'update_comment',
    {
      title: 'Update Comment',
      description:
        'Update one of the current user comments. Only the original comment author can update it. Pass comment_text when changing the body, and pass is_internal when changing visibility.',
      inputSchema: {
        team_slug: teamSlugSchema,
        comment_id: z.string().trim().min(1),
        comment_text: z.string().trim().min(1).optional(),
        is_internal: z.boolean().optional(),
        mention_user_ids: mentionUsersSchema,
      },
      annotations: updateTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'comments.update');
      if (input.comment_text === undefined && input.is_internal === undefined) {
        throw new Error('Provide comment_text or is_internal to update a comment.');
      }

      const api = createPresscartApiClient(extra, options);
      const response = await api.put(teamRoute(input.team_slug, `/comments/${input.comment_id}`), {
        ...(input.comment_text ? buildCommentContent(input.comment_text) : {}),
        ...(input.is_internal === undefined ? {} : { is_internal: input.is_internal }),
        mentions: toMentions(input.mention_user_ids),
      });
      return jsonResult(response);
    }
  );

  server.registerTool(
    'archive_comment',
    {
      title: 'Archive Comment',
      description:
        'Archive one of the current user comments. This soft-deletes the comment in the application and should only be used after the user confirms.',
      inputSchema: {
        team_slug: teamSlugSchema,
        comment_id: z.string().trim().min(1),
      },
      annotations: replaceTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'comments.delete');
      const api = createPresscartApiClient(extra, options);
      const response = await api.delete(teamRoute(input.team_slug, `/comments/${input.comment_id}/archive`));
      return jsonResult(response);
    }
  );

  server.registerTool(
    'get_comment_mention_suggestions',
    {
      title: 'Get Comment Mention Suggestions',
      description:
        'Find users that can be mentioned on an article comment. Use this before create_comment or update_comment when the user wants to mention someone by name.',
      inputSchema: {
        team_slug: teamSlugSchema,
        article_id: z.string().uuid(),
        search: z.string().trim().min(1).optional(),
      },
      annotations: readOnlyTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'comments.read');
      const api = createPresscartApiClient(extra, options);
      const response = await api.get(teamRoute(input.team_slug, '/comments/mentions/suggestions'), {
        article_id: input.article_id,
        team_slug: input.team_slug,
        search: input.search,
      });
      return jsonResult(response);
    }
  );

  server.registerTool(
    'list_comment_mentions',
    {
      title: 'List Comment Mentions',
      description:
        'List comment mentions for the current user. Use this to show unread or recent comment notifications.',
      inputSchema: {
        team_slug: teamSlugSchema,
        is_read: z.boolean().optional(),
        entity_type: commentEntityTypeSchema.optional(),
        entity_id: z.string().uuid().optional(),
        limit: z.number().int().positive().max(100).optional(),
        page: z.number().int().positive().optional(),
      },
      annotations: readOnlyTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'comments.read');
      const api = createPresscartApiClient(extra, options);
      const response = await api.get(teamRoute(input.team_slug, '/comments/mentions/me'), {
        limit: input.limit,
        page: input.page,
        is_read: input.is_read,
        entity_type: input.entity_type,
        entity_id: input.entity_id,
      });
      return jsonResult(response);
    }
  );

  server.registerTool(
    'mark_comment_mentions_read',
    {
      title: 'Mark Comment Mentions Read',
      description:
        'Mark current-user comment mentions as read. Provide either comment_ids, or both entity_type and entity_id.',
      inputSchema: {
        team_slug: teamSlugSchema,
        comment_ids: z.array(z.string().uuid()).min(1).optional(),
        entity_type: commentEntityTypeSchema.optional(),
        entity_id: z.string().uuid().optional(),
      },
      annotations: updateTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'comments.update');
      const hasCommentIds = Boolean(input.comment_ids?.length);
      const hasEntity = Boolean(input.entity_type && input.entity_id);

      if (hasCommentIds === hasEntity) {
        throw new Error('Provide either comment_ids, or both entity_type and entity_id.');
      }

      const api = createPresscartApiClient(extra, options);
      const response = await api.post(teamRoute(input.team_slug, '/comments/mentions/mark-read'), {
        comment_ids: input.comment_ids,
        entity_type: input.entity_type,
        entity_id: input.entity_id,
      });
      return jsonResult(response);
    }
  );
}

function buildCommentContent(commentText: string) {
  const trimmed = commentText.trim();

  return {
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: trimmed }],
        },
      ],
    },
    content_html: `<p>${escapeHtml(trimmed)}</p>`,
  };
}

function toMentions(userIds: string[] | undefined) {
  return (userIds ?? []).map(user_id => ({ user_id }));
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
