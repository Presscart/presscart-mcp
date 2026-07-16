# Cross-platform MCP OAuth refresh lifecycle

## Status

Approved in brainstorming on 2026-07-17. This specification covers coordinated
work in `presscart-mcp` and `presscart-app`.

## Problem

The hosted Presscart MCP accepts one-hour Supabase OAuth access tokens, but its
current discovery chain advertises only `openid profile`. Supabase supports the
`refresh_token` grant and returns rotating refresh tokens, yet its discovery
metadata does not advertise or accept the standard `offline_access` scope.

ChatGPT's current custom-app guidance says that without `offline_access`, token
renewal may be unavailable and users may have to authenticate again after the
initial authorization expires. The production behavior matches that warning:
the Presscart MCP connection stops working after roughly one hour.

The published ChatGPT workspace app also lacks a user-visible
Connect/Authenticate action. Presscart cannot choose the label or render that
control, but it can provide the OAuth discovery and challenge behavior ChatGPT
uses to decide that authentication is available.

The existing `presscart-app` OAuth implementation is already refresh-aware. Its
Supabase Custom Access Token Hook re-resolves the active Presscart grant on
issuance, uses an existing `grant_id` claim as the strongest refresh binding,
and rejects missing, ambiguous, revoked, or mismatched grants. The missing
piece is compatibility between MCP clients' OAuth discovery expectations and
the hosted Supabase authorization server.

## Goals

- Let refresh-capable MCP clients renew Presscart access automatically without
  reopening the browser every hour.
- Make the hosted MCP advertise complete OAuth discovery so ChatGPT can expose
  its Connect/Authenticate experience.
- Use standard OAuth behavior shared by ChatGPT, Claude, Cursor, Codex, and
  other compatible remote MCP clients; do not branch on client identity.
- Keep Supabase responsible for login, authorization codes, token issuance,
  refresh-token rotation, and refresh-token storage.
- Keep `presscart-app` responsible for user consent, grant state, delegated
  permissions, and claim enrichment.
- Preserve access-token audience binding and the current internal delegated
  request path from MCP to `apps/api`.
- Make revocation effective on the next refresh and keep existing per-request
  grant enforcement in `apps/api`.
- Provide a reversible rollout and a one-time reconnection path for published
  ChatGPT workspace users.

## Non-goals

- Do not build a new Presscart token database or signing-key service.
- Do not store authorization codes, access tokens, refresh tokens, OAuth client
  secrets, or dynamic client registrations in `presscart-mcp`.
- Do not change ordinary Presscart website, dashboard, or Supabase browser
  sessions.
- Do not change the one-hour production access-token lifetime.
- Do not guarantee refresh for clients that do not implement OAuth refresh.
- Do not guarantee whether a third-party UI labels its action Connect,
  Authenticate, Sign in, or something else.
- Do not remove legacy direct-token mode when MCP OAuth is disabled.
- Do not add a connected-apps management UI in this feature.

## Decision

Add a stateless OAuth compatibility translator to `presscart-mcp`. To clients,
`https://mcp.presscart.com` becomes the OAuth authorization-server identifier.
The translator publishes standard metadata and exposes authorization, token,
and dynamic-registration endpoints. It validates the public request shape,
translates only the compatibility scope, and passes the actual OAuth operation
to Supabase.

Supabase remains the upstream token issuer. `presscart-app` remains the consent
and grant authority. The MCP resource server continues verifying Supabase JWTs
against the Supabase issuer, audience, and JWKS. Clients must treat access
tokens as opaque bearer credentials; the translator does not claim OIDC or
publish a local JWKS.

This is intentionally an OAuth-only facade. It advertises `profile` and
`offline_access`, not `openid`, so the upstream does not return an ID token
whose Supabase issuer would conflict with the facade's authorization-server
identifier. Presscart does not use an ID token for MCP authorization.

## Architecture and ownership

### `presscart-mcp`

- Publish OAuth protected-resource and authorization-server metadata.
- Return the protected-resource metadata URL in every missing/invalid bearer
  `WWW-Authenticate` challenge.
- Expose the stateless authorization, token, and registration translator.
- Enforce supported scopes, request size limits, timeouts, and rate limits.
- Forward standard upstream OAuth errors without leaking non-public upstream
  bodies.
