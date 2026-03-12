# Presscart MCP

Standalone MCP server for the Presscart reseller workflow.

Supports:
- local `stdio` mode
- hosted Streamable HTTP mode

Hosted HTTP mode supports two auth models:
- MCP OAuth mode: the server exposes OAuth authorization and discovery endpoints, and clients connect to `/mcp` with `Authorization: Bearer <oauth_access_token>`.
- Legacy direct-token mode: the caller provides a Presscart API token via `X-Presscart-API-Token`, and the server uses that token as the upstream Presscart credential.

## Environment

Required in all modes:

```bash
export PRESSCART_API_URL="https://api.presscart.com"
```

Optional local fallback for stdio mode:

```bash
export PRESSCART_API_TOKEN="pc_..."
export PRESSCART_PROFILE_ID="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Optional hosted mode settings:

```bash
export MCP_HOST="0.0.0.0"
export MCP_PORT="8787"
export MCP_SERVER_URL="https://mcp.presscart.com/mcp"
```

Optional host/origin overrides for reverse proxies or multiple domains:

```bash
export MCP_ALLOWED_HOSTS="mcp.presscart.com"
export MCP_ALLOWED_ORIGINS="https://mcp.presscart.com"
```

Optional OAuth settings:

```bash
export MCP_OAUTH_ENABLED="true"
# Optional override; defaults to the origin of MCP_SERVER_URL
export MCP_OAUTH_ISSUER_URL="https://mcp.presscart.com/"
# Recommended for hosted deployments so issued OAuth credentials survive deploys/restarts.
export MCP_OAUTH_SIGNING_SECRET="replace-with-a-random-32+-char-secret"
```

Notes:
- `PRESSCART_API_TOKEN` is optional now. It is only used as a local fallback in stdio mode.
- `PRESSCART_PROFILE_ID` is optional globally, but tools that create orders/campaigns or read profile order items need a profile id from either env or tool input.
- In MCP OAuth mode, the authorization UI asks the user for their Presscart API token and optional default profile ID, then stores that credential server-side against the issued OAuth token.
- If `MCP_OAUTH_SIGNING_SECRET` is set, registered OAuth clients plus issued access/refresh tokens are signed and can survive deploys/restarts. Short-lived browser authorization requests and authorization codes are still in-memory.
- If `MCP_OAUTH_SIGNING_SECRET` is not set, OAuth state, registered clients, authorization codes, and issued tokens are stored in memory. A restart clears them.
- In legacy direct-token mode, send `X-Presscart-API-Token: <presscart_api_token>` on `initialize` and later requests that need to confirm the active session credential.

## Install

```bash
cd /Users/edgarli/Documents/Presscart/presscart-mcp
npm install
```

## Run

Development:

```bash
npm run dev
```

Hosted HTTP development:

```bash
npm run dev:http
```

Build and run:

```bash
npm run build
npm start
```

Build and run hosted HTTP:

```bash
npm run build
npm run start:http
```

## Tools

- `auth_whoami`
- `list_profiles`
- `list_outlets`
- `get_product`
- `create_order_checkout`
- `get_order`
- `list_order_items`
- `create_campaign`
- `list_campaigns`
- `get_campaign`
- `assign_order_items_to_campaign`
- `get_campaign_article_status`
- `list_profile_order_items`

## Example MCP config

Local stdio config:

```json
{
  "mcpServers": {
    "presscart": {
      "command": "node",
      "args": ["/Users/edgarli/Documents/Presscart/presscart-mcp/dist/index.js"],
      "cwd": "/Users/edgarli/Documents/Presscart/presscart-mcp",
      "env": {
        "PRESSCART_API_URL": "https://api.presscart.com",
        "PRESSCART_API_TOKEN": "pc_...",
        "PRESSCART_PROFILE_ID": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
      }
    }
  }
}
```

## Hosted deployment shape

### MCP OAuth mode

Enable OAuth:

```bash
PRESSCART_API_URL=https://api.presscart.com
MCP_HOST=0.0.0.0
MCP_PORT=8787
MCP_SERVER_URL=https://mcp.presscart.com/mcp
MCP_OAUTH_ENABLED=true
MCP_OAUTH_SIGNING_SECRET=replace-with-a-random-32+-char-secret
```

The server will expose:
- `/.well-known/oauth-protected-resource/mcp`
- `/.well-known/oauth-authorization-server`
- `/authorize`
- `/token`
- `/register`
- `/revoke`
- `/oauth/authorize` (Presscart credential approval page)

Hosted MCP clients should connect to `https://mcp.presscart.com/mcp` and use normal MCP OAuth discovery. After the browser flow completes, they should send `Authorization: Bearer <oauth_access_token>` to `/mcp`.

