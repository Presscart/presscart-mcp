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
