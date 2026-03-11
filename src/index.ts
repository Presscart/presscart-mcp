import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createPresscartMcpServer } from './server.js';

async function main() {
  const server = createPresscartMcpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
  console.error('Presscart MCP server running on stdio');
}

main().catch(error => {
  console.error(formatError(error));
  process.exit(1);
});

function formatError(error: unknown) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}
