import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { TokenSessionResponse } from '../api.js';
import {
  createPresscartApiClient,
  getSessionAuthInfo,
  type ServerOptions,
} from '../utils/tool-context.js';
import { jsonResult } from '../utils/tool-result.js';
import { toWhoamiResponse } from '../utils/whoami.js';

export function registerAuthTools(server: McpServer, options: ServerOptions) {
  server.registerTool(
    'get_user',
    {
      title: 'Get User',
      description: 'Return the current authenticated user.',
      inputSchema: {},
    },
    async (_input, extra) => {
      const api = createPresscartApiClient(extra, options);
      const response = await api.get<TokenSessionResponse>('/auth/token');
      return jsonResult(toWhoamiResponse(response, getSessionAuthInfo(extra, options)));
    }
  );
}
