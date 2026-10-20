import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { DIRECTORY_SERVER_INSTRUCTIONS } from './directory/instructions.js';
import type { DirectoryProfile } from './directory/policy.js';
import { registerDirectoryTools } from './directory/tools/index.js';
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

export function createDirectoryMcpServer(profile: DirectoryProfile, options: ServerOptions = {}) {
  const server = new McpServer(
    {
      name: 'presscart',
      version: PACKAGE_VERSION,
    },
    { instructions: DIRECTORY_SERVER_INSTRUCTIONS }
  );

  registerDirectoryTools(server, profile, options);

  return server;
}
