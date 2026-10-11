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

  // A Map keyed by name would silently drop a duplicate that no profile lists.
  for (const [name, count] of counts) {
    if (count > 1) {
      throw new Error(
        `Directory tool definition name "${name}" is defined ${count} times; names must be globally unique.`
      );
    }
  }
}

// Fail closed at module load: every tool any profile exposes has exactly one definition and
// no definition name is duplicated.
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

const MISSING_CREDENTIAL_MESSAGE_PREFIX = 'No Presscart API credential is bound to the MCP session';

export function formatDirectoryToolError(error: unknown) {
  if (error instanceof PresscartApiError) {
    if (error.status === 401 || error.status === 403) return 'Unauthorized';
    if (error.status === 404) return 'Presscart API resource not found';
    if (error.status === 504) return 'Presscart API request timed out';
    if (error.status >= 500) return 'Presscart API is unavailable';
    if (error.status >= 400 && error.status < 500) {
      return `Presscart API rejected the request (${error.status})`;
    }
    return 'Internal server error';
  }

  // createPresscartApiClient throws a plain Error when no credential is bound;
  // that is an auth failure. Matched by message prefix to leave legacy code untouched.
  if (error instanceof Error && error.message.startsWith(MISSING_CREDENTIAL_MESSAGE_PREFIX)) {
    return 'Unauthorized';
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
