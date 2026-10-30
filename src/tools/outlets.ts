import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { PresscartApiError } from '../api.js';
import { buildUploadFormData } from '../utils/file-upload.js';
import {
  createPresscartApiClient,
  requirePermission,
  type ServerOptions,
} from '../utils/tool-context.js';
import { jsonResult } from '../utils/tool-result.js';
import { teamRoute } from '../utils/team-routes.js';
import { additiveWriteTool, readOnlyTool, updateTool } from './metadata.js';
import { paginationSchema, sortSchema, teamSlugSchema } from './schemas.js';

const outletTagSchema = z.object({
  tag_id: z.string().uuid(),
});

const outletPayloadSchema = {
  name: z.string().trim().min(1),
  description: z.string().nullable(),
  logo: z.string().nullable(),
  website_url: z.string().nullable(),
  country: z.string().nullable(),
  state: z.string().nullable(),
  city: z.string().nullable(),
  is_indexed: z.boolean(),
  has_author: z.boolean(),
  has_date: z.boolean(),
  tags: z.array(outletTagSchema),
  metadata_id: z.string().uuid().nullable().optional(),
};

const authorizationDocumentSchema = z.object({
  file_name: z
    .string()
    .trim()
    .regex(/\.(pdf|docx?)$/i, 'Use a .pdf, .doc, or .docx file name.'),
  mime_type: z.enum([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ]),
  content_base64: z
    .string()
    .trim()
    .min(1)
    .describe('Base64 file contents. Data URL prefixes are accepted.'),
});

type UploadedFilesResponse = {
  files?: Array<{ file_key?: string }>;
};

const AUTHORIZATION_NOT_FOUND_MESSAGE = 'Outlet authorization not found.';

function isAuthorizationNotSubmitted(error: unknown) {
  return (
    error instanceof PresscartApiError &&
    error.status === 404 &&
    (error.body as { message?: unknown } | null)?.message === AUTHORIZATION_NOT_FOUND_MESSAGE
  );
}

