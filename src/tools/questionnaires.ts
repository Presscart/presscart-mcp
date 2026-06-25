import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  createPresscartApiClient,
  requirePermission,
  type ServerOptions,
} from '../utils/tool-context.js';
import { assertQuestionnaireFile } from '../utils/file-upload.js';
import { jsonResult } from '../utils/tool-result.js';
import { teamRoute } from '../utils/team-routes.js';
import { teamSlugSchema } from './schemas.js';

type TeamFileResponse = {
  name?: string;
  mime_type?: string;
};

export function registerQuestionnaireTools(server: McpServer, options: ServerOptions) {
  server.registerTool(
    'upload_campaign_questionnaire',
    {
      title: 'Upload Campaign Questionnaire',
      description:
        'Attach an uploaded PDF, DOC, or DOCX questionnaire file to a campaign. If the file is not in the media library yet, call upload_files first and pass the returned file_id.',
      inputSchema: {
        team_slug: teamSlugSchema,
        campaign_id: z.string().uuid(),
        file_id: z.string().uuid(),
      },
    },
    async (input, extra) => {
      requirePermission(extra, options, 'files.read');
      requirePermission(extra, options, 'files.update');

      const api = createPresscartApiClient(extra, options);
      const file = await api.get<TeamFileResponse>(
        teamRoute(input.team_slug, `/files/${input.file_id}`)
      );

      if (!file.name || !file.mime_type) {
        throw new Error('Could not validate the uploaded questionnaire file.');
      }

      assertQuestionnaireFile(file.name, file.mime_type);

      const response = await api.post(teamRoute(input.team_slug, '/attachments'), {
        file_ids: [input.file_id],
        resource_type: 'campaign_questionnaire',
        resource_id: input.campaign_id,
      });

      return jsonResult(response);
    }
  );
}
