import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  createPresscartApiClient,
  requirePermission,
  type ServerOptions,
} from '../utils/tool-context.js';
import { buildUploadFormData, ACCEPTED_UPLOAD_MIME_TYPES } from '../utils/file-upload.js';
import { jsonResult } from '../utils/tool-result.js';
import { teamRoute } from '../utils/team-routes.js';
import { teamSlugSchema } from './schemas.js';

const uploadMimeTypeSchema = z.enum(ACCEPTED_UPLOAD_MIME_TYPES);

export function registerFileTools(server: McpServer, options: ServerOptions) {
  server.registerTool(
    'upload_files',
    {
      title: 'Upload Files',
      description:
        'Upload 1-5 files to the team media library. Supports JPG, JPEG, PNG, PDF, DOC, and DOCX. Use this before tools that need a file_id, such as upload_campaign_questionnaire or upload_article with file_attachment.',
      inputSchema: {
        team_slug: teamSlugSchema,
        folder_id: z.string().uuid().optional(),
        files: z
          .array(
            z.object({
              file_name: z.string().trim().min(1),
              mime_type: uploadMimeTypeSchema,
              content_base64: z
                .string()
                .trim()
                .min(1)
                .describe('Base64 file contents. Data URL prefixes are accepted.'),
            })
          )
          .min(1)
          .max(5),
      },
    },
    async (input, extra) => {
      requirePermission(extra, options, 'files.create');
      const api = createPresscartApiClient(extra, options);
      const formData = buildUploadFormData(input.files, input.folder_id);
      const response = await api.postForm(teamRoute(input.team_slug, '/files/upload'), formData);
      return jsonResult(response);
    }
  );
}
