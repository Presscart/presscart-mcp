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
import { additiveWriteTool, readOnlyTool } from './metadata.js';
import { teamSlugSchema } from './schemas.js';

type TeamFileResponse = {
  name?: string;
  mime_type?: string;
};

const questionnaireTemplates = [
  {
    type: 'business',
    title: 'Business Questionnaire',
    file_name: 'Business_Questionnaire_Updated_85e0f79dd6.docx',
    download_url:
      'https://press-bucket.s3.ca-central-1.amazonaws.com/Business_Questionnaire_Updated_85e0f79dd6.docx',
    description:
      "Use this when the campaign is about a company, product, or service. It asks for company history, mission, products/services, team, and unique selling points.",
  },
  {
    type: 'individual',
    title: 'Individual Questionnaire',
    file_name: 'Individual_Questionnaire_18a9542150.docx',
    download_url:
      'https://press-bucket.s3.ca-central-1.amazonaws.com/Individual_Questionnaire_18a9542150.docx',
    description:
      "Use this when the campaign is about a person. It asks for the individual's hobbies, interests, passions, experiences, and insights.",
  },
] as const;

export function registerQuestionnaireTools(server: McpServer, options: ServerOptions) {
  server.registerTool(
    'list_questionnaire_templates',
    {
      title: 'List Questionnaire Templates',
      description:
        'List the blank campaign questionnaire templates users can download and complete before uploading. Use business for company, product, or service campaigns. Use individual for person-focused campaigns. After the user completes a template, call upload_files, then upload_campaign_questionnaire with the returned file_id.',
      inputSchema: {
        type: z.enum(['business', 'individual']).optional(),
      },
      annotations: readOnlyTool,
    },
    async input => {
      const templates = input.type
        ? questionnaireTemplates.filter(template => template.type === input.type)
        : questionnaireTemplates;

      return jsonResult({
        templates,
        next_step:
          'Ask the user to download and complete the matching DOCX template, upload the completed file with upload_files, then attach it to the campaign with upload_campaign_questionnaire.',
      });
    }
  );

  server.registerTool(
    'upload_campaign_questionnaire',
    {
      title: 'Upload Campaign Questionnaire',
      description:
        'Attach a completed questionnaire file to a campaign. Use list_questionnaire_templates first if the user needs the blank business or individual questionnaire. If the completed PDF, DOC, or DOCX file is not in the media library yet, call upload_files first and pass the returned file_id.',
      inputSchema: {
        team_slug: teamSlugSchema,
        campaign_id: z.string().uuid(),
        file_id: z.string().uuid(),
      },
      annotations: additiveWriteTool,
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