- Continue validating access tokens through `SupabaseOAuthVerifier`.
- Continue binding an MCP session to `client_id`, `sub`, and `grant_id` while
  allowing the actual access-token string to rotate.

### `presscart-app`

- Continue serving `/oauth/consent` and recording approval or denial.
- Continue creating and revoking `oauth_grants` and permission links.
- Continue running the Custom Access Token Hook on initial issuance and
  refresh, re-resolving the active grant every time.
- Add regression coverage for the refresh path, including an existing
  `grant_id`, preserved lifetime claims, and revoked or mismatched grants.
- Update the existing MCP OAuth design and threat-model documents to describe
  the translator boundary and its security assumptions.

No schema migration is expected. If implementation discovers that a schema
change is genuinely required, it must return to design review rather than add
one opportunistically.

### MCP clients

- Discover the authorization server from protected-resource metadata.
- Complete authorization code + PKCE once.
- Store the returned refresh token in their own secure credential store.
- Call the translator's token endpoint with `grant_type=refresh_token` before
  expiry or after a suitable 401 response.
- Replace the stored refresh token whenever Supabase rotates it.

Automatic refresh is client-initiated. There is no Presscart background job or
timer refreshing credentials on a client's behalf.

## Public protocol contract

### Protected-resource metadata

Both existing resource metadata routes remain available:

- `GET /.well-known/oauth-protected-resource`
- `GET /.well-known/oauth-protected-resource/mcp`

When the translator is enabled, both return the same contract:

```json
{
  "resource": "https://mcp.presscart.com/mcp",
  "authorization_servers": ["https://mcp.presscart.com"],
  "scopes_supported": ["profile", "offline_access"],
  "bearer_methods_supported": ["header"],
  "resource_name": "Presscart MCP"
}
```

The path-specific URL is canonical and remains the URL advertised in the
`WWW-Authenticate` challenge.

### Authorization-server metadata

Add `GET /.well-known/oauth-authorization-server`:

```json
{
  "issuer": "https://mcp.presscart.com",
  "authorization_endpoint": "https://mcp.presscart.com/oauth/authorize",
  "token_endpoint": "https://mcp.presscart.com/oauth/token",
  "registration_endpoint": "https://mcp.presscart.com/oauth/register",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": [
    "none",
    "client_secret_basic",
    "client_secret_post"
  ],
  "scopes_supported": ["profile", "offline_access"]
}
```

Metadata responses may be publicly cached for a short bounded interval. Token,
registration, and authorization responses must use `Cache-Control: no-store`.

### Authorization endpoint

`GET /oauth/authorize` accepts the standard authorization-code parameters used
by remote MCP clients. It must:

1. Require `response_type=code`, `client_id`, a syntactically valid
   `redirect_uri`, a PKCE `code_challenge`, and
   `code_challenge_method=S256`. Pass the redirect URI upstream byte-for-byte;
   Supabase owns exact registration matching.
2. Accept `state` and `resource` and preserve them unchanged.
3. Allow only `profile` and `offline_access`. If scope is omitted, use both as
   the documented default. Reject other requested scopes with `invalid_scope`.
4. Remove `offline_access` before redirecting to Supabase because current
   Supabase Auth rejects that scope while issuing refresh tokens for the
   authorization-code grant regardless.
5. Send `profile` upstream. Do not add `openid`.
6. Redirect to the upstream Supabase `/oauth/authorize` endpoint. Supabase
   remains responsible for client lookup, exact redirect-URI validation,
   consent, state return, code creation, and PKCE binding.

The translator must never accept or synthesize a redirect URI outside the
client request. It must not add a Presscart-controlled callback hop.

### Dynamic client registration

`POST /oauth/register` forwards RFC 7591 registration JSON to Supabase's
dynamic registration endpoint and returns the validated public response.

The translator does not keep a local client store. Supabase validates and
persists clients and redirect URIs. Registration request and response bodies
must be size-limited, schema-checked, excluded from logs, and sent with
`Cache-Control: no-store`.

### Token endpoint

`POST /oauth/token` accepts form-encoded `authorization_code` and
`refresh_token` grants. It must:

1. Preserve public-client `client_id`, confidential-client authentication,
   authorization code, `code_verifier`, unchanged `redirect_uri`, refresh token,
   and `resource` values without storing them.
2. Remove `offline_access` from an optional upstream scope value and reject
   unsupported scopes.
