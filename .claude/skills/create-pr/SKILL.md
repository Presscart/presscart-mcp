---
name: create-pr
description: Use when the user wants to open a pull request — phrases like "/create-pr", "create the PR", "let's open the PR", "ship this branch", "raise a PR", or any time a feature branch is ready to be merged. Runs the project's pre-PR review gate (dispatches the dry-checker, security-reviewer, api-checker, and general-code-reviewer in diff-scoped mode in parallel), drives fixes for Critical/Important findings, verifies tests and build are green, then writes a structured PR body and opens the PR with `gh`. This is the final step of the project Workflow rule.
---

# Create PR

The last gate before a branch merges. By the time this runs, implementation is done and tests are green — this skill makes sure the diff is **clean, secure, and convention-compliant** before it becomes a PR, then opens it.

## Why this skill exists

A PR is a request for someone else's time and trust. Opening one with duplicated logic, a security hole, or a convention violation wastes a reviewer's attention and erodes that trust. This skill front-loads the automated review the project already knows how to do, so the human reviewer sees a diff that has already passed the bar.

It is the implementation of step 4 ("Finish Work") of the [workflow rule](../../rules/workflow.md), and it follows the [orchestration discipline](../../rules/workflow.md) in section 0: the main agent **orchestrates** — it dispatches reviewers and fixers as subagents and never writes implementation code inline.

## Preconditions (verify before doing anything)

Per the workflow rule, a PR is only created when the work is actually finished. Confirm, in parallel via Bash:

- On a feature branch, not `main`: `git branch --show-current`.
- Working tree is committed (or will be committed as part of this flow): `git status`.
- Detect the project's package manager and scripts first: lockfile → manager
  (`pnpm-lock.yaml` → pnpm, `bun.lock`/`bun.lockb` → bun, `yarn.lock` → yarn,
  `package-lock.json` or none → npm); script names from `package.json` (they
  may differ from `test`/`build`, or not exist yet in a fresh project).
- Tests are green: run the detected test command. If no test script exists,
  report that instead of inventing one.
- Build passes: run the detected build command (same rule).
- Codex has approved (the workflow runs `/codex-review` before this step). If it hasn't been run yet, stop and tell the user to run `/codex-review` first — do not open a PR around unreviewed code.

If any precondition fails, **stop and report** — don't open a PR around a broken branch.

## The workflow

### Phase 1 — Establish the diff scope

Determine the branch's base and the changed files:

```bash
BASE=$(git merge-base HEAD origin/main 2>/dev/null \
   || git merge-base HEAD main 2>/dev/null \
   || git merge-base HEAD origin/master 2>/dev/null \
   || git merge-base HEAD master)
git diff --name-only "$BASE"...HEAD
git diff "$BASE"...HEAD --stat
```

Read the relevant plan/spec (under `tasks/` or `docs/`) so you can pass plan context to the general-code-reviewer and write an accurate PR description.

### Phase 2 — Dispatch the review gate (parallel, diff-scoped)

Dispatch all four reviewer agents **in a single message** so they run concurrently. Each runs in **diff-scoped** mode against the base computed above. In the prompt to each, state the mode explicitly and pass the base ref.

- **`dry-checker`** — duplication in the diff (literal + semantic), compared against the whole codebase.
- **`security-reviewer`** — vulnerabilities and weak security layers introduced by the diff.
- **`api-checker`** — API contract integrity of the diff: client↔server drift, breaking changes to existing endpoints, request/response shape mismatches, error-contract consistency.
- **`general-code-reviewer`** — plan alignment plus the stack conventions in `.claude/rules/stack.md` (framework patterns, component library usage, naming, state management, props, TypeScript quality). Pass the plan/spec you read in Phase 1.

Wait for all three to return.

### Phase 3 — Synthesize and fix

Merge the four reports into one list, de-duplicated, sorted by severity:

- **Critical** (any reviewer) — must fix before the PR opens.
- **Important** — should fix before the PR opens.
- **Suggestions / low** — note in the PR description as follow-ups; don't block on them.

Fix Critical and Important findings by **dispatching a subagent per logical fix** (orchestration discipline — the main agent does not write the fix itself). If a fix is a true one-line trivial change (typo), the main agent may do it inline.

Each fixer subagent is a **terminal worker**: it applies its assigned fix directly (writes the code, edits the files, runs the tests) and **must not dispatch further subagents**. Keep dispatch depth at one level — main agent → fixer — to avoid the nesting chains that stall the review-fix loop. Scope each subagent to a single logical fix so it stays small enough to do inline.

After fixes, re-verify with the test and build commands detected in the preconditions. If a reviewer found something substantive and you changed real logic, **re-dispatch that reviewer** on the updated diff to confirm the finding is resolved. Loop until Critical and Important findings are cleared or the user accepts the remaining risk.

### Phase 4 — Commit anything outstanding

If the fixes produced uncommitted changes, commit them using the `commit` skill (Conventional Commits, grouped by concern). Do not bundle unrelated changes.

### Phase 5 — Push and open the PR

```bash
git push -u origin "$(git branch --show-current)"
```

Then open the PR with `gh`, using the body template below. Show the user the title and body and **get approval before running `gh pr create`** unless they've told you to proceed without asking.

```bash
gh pr create --title "<conventional title>" --body "$(cat <<'EOF'
<body>
EOF
)"
```

## PR body template

```
## Summary
[1-3 sentences: what this PR does and why]

## Changes
- [Key change, grouped by concern]
- [...]

## Plan / Spec
[Link or reference to the plan step this implements; note any justified deviations]

## Review Gate
- DRY check: <pass | findings fixed — summary>
- Security review: <pass | findings fixed — summary>
- API contract check: <pass | findings fixed — summary>
- General review: <pass | findings fixed — summary>
- Codex: <APPROVE>
- Tests: `<test command>` ✅  ·  Build: `<build command>` ✅

## Follow-ups (non-blocking)
- [Any low-severity suggestions deferred to later]

## Test Plan
- [How to verify; what the automated tests cover]
```

## Rules

- **Never** open a PR with unresolved Critical findings or failing tests/build.
- **Never** `git push --no-verify` or bypass pre-commit hooks (see the `security-hygiene` rule).
- Run the four reviewers in **diff-scoped** mode here. Full-project mode is for manual sweeps, not the PR gate.
- Orchestrate — dispatch reviewers and fixers as subagents; the main agent classifies, synthesizes, commits, and opens the PR.
- After the PR is open, consider `superpowers:finishing-a-development-branch` for any remaining cleanup/merge decisions.
