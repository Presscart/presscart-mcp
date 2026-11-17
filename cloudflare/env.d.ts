/** Bindings the presscart-mcp Worker reads; values come from wrangler.jsonc vars and `wrangler secret`. */
interface Env {
  MCP_CONTAINER: DurableObjectNamespace<import('./worker.js').McpContainer>;
  MCP_ALLOWED_HOSTS: string;
  MCP_DIRECTORY_PROFILES: string;
  MCP_HOST: string;
  MCP_INTERNAL_AUTH_TOKEN: string;
  MCP_OAUTH_AUDIENCE: string;
  MCP_OAUTH_ENABLED: string;
  MCP_OAUTH_ISSUER_URL: string;
  MCP_OAUTH_TRANSLATOR_ENABLED: string;
  MCP_OAUTH_UPSTREAM_TIMEOUT_MS: string;
  MCP_SERVER_URL: string;
  PRESSCART_API_URL: string;
}
