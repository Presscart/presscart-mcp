import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { getPresscartAppUrl } from '../utils/article-urls.js';
import {
  createPresscartApiClient,
  requirePermission,
  requireTeamId,
  type ServerOptions,
} from '../utils/tool-context.js';
import { jsonResult } from '../utils/tool-result.js';
import { readOnlyTool } from './metadata.js';

const PUBLISHER_AGREEMENT_KEY = 'publisher_agreement';

type AgreementStatusResponse = {
  template?: { name?: string };
  acceptance?: { accepted_at?: string } | null;
  is_accepted?: boolean;
};

export function registerAgreementTools(server: McpServer, options: ServerOptions) {
  server.registerTool(
    'get_publisher_agreement_status',
    {
      title: 'Get Publisher Agreement Status',
      description:
        'Check whether a publisher team has signed the Presscart publisher agreement. Agents cannot sign it for the publisher: when it is unsigned, give them agreement_page_url so they can read and sign it in the Presscart dashboard. Check this before setting an outlet to ACTIVE. Use list_teams first if team_id is unknown.',
      inputSchema: {
        team_id: z.string().uuid().optional(),
      },
      annotations: readOnlyTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'agreements.read');
      const api = createPresscartApiClient(extra, options);
      const teamId = input.team_id ?? requireTeamId(extra, options);
      const response = await api.get<AgreementStatusResponse>(
        `/agreements/${PUBLISHER_AGREEMENT_KEY}`,
        { team_id: teamId }
      );
      const isAccepted = response.is_accepted === true;

      // Only status fields are returned; the acceptance record also holds the signer's IP and user agent.
      return jsonResult({
        agreement_name: response.template?.name ?? null,
        is_accepted: isAccepted,
        accepted_at: response.acceptance?.accepted_at ?? null,
        agreement_page_url: new URL('/publisher/settings', getPresscartAppUrl()).toString(),
        next_step: isAccepted
          ? null
          : 'Ask the publisher to read and sign the agreement at agreement_page_url. Do not accept it on their behalf.',
      });
    }
  );
}
