import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { TokenSessionResponse } from '../api.js';
import { includeOAuthSessionClaims } from '../utils/session-claims.js';
import {
  createPresscartApiClient,
  getSessionAuthInfo,
  type ServerOptions,
} from '../utils/tool-context.js';
import { jsonResult } from '../utils/tool-result.js';

export function registerAuthTools(server: McpServer, options: ServerOptions) {
  server.registerTool(
    'auth_whoami',
    {
      title: 'Auth Whoami',
      description: 'Return the current Presscart MCP session details.',
      inputSchema: {},
    },
    async (_input, extra) => {
      const api = createPresscartApiClient(extra, options);
      const response = await api.get<TokenSessionResponse>('/auth/token');
      return jsonResult(includeOAuthSessionClaims(response, getSessionAuthInfo(extra, options)));
    }
  );
}