### Legacy direct-token mode

If `MCP_OAUTH_ENABLED` is unset or `false`, hosted clients can still connect to `/mcp` directly and provide the user's Presscart API token via `X-Presscart-API-Token`.

For Railway:

```bash
PRESSCART_API_URL=https://api.presscart.com
MCP_HOST=0.0.0.0
MCP_PORT=8787
MCP_SERVER_URL=https://mcp.presscart.com/mcp
```

Start command:

```bash
npm run start:http
```

Example initialize request in legacy direct-token mode:

```bash
curl -X POST https://mcp.presscart.com/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'X-Presscart-API-Token: pc_...' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"example","version":"1.0.0"}}}'
```

Example client registration request for MCP OAuth mode:

```bash
curl -X POST https://mcp.presscart.com/register \
  -H 'Content-Type: application/json' \
  --data '{"redirect_uris":["http://127.0.0.1:9898/callback"],"token_endpoint_auth_method":"none","grant_types":["authorization_code","refresh_token"],"response_types":["code"],"client_name":"Presscart MCP Client"}'
```

## Client Setup

### Claude and Claude Desktop

Remote MCP servers for Claude and Claude Desktop are added in the product UI, not via `claude_desktop_config.json`.

1. Open `Settings > Connectors`.
2. Add a custom remote MCP connector.
3. Enter your MCP server URL:

```text
https://mcp.presscart.com/mcp
```

4. Start the OAuth flow when prompted.
5. On the Presscart approval page (`/oauth/authorize`), enter the Presscart API token and optional default profile ID.

### Claude Code

Add the remote server from the CLI:

```bash
claude mcp add --transport http presscart https://mcp.presscart.com/mcp
```

Then run Claude Code and use `/mcp` if it prompts you to complete OAuth authentication.

### Codex

Add the remote server from the CLI:

```bash
codex mcp add presscart --url https://mcp.presscart.com/mcp
codex mcp login presscart
```

Codex supports remote Streamable HTTP MCP servers with OAuth, but the configured MCP URL, the `WWW-Authenticate` `resource_metadata` URL, and both OAuth discovery documents should all point at the same public hostname. If the server is added as `https://mcp.presscart.com/mcp` but discovery still advertises a platform hostname such as `https://presscart-mcp-production.up.railway.app/...`, Codex authentication may fail even if another client succeeds.

Quick verification:

```bash
curl -i https://mcp.presscart.com/mcp
curl -s https://mcp.presscart.com/.well-known/oauth-authorization-server | jq
curl -s https://mcp.presscart.com/.well-known/oauth-protected-resource/mcp | jq
```

If you need an immediate workaround while hosted OAuth is being fixed, use the local stdio server instead:

```bash
codex mcp add presscart --env PRESSCART_API_URL=https://api.presscart.com --env PRESSCART_API_TOKEN=pc_... --env PRESSCART_PROFILE_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx -- node /Users/edgarli/Documents/Presscart/presscart-mcp/dist/index.js
```

### Cursor

Add the server in `.cursor/mcp.json` for a project, or `~/.cursor/mcp.json` for your user profile:

```json
{
  "mcpServers": {
    "presscart": {
      "url": "https://mcp.presscart.com/mcp"
    }
  }
}
```

Cursor supports OAuth for remote HTTP MCP servers. Once added, use Cursor’s MCP UI to connect/authenticate.

### VS Code / GitHub Copilot Chat

Add the server in `.vscode/mcp.json` for a workspace, or in your user `mcp.json`:

```json
{
  "servers": {
    "presscart": {
      "type": "http",
      "url": "https://mcp.presscart.com/mcp"
    }
  }
}
```

Then open Copilot Chat in Agent mode and complete the OAuth flow when VS Code prompts you.

### GitHub Copilot Coding Agent on GitHub.com

GitHub’s coding agent currently does not support remote MCP servers that use OAuth. If you need GitHub-hosted Copilot integration today, use the legacy direct-token mode instead of `MCP_OAUTH_ENABLED=true`, or use VS Code/Copilot Chat locally.

### ChatGPT

ChatGPT uses remote MCP servers through Developer Mode and Apps settings rather than a local config file.

1. Enable Developer Mode in ChatGPT.
2. Go to `Settings > Apps` and create a new app for your remote MCP server.
3. Enter:

```text
https://mcp.presscart.com/mcp
```

4. Choose OAuth as the authentication mechanism.
5. Complete the OAuth flow and approve the Presscart credential on `/oauth/authorize`.

Notes:
- ChatGPT currently supports remote servers only, not local MCP servers.
- Business and Enterprise/Edu have the fullest MCP app support; availability differs by plan.
