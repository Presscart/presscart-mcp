# Presscart MCP

Standalone MCP server for the Presscart reseller workflow.

Supports:
- hosted Streamable HTTP mode

Hosted HTTP mode supports two auth models:
- MCP OAuth mode: Supabase/Auth issues the OAuth token, and clients connect to `/mcp` with `Authorization: Bearer <oauth_access_token>`.
- Legacy direct-token mode: the caller provides a Presscart API token via `X-Presscart-API-Token`, and the server uses that token as the upstream Presscart credential.

## Environment

Required:

```bash
export PRESSCART_API_URL="http://api.presscart.com/"
```

Optional app link settings:

```bash
export PRESSCART_APP_URL="https://app.presscart.com"
```

Optional hosted mode settings:

```bash
export MCP_HOST="0.0.0.0"
export MCP_PORT="8787"
export MCP_SERVER_URL="https://mcp.presscart.com/mcp"
export MCP_SESSION_IDLE_TTL_MS="43200000"
```

Optional host/origin overrides for reverse proxies or multiple domains:

```bash
export MCP_ALLOWED_HOSTS="mcp.presscart.com"
export MCP_ALLOWED_ORIGINS="https://mcp.presscart.com,https://claude.ai,https://claude.com"
```

When `MCP_ALLOWED_ORIGINS` is not set, hosted mode allows the configured MCP server origin plus Claude's remote connector origins.

Optional OAuth settings:

```bash
export MCP_OAUTH_ENABLED="true"
export MCP_OAUTH_ISSUER_URL="https://<project-ref>.supabase.co/auth/v1"
export MCP_OAUTH_AUDIENCE="https://mcp.presscart.com/mcp"
export MCP_OAUTH_TRANSLATOR_ENABLED="false"
export MCP_OAUTH_LEGACY_AUDIENCE="https://mcp.presscart.com"
export MCP_OAUTH_UPSTREAM_TIMEOUT_MS="10000"
```

Notes:
- `PRESSCART_API_URL` must point at the app API base that exposes `/teams/*` routes, not a public-api-only base.
- `PRESSCART_APP_URL` controls direct application links returned by tools such as `list_publisher_articles`. Set it per environment so staging MCP links open staging.
- Tools that create orders/campaigns or read profile orders need an explicit `profile_id`. If the profile is unknown, call `list_teams`, then `list_profiles`.
- In MCP OAuth mode, the app's Supabase OAuth Server handles authorization and consent. This MCP runtime validates the issued access token against Supabase JWKS and delegated permissions.
- `MCP_OAUTH_TRANSLATOR_ENABLED` defaults to `false`. When enabled, the MCP origin publishes a standards-based OAuth facade while Supabase remains responsible for clients, codes, tokens, rotation, signing, and consent.
- `MCP_OAUTH_ISSUER_URL` must use HTTPS. Loopback HTTP issuers are accepted only for local development.
- `MCP_OAUTH_LEGACY_AUDIENCE` is an optional verifier-only migration value and must equal the configured MCP server origin (for example, `https://mcp.presscart.com`). It cannot duplicate the canonical `/mcp` resource or name another service, and it never changes the protected resource advertised to clients.
- MCP clients store their own refresh tokens, initiate refresh automatically, and replace rotated refresh and access tokens. This server handles the refresh request statelessly and does not store refresh tokens.
- The translator changes only MCP OAuth. It does not change ordinary Presscart browser or app sessions, and disabling MCP OAuth still preserves legacy direct-token mode.
- In legacy direct-token mode, send `X-Presscart-API-Token: <presscart_api_token>` on `initialize` and later requests that need to confirm the active session credential.

## Install

```bash
cd presscart-mcp
npm install
```

## Run

Development:

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

## Release

Releases are automated by semantic-release from Conventional Commits.

- `fix:` creates a patch release.
- `feat:` creates a minor release.
- `!` or `BREAKING CHANGE:` creates a major release.
- `docs:`, `test:`, `chore:`, and other non-release commits do not publish a new version by default.

The `Release` workflow runs on pushes to `main` and `staging`. It runs check, test, and build, then semantic-release creates the release tag and publishes the GitHub release.

- `main` publishes stable releases and commits generated release files: `CHANGELOG.md`, `package.json`, `package-lock.json`, and `src/version.ts`.
- `staging` publishes release candidates with the `rc` prerelease channel, but does not commit generated release files. This keeps staging-to-main promotion merges from conflicting on prerelease metadata.

You can dry-run the release locally:

```bash
npm run release:dry-run
npm run release:staging:dry-run
```

If the repository has no existing release tag yet, create the baseline tag before the first semantic-release run so the next release continues from the current version:

```bash
git tag v0.2.0
git push origin v0.2.0
```

## Tools

- `get_user`
- `list_teams`
- `get_team`
- `list_profiles`
- `upload_files`
- `list_outlets`
- `get_outlet`
- `create_outlet`
- `update_outlet`
- `list_outlet_channels`
- `create_outlet_channel`
- `update_outlet_channel`
- `delete_outlet_channel`
- `list_product_types`
- `list_product_listings`
- `list_countries`
- `list_states`
- `list_cities`
- `get_product_listing`
- `list_products`
- `get_product`
- `create_product`
- `update_product`
- `create_order`
- `get_order`
- `list_order_items`
- `list_profile_orders`
- `create_campaign`
- `list_campaigns`
- `get_campaign`
- `update_campaign`
- `list_campaign_articles`
- `list_publisher_articles`
- `add_order_items_to_campaign`
- `get_campaign_article_status`
- `upload_campaign_questionnaire`
- `upload_article`
- `replace_article_file`
- `submit_article`
- `request_article_writing`

