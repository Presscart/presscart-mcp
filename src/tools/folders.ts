import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  createPresscartApiClient,
  requirePermission,
  type ServerOptions,
} from '../utils/tool-context.js';
import { teamRoute } from '../utils/team-routes.js';
import { jsonResult } from '../utils/tool-result.js';
import { additiveWriteTool, readOnlyTool, replaceTool, updateTool } from './metadata.js';
import { teamSlugSchema } from './schemas.js';

const folderNameSchema = z.string().trim().min(1).describe('Folder name in the media library.');

export function registerFolderTools(server: McpServer, options: ServerOptions) {
  server.registerTool(
    'list_folders',
    {
      title: 'List Folders',
      description:
        'List folders in the team media library. Use this before upload_files when the user wants uploaded files placed into an existing folder.',
      inputSchema: {
        team_slug: teamSlugSchema,
        q: z.string().trim().min(1).optional().describe('Optional folder name search.'),
      },
      annotations: readOnlyTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'folders.lists');
      const api = createPresscartApiClient(extra, options);
      const response = await api.get(teamRoute(input.team_slug, '/folders'), {
        q: input.q,
      });
      return jsonResult(response);
    }
  );

  server.registerTool(
    'create_folder',
    {
      title: 'Create Folder',
      description:
        'Create a folder in the team media library for organizing uploaded files. Use the returned folder id as folder_id in upload_files.',
      inputSchema: {
        team_slug: teamSlugSchema,
        name: folderNameSchema,
      },
      annotations: additiveWriteTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'folders.create');
      const api = createPresscartApiClient(extra, options);
      const response = await api.post(teamRoute(input.team_slug, '/folders'), {
        name: input.name,
      });
      return jsonResult(response);
    }
  );

  server.registerTool(
    'rename_folder',
    {
      title: 'Rename Folder',
      description: 'Rename a folder in the team media library. This does not move or modify files.',
      inputSchema: {
        team_slug: teamSlugSchema,
        folder_id: z.string().uuid(),
        name: folderNameSchema,
      },
      annotations: updateTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'folders.update');
      const api = createPresscartApiClient(extra, options);
      const response = await api.patch(teamRoute(input.team_slug, `/folders/${input.folder_id}`), {
        name: input.name,
      });
      return jsonResult(response);
    }
  );

  server.registerTool(
    'archive_folder',
    {
      title: 'Archive Folder',
      description:
        'Archive a folder in the team media library. This soft-deletes the folder only; files inside the folder are not deleted. Use only after the user confirms.',
      inputSchema: {
        team_slug: teamSlugSchema,
        folder_id: z.string().uuid(),
      },
      annotations: replaceTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'folders.delete');
      const api = createPresscartApiClient(extra, options);
      const response = await api.delete(teamRoute(input.team_slug, `/folders/${input.folder_id}`));
      return jsonResult(response);
    }
  );
}