3. Forward `Authorization: Basic` only to the configured Supabase token origin,
   never to a redirect or caller-controlled URL.
4. Disable automatic redirects for all upstream OAuth requests.
5. Validate the upstream JSON as an OAuth token response before returning it.
6. When the upstream response contains a refresh token, normalize the returned
   `scope` to include `profile offline_access`. Preserve a newly rotated refresh
   token exactly so the client replaces its stored token.
7. Set `Cache-Control: no-store` and `Pragma: no-cache`.

The translator handles tokens only in request-local memory. It must not log
request bodies, authorization headers, codes, token values, client secrets, or
full upstream responses.

### OAuth error behavior

- Preserve upstream OAuth errors such as `invalid_client`, `invalid_grant`,
  `invalid_scope`, and `unauthorized_client`, including their appropriate 4xx
  status, while limiting the response to standard public OAuth fields.
- Map an upstream timeout or unavailable service to `temporarily_unavailable`.
- Map malformed or unexpected upstream responses to `server_error`.
- Do not turn an expected refresh rejection into a generic 500.
- Do not expose raw upstream response text, stack traces, host internals, or
  token material.

## Resource-server behavior

`SupabaseOAuthVerifier` continues to validate:

- the Supabase JWT signature through the configured JWKS;
- the Supabase issuer;
- the MCP audience;
- expiration;
- required `client_id`, `grant_id`, and `sub` claims.

The translator's authorization-server identifier is not used as the JWT
issuer. The OAuth client treats the access token as opaque, while the resource
server validates the known upstream token profile.

When an MCP client refreshes during an existing MCP transport session, the
session validator permits the new token string only when `client_id`, `sub`,
and `grant_id` still match the session. A different user, client, or grant
receives 401 and cannot take over the session.

## Configuration and rollback

Add an explicit boolean feature flag for the translator, defaulting off in
unspecified environments. Reuse the configured MCP public URL and Supabase
issuer; derive or explicitly configure only fixed, allowlisted Supabase OAuth
endpoints. No new secret is required.

- Flag off: retain the current direct-Supabase resource metadata.
- Flag on: advertise the MCP-origin translator and mount its public endpoints.

Rollback turns the flag off and restores direct-Supabase discovery. It does not
invalidate Supabase tokens or Presscart grants, though clients connected through
the translator may need to reconnect after a discovery rollback.

Production must not construct upstream targets from request headers, forwarded
host values, client parameters, or unvalidated discovery documents.

## Security requirements

- HTTPS only outside localhost tests.
- PKCE S256 only; never accept `plain`.
- Exact upstream origin allowlist and redirects disabled.
- Request body and URL length limits on all translator endpoints.
- Separate rate limits for authorization, registration, and token endpoints.
- Standard OAuth response schemas and content types.
- `no-store` on all credential-bearing responses.
- No token-bearing logs, analytics properties, traces, or error contexts.
- Redacted structured events may include operation, outcome, HTTP status,
  latency bucket, and a one-way request correlation identifier, but no user,
  code, client secret, access token, or refresh token value.
- Security review must explicitly cover open redirects, SSRF, credential
  forwarding, scope escalation, PKCE downgrade, refresh replay, client-secret
  leakage, upstream error leakage, and denial-of-service limits.

## Cross-platform compatibility

The protocol is client-neutral. It targets clients supporting remote HTTP MCP
OAuth, including ChatGPT, Claude, Cursor, and Codex. There are no user-agent,
client-name, redirect-host, or vendor-specific code paths.

Clients may omit `offline_access`; the translator's documented default grants
`profile offline_access` when scope is absent. Clients that never implement a
refresh grant may still require manual reauthentication. That limitation is a
client capability, not something the server can repair.

Legacy direct Presscart API-token mode remains unchanged when MCP OAuth is
disabled.

## Testing strategy

### `presscart-mcp`

Use test-driven development and mock only the network boundary to Supabase.
Exercise the real Express routes and OAuth middleware.

- Metadata contract for both protected-resource routes and the authorization
  server route.
- `WWW-Authenticate` challenge points to the path-specific MCP resource
  metadata.
- Authorization defaults, supported-scope translation, invalid-scope errors,
  PKCE enforcement, state/resource preservation, and no open redirect.
- Dynamic registration request/response forwarding, size limits, malformed
  responses, upstream OAuth errors, redirects disabled, and no local store.
