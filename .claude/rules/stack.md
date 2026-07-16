# Stack Conventions

**This file is the single place that pins the project's tech stack.** The reviewer agents, the workflow rule, and `create-pr` all read their stack-specific conventions from here. When reusing this base config on a project with a different stack, edit **only this file** — the workflow, skills, and agents stay unchanged.

## Assumed stack

- TypeScript (strict) on Node.js ≥ 22, ESM (`"type": "module"`, `module: NodeNext`)
- MCP server: `@modelcontextprotocol/sdk` (`McpServer`) served over Streamable HTTP via Express 5
- Validation: Zod — for env vars, tool input schemas, and tool output schemas
- Auth: MCP OAuth (Supabase issuer, `jose` for JWT verification) or `X-Presscart-API-Token` header when OAuth is disabled
- Tests: built-in `node:test` + `node:assert/strict`, run via `npm test` (`node --import tsx --test "src/**/*.test.ts"`)
- Dev: `tsx` (`npm run dev`) · Build: `tsc` → `dist/` · Typecheck: `npm run check`
- Deploy: Railway (injects `PORT`) · Release: semantic-release from Conventional Commits (enforced by commitlint + husky)

## Project layout

- `src/http.ts` — Express entrypoint: transport, sessions, OAuth wiring.
- `src/server.ts` — MCP server assembly.
- `src/api.ts` — `PresscartApiClient` (fetch wrapper around the Presscart backend API) and `PresscartApiError`.
- `src/env.ts` — Zod-validated environment. Import `env` from here; never read `process.env` directly elsewhere.
- `src/tools/` — one file per domain (`campaigns.ts`, `comments.ts`, …), each exporting `register<Domain>Tools(server, options)`, aggregated in `src/tools/index.ts`. Shared schema fragments in `schemas.ts`, shared tool annotations in `metadata.ts`.
- `src/utils/` — cross-cutting helpers (`tool-context.ts`, `tool-result.ts`, `errors.ts`, `query-filters.ts`, `sensitive-fields.ts`, …).
- ESM rules: relative imports carry the `.js` extension; use `import type` for type-only imports; named exports everywhere (no default exports).

## MCP tool conventions

- Register with `server.registerTool(name, { title, description, inputSchema, annotations }, handler)`.
- Tool names and input fields are `snake_case`, mirroring the backend API (`list_comments`, `article_id`).
- Reuse shared schema fragments from `tools/schemas.ts` (`paginationSchema`, `sortSchema`, `teamSlugSchema`) by spreading them into `inputSchema`; add `.describe()` to any non-obvious field.
- Pick the annotation set from `tools/metadata.ts` that matches the operation: `readOnlyTool`, `additiveWriteTool`, `updateTool`, or `replaceTool` (destructive).
- Handler shape, in order: `requirePermission(extra, options, 'domain.action')` → `createPresscartApiClient(extra, options)` → call the API (build query strings with `appendQueryFilters`) → return `jsonResult(response)`.
- Descriptions are written for LLM callers: state prerequisites ("requires article_id; call a listing tool first"), point to sibling tools, and discourage redundant calls. Treat description quality as part of the contract.

## Error handling & security

- Backend errors surface through `PresscartApiError` and are mapped by `formatServerError` — auth failures become `Unauthorized`, 5xx becomes a generic unavailable message. Never leak raw backend error bodies or tokens to MCP clients.
- Strip or mask sensitive fields in responses via `utils/sensitive-fields.ts` rather than ad hoc deletes.
- All configuration enters through `src/env.ts`; new env vars get a Zod schema entry and, if secret, stay out of git (`.env` is ignored).

## TypeScript quality

- No `any` — use `unknown` plus narrowing or a Zod parse.
- Strict null checks respected; no non-null assertions to silence the compiler.
- Zod output schemas use `.passthrough()` when the backend may add fields.

## Testing conventions

- Tests are colocated `*.test.ts` files next to the module under test, using `node:test` and `node:assert/strict` — not Vitest/Jest.
- `src/env.ts` parses at import time, so set required env vars at the top of the test file **before** dynamically importing the module under test (`await import('./comments.js')`).
- Mock at the network boundary only: stub `globalThis.fetch`, capture calls, and restore the original in `finally`. Never mock the MCP SDK, Zod, or internal utils — let real registration and validation run.
- Exercise tools through their registered handlers (fake server harness capturing the tools map) and assert on the actual request: URL pathname, query params, method, and body.
- `npm test` and `npm run check` must both pass before a PR.
