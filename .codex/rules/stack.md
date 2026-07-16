# Stack Conventions

**This file is the single place that pins the project's tech stack.** The reviewer agents, the workflow rule, and `create-pr` all read their stack-specific conventions from here. When reusing this base config on a project with a different stack, edit **only this file** — the workflow, skills, and agents stay unchanged.

## Assumed stack

- Next.js (App Router) + TypeScript (strict)
- UI: shadcn/ui + Tailwind CSS
- Server state: TanStack Query · UI state: Zustand · Cross-cutting context (auth, theme, tenant): React Context
- Forms: React Hook Form + Zod
- Tests: Vitest/Jest + Testing Library, network mocked with MSW

## Framework patterns (Next.js App Router)

- Server components by default; `"use client"` only where hooks/events/browser APIs are needed.
- `page.tsx` and `layout.tsx` use **default exports** (Next.js requirement).
- All other components use **named exports**.
- No barrel exports (`index.ts`) except for library modules (e.g. `lib/monitoring/index.ts`).
- Route segments follow Next.js conventions (`[slug]`, `loading.tsx`, `error.tsx`).

## Component library (shadcn)

- Wrap shadcn components, don't fork them.
- shadcn components live in `src/components/ui/` (managed by the shadcn CLI).
- Custom components compose shadcn, not duplicate it.
- Form components use React Hook Form + Zod + shadcn Form.

## Naming conventions

- Files: kebab-case (e.g. `member-card.tsx`).
- Components: PascalCase exports (e.g. `MemberCard`).
- Hooks: `use-` prefix files, `use` prefix exports (e.g. `use-members.ts` → `useMembers`).
- Types: PascalCase in `.types.ts` files (e.g. `member.types.ts` → `Member`).
- Stores: `-store` suffix (e.g. `ui-store.ts`).
- Tests: `.test.ts(x)` co-located.

## State management

- API data → TanStack Query (never local state for server data).
- UI state → Zustand (modals, filters, sidebar).
- Auth/theme/tenant context → React Context.
- No prop drilling beyond 2 levels — use context or Zustand.

## Component props

- TypeScript interfaces for props (never inline types).
- Always accept a `className` prop, merge via `cn()`.
- Positive boolean names (`isVisible`, not `hidden`).

## TypeScript quality

- No `any` type (use `unknown` with type guards).
- Strict null checks respected.
- Props interfaces exported for consumers.

## Testing conventions

- **Unit tests** — colocated under `src/**/__tests__/*.test.ts(x)` (or `src/__tests__/`). Cover pure logic and component behavior in isolation. Mock at the **network boundary using MSW**. Do **NOT** mock TanStack Query, Zustand, or React itself — let real library calls execute so API breakage is caught.
- **Integration tests** — full feature flow against MSW handlers: render the real component tree, mock only the network, and use the project's test utilities for theme, auth, and TanStack Query context.
