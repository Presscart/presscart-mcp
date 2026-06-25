import { z } from 'zod';

export const teamSlugSchema = z
  .string()
  .trim()
  .min(1)
  .describe('Team slug from list_teams, used to scope app workflow routes.');

export const paginationSchema = {
  limit: z.number().int().positive().max(100).optional(),
  page: z.number().int().positive().optional(),
};

export const sortSchema = {
  sort_by: z.string().trim().min(1).optional(),
  order_by: z.enum(['asc', 'desc']).optional(),
};
