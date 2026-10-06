import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import type { ServerOptions, ToolExtraLike } from '../../utils/tool-context.js';
import type { DirectoryResultSchema } from '../output-schemas.js';
import type { DirectoryToolName } from '../policy.js';

export const DIRECTORY_READ_ONLY_ANNOTATIONS: ToolAnnotations = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

export const DIRECTORY_READ_ONLY_ANNOTATION_REASON =
  "Performs a single GET against the caller's own Presscart account data, with no mutation, no financial effect, and no interaction outside Presscart.";

export const DIRECTORY_LIST_LIMIT_MAX = 25;

export const directoryPaginationSchema = {
  limit: z
    .number()
    .int()
    .positive()
    .max(DIRECTORY_LIST_LIMIT_MAX)
    .optional()
    .describe(`Records per page, at most ${DIRECTORY_LIST_LIMIT_MAX}. Defaults to 25.`),
  page: z.number().int().positive().optional().describe('1-based page number.'),
};

export type DirectoryToolHandler = (
  input: Record<string, unknown>,
  extra: ToolExtraLike,
  options: ServerOptions
) => Promise<unknown>;

export type DirectoryToolDefinition = Readonly<{
  name: DirectoryToolName;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  outputSchema: DirectoryResultSchema;
  annotations: ToolAnnotations;
  annotationReason: string;
  handler: DirectoryToolHandler;
}>;

export function defineDirectoryTool<
  Shape extends z.ZodRawShape,
  Output extends DirectoryResultSchema,
>(config: {
  name: DirectoryToolName;
  title: string;
  description: string;
  inputSchema: Shape;
  outputSchema: Output;
  handler: (
    input: z.infer<z.ZodObject<Shape>>,
    extra: ToolExtraLike,
    options: ServerOptions
  ) => Promise<z.infer<Output>>;
}): DirectoryToolDefinition {
  const inputObject = z.object(config.inputSchema);
  return Object.freeze({
    name: config.name,
    title: config.title,
    description: config.description,
    inputSchema: config.inputSchema,
    outputSchema: config.outputSchema,
    annotations: DIRECTORY_READ_ONLY_ANNOTATIONS,
    annotationReason: DIRECTORY_READ_ONLY_ANNOTATION_REASON,
    // The SDK already validated the input; re-parsing narrows it to the typed
    // shape without a cast and strips anything the shape does not name.
    handler: (input, extra, options) => config.handler(inputObject.parse(input), extra, options),
  });
}

// Real team slugs are a 10-char nanoid or a slugify() of the team name, so punctuation such as
// `.`, `'` or `~` is legitimate. Reject only whitespace, control characters and URL-structural ones.
const DIRECTORY_TEAM_SLUG_PATTERN = /^[^\s/\\?#%&=\u0000-\u001f\u007f]+$/;

export const directoryTeamSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(DIRECTORY_TEAM_SLUG_PATTERN, 'team_slug must not contain whitespace, control characters, or / \\ ? # % & =')
  .refine(slug => !/^\.+$/.test(slug), {
    message: 'team_slug must not consist only of dots (path traversal)',
  })
  .describe('Team slug from list_teams, used to scope app workflow routes.');
