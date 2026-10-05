import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { PresscartApiError } from '../../api.js';
import { formatServerError } from '../../utils/errors.js';
import type { ServerOptions } from '../../utils/tool-context.js';
import { DIRECTORY_PROFILES, type DirectoryProfile, type DirectoryToolName } from '../policy.js';
import { getTeamTool, getUserTool, listProfilesTool, listTeamsTool } from './account.js';
import {
  getCampaignArticleStatusTool,
  getCampaignTool,
  listCampaignArticlesTool,
  listCampaignsTool,
} from './campaigns.js';
import type { DirectoryToolDefinition } from './definition.js';
import { getOrderTool, listProfileOrdersTool } from './orders.js';

export type { DirectoryToolDefinition } from './definition.js';

const DIRECTORY_TOOL_DEFINITION_LIST: readonly DirectoryToolDefinition[] = Object.freeze([
  getUserTool,
  listTeamsTool,
  getTeamTool,
  listProfilesTool,
  listProfileOrdersTool,
  getOrderTool,
  listCampaignsTool,
  getCampaignTool,
  listCampaignArticlesTool,
  getCampaignArticleStatusTool,
]);

export function assertDirectoryToolCoverage(
  profiles: readonly DirectoryProfile[],
  definitions: readonly DirectoryToolDefinition[]
) {
  const counts = new Map<string, number>();
  for (const definition of definitions) {
    counts.set(definition.name, (counts.get(definition.name) ?? 0) + 1);
  }

  for (const profile of profiles) {
    for (const name of profile.tools) {
      const count = counts.get(name) ?? 0;
      if (count !== 1) {
        throw new Error(
          `Directory profile "${profile.id}" lists tool "${name}" with ${count} definitions; expected exactly 1.`
        );
      }
    }
  }
}

// Fail closed at module load: every tool any profile exposes has exactly one definition.
assertDirectoryToolCoverage(Object.values(DIRECTORY_PROFILES), DIRECTORY_TOOL_DEFINITION_LIST);

export const DIRECTORY_TOOL_DEFINITIONS: ReadonlyMap<DirectoryToolName, DirectoryToolDefinition> =
  new Map(DIRECTORY_TOOL_DEFINITION_LIST.map(definition => [definition.name, definition]));

export function registerDirectoryTools(
  server: McpServer,
  profile: DirectoryProfile,
  options: ServerOptions
) {
  for (const name of profile.tools) {
    const definition = DIRECTORY_TOOL_DEFINITIONS.get(name);
    if (definition === undefined) {
      throw new Error(`Directory profile "${profile.id}" lists unknown tool "${name}".`);
    }
    registerDirectoryToolDefinition(server, definition, options);
  }
}

export function registerDirectoryToolDefinition(
  server: McpServer,
  definition: DirectoryToolDefinition,
  options: ServerOptions
) {
  server.registerTool(
    definition.name,
    {
      title: definition.title,
      description: definition.description,
      inputSchema: definition.inputSchema,
      outputSchema: definition.outputSchema,
      annotations: definition.annotations,
    },
    async (input, extra): Promise<CallToolResult> => {
      try {
        const output = await definition.handler(input, extra, options);
        // Validate here as well as in the SDK: the SDK's own failure message names
        // the offending keys, while this boundary returns only a generic message.
        const parsed = definition.outputSchema.safeParse(output);
        if (!parsed.success) {
          logDirectoryToolFailure(definition.name, 'output failed schema validation');
          return directoryToolError(new Error('Directory tool output failed schema validation.'));
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(parsed.data, null, 2) }],
          structuredContent: parsed.data,
        };
      } catch (error) {
        if (!(error instanceof PresscartApiError)) {
          logDirectoryToolFailure(definition.name, error instanceof Error ? error.name : typeof error);
        }
        return directoryToolError(error);
      }
    }
  );
}

export function formatDirectoryToolError(error: unknown) {
  if (
    error instanceof PresscartApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 401 &&
    error.status !== 403 &&
    error.status !== 404
  ) {
    return `Presscart API rejected the request (${error.status})`;
  }

  return formatServerError(error);
}

function directoryToolError(error: unknown): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: formatDirectoryToolError(error) }],
  };
}

function logDirectoryToolFailure(tool: DirectoryToolName, reason: string) {
  console.error(JSON.stringify({ message: 'Directory tool failed.', tool, reason }));
}
