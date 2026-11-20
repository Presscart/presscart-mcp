import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { PresscartApiError } from '../api.js';
import { getPresscartAppUrl } from '../utils/article-urls.js';
import {
  createPresscartApiClient,
  requirePermission,
  requireTeamId,
  type ServerOptions,
} from '../utils/tool-context.js';
import { isRecord } from '../utils/is-record.js';
import { jsonResult } from '../utils/tool-result.js';
import { readOnlyTool } from './metadata.js';

const PUBLISHER_AGREEMENT_KEY = 'publisher_agreement';

type TeamSignatureRead = { checked: boolean; signedAt: string | null };

const SIGNATURE_UNCHECKED_STEP =
  "Presscart's own record of a staff-recorded signature could not be checked, so do not tell the publisher the agreement is unsigned. Ask them to check the agreement status at agreement_page_url, or try again.";

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
        'Check whether a publisher team has signed the Presscart publisher agreement. is_accepted is true both when the publisher accepted it in the dashboard and when Presscart staff recorded it as signed (signed_via says which); signature_check is incomplete when the team record could not be read, so is_accepted false is then unconfirmed. Agents cannot sign it for the publisher: when it is unsigned, give them agreement_page_url so they can read and sign it in the Presscart dashboard. Check this before setting an outlet to ACTIVE. Use list_teams first if team_id is unknown.',
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
      const clickThroughAccepted = response.is_accepted === true;
      // Presscart's own gates read the team's agreement_signed_at, which staff can set, so an
      // unaccepted click-through is not enough to call the team unsigned.
      const team: TeamSignatureRead = clickThroughAccepted
        ? { checked: true, signedAt: null }
        : await readTeamAgreementSignedAt(api, teamId);
      const recordedAt = team.signedAt;
      const isAccepted = clickThroughAccepted || recordedAt !== null;
      const clickThroughAt = response.acceptance?.accepted_at ?? null;

      // Only status fields are returned; the acceptance record also holds the signer's IP and user agent.
      return jsonResult({
        agreement_name: response.template?.name ?? null,
        is_accepted: isAccepted,
        accepted_at: clickThroughAt,
        signed_at: clickThroughAccepted ? clickThroughAt : recordedAt,
        signed_via: clickThroughAccepted
          ? 'in_app'
          : recordedAt !== null
            ? 'recorded_by_presscart'
            : null,
        agreement_page_url: new URL('/publisher/settings', getPresscartAppUrl()).toString(),
        signature_check: team.checked ? 'complete' : 'incomplete',
        next_step: isAccepted
          ? null
          : !team.checked
            ? SIGNATURE_UNCHECKED_STEP
            : 'Ask the publisher to read and sign the agreement at agreement_page_url. Do not accept it on their behalf.',
      });
    }
  );
}

async function readTeamAgreementSignedAt(
  api: ReturnType<typeof createPresscartApiClient>,
  teamId: string
): Promise<TeamSignatureRead> {
  try {
    const team: unknown = await api.get<unknown>(`/teams/${teamId}`);
    const value = isRecord(team) ? team.agreement_signed_at : undefined;
    const signedAt = typeof value === 'string' && value.trim() !== '' ? value : null;
    return { checked: true, signedAt };
  } catch (error) {
    // Any API failure (including 401/403) means we cannot tell; never turn that into "unsigned".
    if (error instanceof PresscartApiError) return { checked: false, signedAt: null };
    throw error;
  }
}
