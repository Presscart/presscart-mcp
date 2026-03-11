# Presscart MCP

Standalone MCP server for the Presscart reseller workflow.

Supports:
- local `stdio` mode
- hosted Streamable HTTP mode

In hosted mode, the caller provides their own Presscart API token in the MCP connection's bearer auth. The server forwards that token to the Presscart API and does not need to store a shared customer token.

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
```

Notes:
- `PRESSCART_API_TOKEN` is optional now. It is only used as a local fallback in stdio mode.
- `PRESSCART_PROFILE_ID` is optional globally, but tools that create orders/campaigns or read profile order items need a profile id from either env or tool input.
- For hosted Railway/Claude-style usage, the caller should send `Authorization: Bearer <presscart_api_token>` to the MCP server.

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

Hosted MCP clients should connect to your deployed `/mcp` endpoint and provide bearer auth using the user's own Presscart API token.

For Railway:

```bash
PRESSCART_API_URL=https://api.presscart.com
MCP_HOST=0.0.0.0
MCP_PORT=8787
```

Start command:

```bash
npm run start:http
```