## Hosted deployment shape

### MCP OAuth mode

Enable OAuth:

```bash
PRESSCART_API_URL=http://api.presscart.com/
MCP_HOST=0.0.0.0
MCP_PORT=8787
MCP_SERVER_URL=https://mcp.presscart.com/mcp
MCP_SESSION_IDLE_TTL_MS=43200000
MCP_OAUTH_ENABLED=true
MCP_OAUTH_ISSUER_URL=https://<project-ref>.supabase.co/auth/v1
MCP_OAUTH_AUDIENCE=https://mcp.presscart.com/mcp
MCP_OAUTH_TRANSLATOR_ENABLED=false
MCP_OAUTH_LEGACY_AUDIENCE=https://mcp.presscart.com
MCP_OAUTH_UPSTREAM_TIMEOUT_MS=10000
```

The canonical resource and JWT audience must match `MCP_SERVER_URL`, allowing only a trailing-slash difference. Both public OAuth URLs and the upstream issuer must use HTTPS except for loopback-only local development. `MCP_OAUTH_LEGACY_AUDIENCE` is needed only during the migration window, must match the MCP server origin exactly, and should otherwise be unset.

With the translator disabled, the server exposes direct-Supabase protected-resource metadata at:

- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-protected-resource/mcp`

With the translator enabled, those routes advertise `https://mcp.presscart.com` as the authorization server, and the server also exposes:

- `/.well-known/oauth-authorization-server`
- `/oauth/authorize`
- `/oauth/register`
- `/oauth/token`

The facade accepts the standard authorization-code and refresh-token flows and proxies only to the configured Supabase issuer. It does not derive upstream targets from request hosts, forwarded headers, query parameters, or client-supplied URLs.

The facade does not expose or advertise an RFC token-revocation endpoint. Revocation stays in the existing Presscart app/admin flow: revoking the Presscart OAuth grant makes the next refresh fail. An access token that was already issued is not actively revoked by this MCP verifier and can remain cryptographically valid until its normal expiry. After it expires, the client cannot obtain a replacement, access ends, and the user must reauthorize.

Hosted MCP clients should connect to `https://mcp.presscart.com/mcp` and use normal MCP OAuth discovery. After the browser flow completes, they send `Authorization: Bearer <oauth_access_token>` to `/mcp`. Clients own refresh-token storage, automatically initiate refresh, and persist each rotated refresh token returned by Supabase through the facade.

ChatGPT, Claude, Cursor, and Codex consume the same MCP and OAuth standards. The server has no vendor-specific authentication branches. Labels and prompts such as **Connect** or **Authenticate** are controlled by each client platform, not by this server.

### OAuth rollout and rollback

Deploy the audience migration and translator in this order:

1. Deploy this MCP server with `MCP_OAUTH_TRANSLATOR_ENABLED=false`, canonical `MCP_OAUTH_AUDIENCE=https://mcp.presscart.com/mcp`, and temporary `MCP_OAUTH_LEGACY_AUDIENCE=https://mcp.presscart.com` dual-audience verification.
2. Deploy the Presscart app access-token hook so initial and refreshed MCP tokens use the canonical `/mcp` audience.
3. Wait at least one full access-token lifetime, then confirm legacy-audience use has drained.
4. Enable `MCP_OAUTH_TRANSLATOR_ENABLED=true` in non-production and run discovery, authorization-code, and refresh smoke tests. Revoke a Presscart OAuth grant through the existing app/admin flow and verify that the next refresh fails. Do not expect an already-issued access token to fail immediately: let it reach its normal expiry, then verify that the client cannot replace it and requires reauthorization before enabling the translator in production.
5. Create and publish a replacement ChatGPT workspace app. Keep the old app available during the reconnection window.
6. Verify ChatGPT, Claude, Cursor, and Codex before and after access-token expiry, then remove the old app and `MCP_OAUTH_LEGACY_AUDIENCE` only after telemetry confirms they are unused.

To roll back the facade, set `MCP_OAUTH_TRANSLATOR_ENABLED=false`; direct Supabase metadata returns without changing legacy direct-token MCP or ordinary Presscart sessions. Keep canonical audience issuance and temporary legacy verification in place until the rollback window is complete. Clients registered against the facade may need to reconnect through the direct Supabase flow.

### Legacy direct-token mode

If `MCP_OAUTH_ENABLED` is unset or `false`, hosted clients can still connect to `/mcp` directly and provide the user's Presscart API token via `X-Presscart-API-Token`.

For Railway:

```bash
PRESSCART_API_URL=http://api.presscart.com/
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
5. Approve or deny the delegated access request in the Presscart consent UI.

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

Codex supports remote Streamable HTTP MCP servers with OAuth. The configured MCP URL and the `WWW-Authenticate` `resource_metadata` URL should both use the MCP public hostname. With `MCP_OAUTH_TRANSLATOR_ENABLED=true`, protected-resource metadata advertises the MCP-origin facade as its authorization server; with the translator disabled, it advertises the direct Supabase/Auth issuer.

Quick verification:

```bash
curl -i https://mcp.presscart.com/mcp
curl -s https://mcp.presscart.com/.well-known/oauth-protected-resource/mcp | jq
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
5. Complete the OAuth flow and approve the delegated access request in Presscart.

Notes:
- ChatGPT currently supports remote servers only, not local MCP servers.
- Business and Enterprise/Edu have the fullest MCP app support; availability differs by plan.