- Authorization-code exchange forwards exact PKCE/client values.
- Refresh exchange forwards the refresh token once, preserves rotation, and
  returns `offline_access` in the granted scope.
- Public, basic-auth, and post-body client authentication.
- Invalid/revoked/reused refresh token maps to `invalid_grant`, not 500.
- Timeout/unavailable/malformed upstream response mappings.
- No-store headers and log-redaction assertions using sentinel credentials.
- Existing access-token verification and MCP session-binding regression tests.
- Feature-flag off preserves current discovery behavior.

### `presscart-app`

- Existing initial token-hook behavior remains green.
- A refresh-shaped hook call with an existing `grant_id` resolves by that ID,
  verifies the same user/client binding, preserves upstream `iat` and `exp`,
  removes stale permissions, and returns the MCP audience and grant identity.
- Revoked, deleted, user-mismatched, and client-mismatched grants reject refresh
  issuance.
- Browser login, consent approval, and ordinary Supabase session tests remain
  unchanged and green.

### Verification commands

At minimum before handoff:

- `presscart-mcp`: `npm test`, `npm run check`, and `npm run build`.
- `presscart-app`: focused OAuth tests, `pnpm type-check`, and the repository's
  appropriate build/test gate for touched workspaces.
- Both repositories: security-focused Codex review with no unresolved Critical
  or Important findings.

### Live compatibility matrix

Smoke-test the published HTTPS service with:

- ChatGPT workspace custom app;
- Claude remote HTTP MCP;
- Cursor remote HTTP MCP;
- Codex remote HTTP MCP.

For ChatGPT, connect and invoke a low-risk read tool, then invoke it again after
the one-hour access-token lifetime without an authorization prompt. A direct
refresh-grant smoke test verifies rotation before the one-hour observation, but
does not replace the real client test.

## Rollout

1. Deploy the translator behind its disabled feature flag.
2. Enable and validate it in a non-production environment using public HTTPS.
3. Verify discovery, registration, authorization-code exchange, refresh, token
   rotation, grant revocation, and safe error responses.
4. Enable it for production discovery while retaining the flag as rollback.
5. Create a replacement ChatGPT workspace app, authenticate, scan tools, and
   complete the before/after-expiry validation.
6. Publish the replacement while temporarily retaining the previous published
   app so members can reconnect once.
7. Publish reconnect instructions for ChatGPT, Claude, Cursor, and Codex.
8. Retire the old ChatGPT app only after the replacement is verified and the
   workspace migration window has completed.

The rollout works for Business and Enterprise/Edu workspaces: it does not rely
on in-place editing of a published app. Normal Presscart web sessions are not
routed through the translator.

## Acceptance criteria

- Protected-resource discovery points clients to the MCP-origin authorization
  server when the feature flag is enabled.
- Authorization-server discovery advertises authorization code, PKCE S256,
  dynamic registration, refresh tokens, and `offline_access`.
- A public OAuth client completes registration and authorization code + PKCE
  through the translator.
- The initial token response contains an MCP-audience access token and a refresh
  token without Presscart persisting either token.
- A refresh request returns a new valid MCP access token and preserves a rotated
  refresh token.
- The `presscart-app` hook rejects refresh after grant revocation or identity
  mismatch.
- A refreshed access token can continue an MCP session only for the same user,
  client, and grant.
- ChatGPT can call a low-risk Presscart MCP tool after the one-hour access-token
  lifetime without prompting the user to authenticate again.
- A newly published ChatGPT workspace app exposes its platform-controlled
  Connect/Authenticate experience and completes OAuth.
- Claude, Cursor, and Codex can complete the same standards-based OAuth flow;
  refresh is automatic where the client supports it.
- Existing non-MCP Presscart application sessions and legacy direct-token MCP
  mode are unchanged.
- No credential value appears in logs, errors, tests, fixtures, or committed
  files.

## References

- OpenAI, "Developer mode and MCP apps in ChatGPT":
  https://help.openai.com/en/articles/12584461
- MCP TypeScript SDK authorization guidance:
  https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/authorization.md
- Supabase OAuth 2.1 flows:
  https://supabase.com/docs/guides/auth/oauth-server/oauth-flows
- Supabase MCP authentication:
  https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication
- Claude remote MCP authentication:
  https://code.claude.com/docs/en/mcp
- Cursor MCP OAuth:
  https://cursor.com/docs/mcp
