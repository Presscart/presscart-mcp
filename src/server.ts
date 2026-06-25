import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerPresscartTools } from './tools/index.js';
import type { ServerOptions } from './utils/tool-context.js';

export function createPresscartMcpServer(options: ServerOptions = {}) {
  const server = new McpServer({
    name: 'presscart',
    version: '0.2.0',
  });

  registerPresscartTools(server, options);

  return server;
}