export function registerOutletTools(server: McpServer, options: ServerOptions) {
  server.registerTool(
    'list_outlets',
    {
      title: 'List Outlets',
      description:
        'List outlet records owned by the selected team. Use this for publisher/team outlet management. For buyer marketplace discovery, use list_product_listings instead.',
      inputSchema: {
        team_slug: teamSlugSchema,
        ...paginationSchema,
        ...sortSchema,
        search: z.string().trim().optional(),
      },
      annotations: readOnlyTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'outlets.lists');
      const api = createPresscartApiClient(extra, options);
      const { team_slug, ...query } = input;
      const response = await api.get(teamRoute(team_slug, '/outlets'), query);
      return jsonResult(response);
    }
  );

  server.registerTool(
    'get_outlet',
    {
      title: 'Get Outlet',
      description:
        'Fetch one outlet record owned by the selected team. Use this before editing an outlet or creating outlet channels/product listings.',
      inputSchema: {
        team_slug: teamSlugSchema,
        outlet_id: z.string().uuid(),
      },
      annotations: readOnlyTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'outlets.read');
      const api = createPresscartApiClient(extra, options);
      const response = await api.get(teamRoute(input.team_slug, `/outlets/${input.outlet_id}`));
      return jsonResult(response);
    }
  );

  server.registerTool(
    'create_outlet',
    {
      title: 'Create Outlet',
      description:
        'Create an outlet for the selected team. The API associates it with the authenticated publisher provider team. Collect the outlet name, website URL, location fields, index/date/author flags, and tag IDs before calling this tool. Use status=DRAFT when the user wants to save without submitting/publishing.',
      inputSchema: {
        team_slug: teamSlugSchema,
        ...outletPayloadSchema,
        status: z.literal('DRAFT').optional(),
      },
      annotations: additiveWriteTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'outlets.create');
      const api = createPresscartApiClient(extra, options);
      const { team_slug, ...body } = input;
      const response = await api.post(teamRoute(team_slug, '/outlets'), body);
      return jsonResult(response);
    }
  );

  server.registerTool(
    'update_outlet',
    {
      title: 'Update Outlet',
      description:
        'Update an outlet owned by the selected team. Send the full outlet payload, not just changed fields. Use get_outlet first if the user only wants to change one value. Use status=DRAFT to keep it as a draft, or status=ACTIVE only when the user explicitly wants to publish and get_publisher_agreement_status shows the publisher agreement is signed.',
      inputSchema: {
        team_slug: teamSlugSchema,
        outlet_id: z.string().uuid(),
        ...outletPayloadSchema,
        status: z.enum(['DRAFT', 'ACTIVE']).optional(),
      },
      annotations: updateTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'outlets.update');
      const api = createPresscartApiClient(extra, options);
      const { team_slug, outlet_id, ...body } = input;
      const response = await api.put(teamRoute(team_slug, `/outlets/${outlet_id}`), body);
      return jsonResult(response);
    }
  );

  server.registerTool(
    'get_outlet_statistics',
    {
      title: 'Get Outlet Statistics',
      description:
        'Count the outlets owned by the selected publisher team by publication status, such as DRAFT, PENDING_VERIFICATION, PENDING_REVIEW, PENDING_AGREEMENT, and ACTIVE. Use this when a publisher asks how many of their outlets are live, pending, or stuck.',
      inputSchema: {
        team_slug: teamSlugSchema,
      },
      annotations: readOnlyTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'outlets.read');
      const api = createPresscartApiClient(extra, options);
      const response = await api.get(teamRoute(input.team_slug, '/outlets/stats'));
      return jsonResult(response);
    }
  );

  server.registerTool(
    'start_outlet_domain_verification',
    {
      title: 'Start Outlet Domain Verification',
      description:
        "Start or fetch domain ownership verification for an outlet owned by the selected publisher team. Returns three ways to prove ownership: a meta tag, a DNS TXT record (dns_host and dns_value), or an HTML file (html_file_path and html_file_content). Give the publisher the exact values for one method, then call verify_outlet_domain after they confirm they've added it.",
      inputSchema: {
        team_slug: teamSlugSchema,
        outlet_id: z.string().uuid(),
      },
      annotations: additiveWriteTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'outlets.update');
      const api = createPresscartApiClient(extra, options);
      const response = await api.post(
        teamRoute(input.team_slug, `/outlets/${input.outlet_id}/domain-verification`)
      );
      return jsonResult(response);
    }
  );

  server.registerTool(
    'verify_outlet_domain',
    {
      title: 'Verify Outlet Domain',
      description:
        "Ask Presscart to check the outlet's website, verification file, and DNS TXT record now. Call this only after the publisher says they added the meta tag, DNS record, or file from start_outlet_domain_verification. DNS changes can take a while to appear; if the status is not verified, relay last_error and suggest trying again later.",
      inputSchema: {
        team_slug: teamSlugSchema,
        outlet_id: z.string().uuid(),
      },
      annotations: updateTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'outlets.update');
      const api = createPresscartApiClient(extra, options);
      const response = await api.post(
        teamRoute(input.team_slug, `/outlets/${input.outlet_id}/domain-verification/verify`)
      );
      return jsonResult(response);
    }
  );

  server.registerTool(
    'get_outlet_authorization',
    {
      title: 'Get Outlet Authorization',
      description:
        "Get the ownership authorization document submitted for an outlet owned by the selected publisher team, with its review status and any review notes from the Presscart team. Relay review_notes when the status needs the publisher's attention.",
      inputSchema: {
        team_slug: teamSlugSchema,
        outlet_id: z.string().uuid(),
      },
      annotations: readOnlyTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'outlets.read');
      const api = createPresscartApiClient(extra, options);
      try {
        const response = await api.get(
          teamRoute(input.team_slug, `/outlets/${input.outlet_id}/authorization`)
        );
        return jsonResult(response);
      } catch (error) {
        // A missing outlet is also a 404, so only the API's no-authorization reason means nothing was submitted yet.
        if (isAuthorizationNotSubmitted(error)) {
          return jsonResult({
            submitted: false,
            next_step:
              'No ownership authorization has been submitted for this outlet yet. Ask the publisher for a signed authorization letter and send it with submit_outlet_authorization.',
          });
        }
        throw error;
      }
    }
  );

  server.registerTool(
    'submit_outlet_authorization',
    {
      title: 'Submit Outlet Authorization',
      description:
        "Submit proof that the publisher may represent an outlet when they can't verify its domain: a signed letter or saved email from the outlet's owner or editor (PDF, DOC, or DOCX), plus that person's name, work email, and role. The Presscart team reviews it. Use only the details the publisher gave you; never infer or fill in the authorizer's name, email, or role. The MCP connection only carries documents up to about 70 KB; for a larger file, ask the publisher to upload it on the publication's page in the Presscart dashboard.",
      inputSchema: {
        team_slug: teamSlugSchema,
        outlet_id: z.string().uuid(),
        document: authorizationDocumentSchema,
        authorizer_name: z.string().trim().min(1),
        authorizer_email: z.string().trim().email(),
        authorizer_role: z.string().trim().min(1),
      },
      annotations: additiveWriteTool,
    },
    async (input, extra) => {
      requirePermission(extra, options, 'outlets.update');
      const api = createPresscartApiClient(extra, options);
      const { team_slug, outlet_id, document, ...authorizer } = input;
      const formData = buildUploadFormData([document]);
      formData.append('purpose', 'outlet_authorization');
      const upload = await api.postForm<UploadedFilesResponse>(
        teamRoute(team_slug, '/files/upload'),
        formData
      );
      const documentKey = upload.files?.[0]?.file_key;
      if (!documentKey) throw new Error('The authorization document upload did not return a file.');

      const response = await api.post(teamRoute(team_slug, `/outlets/${outlet_id}/authorization`), {
        document_key: documentKey,
        ...authorizer,
      });
      return jsonResult(response);
    }
  );
}
