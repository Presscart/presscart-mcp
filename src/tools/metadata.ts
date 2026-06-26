import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

export const readOnlyTool: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
};

export const additiveWriteTool: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

export const updateTool: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

export const replaceTool: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

export const getUserOutputSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    email: z.string().email().optional(),
    team_id: z.string().uuid().optional(),
    token_type: z.string().optional(),
    pro_pricing_enabled: z.boolean().optional(),
  })
  .passthrough();

export const addOrderItemsToCampaignOutputSchema = z
  .object({
    campaign_id: z.string().uuid(),
    message: z.string().optional(),
    next_step: z.string().optional(),
    article_queue_available: z.boolean().optional(),
    article_queue_error: z.string().optional(),
    article_queue: z.array(z.unknown()).optional(),
    status_counts: z.record(z.string(), z.number().int().nonnegative()).optional(),
    recommended_article_id: z.string().uuid().nullable().optional(),
  })
  .passthrough();
