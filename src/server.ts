import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerPresscartTools } from './tools/index.js';
import type { ServerOptions } from './utils/tool-context.js';
import { PACKAGE_VERSION } from './version.js';

export function createPresscartMcpServer(options: ServerOptions = {}) {
  const server = new McpServer({
    name: 'presscart',
    version: PACKAGE_VERSION,
  });

  registerPresscartTools(server, options);

  return server;
}
