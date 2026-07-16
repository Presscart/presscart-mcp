# Workflow

How work flows through this project: from a task, to implementation, to review, to a merged branch. Read **section 0 first** — it governs everything else.

## 0. Orchestration Discipline (Read This First)

> **Who this section applies to — read before anything else.**
>
> This entire section governs the **top-level (main) agent only** — the one talking directly to the user.
>
> **If you were dispatched as a subagent, this section does NOT apply to you. You are a terminal worker (an IC). Do the work you were assigned directly — write the function bodies, edit the files, run the tests yourself. You MUST NOT dispatch further subagents to do your assigned work.** The only depth allowed is one level: main agent → worker. A worker that dispatches another worker creates an infinite nesting chain that wastes time and context. If your task feels too big, do it anyway or report back to the orchestrator — never re-delegate.

**If you find yourself about to write a function body, stop and dispatch a subagent.**

This rule applies to any task that has **3+ steps OR touches 2+ files OR needs review gates**. For those tasks, the main agent is an **orchestrator, not an IC** — its job is classification, dispatch, synthesis, and review.

### The main agent MAY do inline

- Read files to gather context for a subagent prompt
- Run non-destructive bash (`git status`, `ls`, `grep`, `npm run test` for verification)
- Edit a single line in a single file for a trivial fix (e.g. a typo) — **never** multi-line code or function bodies
- Invoke the Skill tool for slash commands (e.g. `/codex-review`)
- Commit (always via the `commit` skill — see section 5), push, create PRs
- Reply to Slack / Jira

### The main agent MUST delegate to a subagent

- Writing any function body, hook, or component implementation
- Writing or modifying tests
- Editing multiple files as part of one logical change
- Large doc rewrites (> 20 lines of new prose)
- Any TDD cycle (red → green → refactor)

## 1. Multi-Task Implementation (Subagent-Driven Development)

Break feature work into independent tasks and dispatch them to subagents. Each subagent owns one task end-to-end (TDD cycle included). The main agent classifies, dispatches, and synthesizes results — it does not write the implementation itself.

## 2. TDD Workflow (All Feature Work)

All feature work follows test-driven development: **red → green → refactor**, run inside a subagent.

### Test Types

Test layout, mocking rules, and test utilities are stack-specific and live in the stack rule — see [stack.md](stack.md) ("Testing conventions"). The invariants regardless of stack:

- Unit tests cover pure logic and behavior in isolation; mock at the **network boundary only**, never the data/state libraries themselves.
- Integration tests exercise the full feature flow against mocked network handlers, rendering the real component/module tree.

## 3. Codex Code Review (After Implementation)

After all tasks are implemented and tests are green, run `/codex-review` **before finishing the branch**.

Codex reviews for correctness, security, performance, accessibility, and maintainability. The review runs in rounds until **APPROVE or 3 rounds max**.

### Process

1. Invoke `/codex-review` via the **Skill tool** (it is a slash command, not a subagent). This is the only sanctioned way to run Codex review on this project. Do **NOT** spawn a `superpowers:code-reviewer` subagent for Codex-level review — that is a different tool (Claude reviewer, not Codex) and will produce a different, weaker result.
   - Invocation: use the Skill tool with `skill: "codex-review"`.
2. Fix **Critical** and **Important** findings.
3. Re-submit until **APPROVE**.
4. Then proceed to QA.

**Do not skip Codex review on any non-trivial implementation.**

## 4. Finish Work

When all tasks are done, tests are green, Codex has approved, and the project's build command passes:

- If the superpowers plugin is installed, use `superpowers:finishing-a-development-branch`; otherwise finish the branch manually (final commit, push, PR, cleanup).
- Use the project-scoped `create-pr` skill to open the PR.

## 5. Merge — the user's call, not the agent's

**The pipeline ends when the PR is open.** Merging is the user's decision and the user's action — do **not** run the merge yourself, and do not treat a green CI + an approval as license to land the branch.

After `create-pr` opens the PR, stop and hand off: report that the PR is up and ready, and tell the user they can land it by running **`/merge-pr`** themselves. That skill (mergeability check → conflict resolution against the base → squash merge → branch/worktree cleanup) is theirs to invoke.

Only run `merge-pr` yourself if the user explicitly tells you to merge in this session. Absent that explicit instruction, prompting the user to run `/merge-pr` is the correct end state — never the merge itself.

## 6. Committing

**Always commit via the `commit` skill** — never run raw `git add` / `git commit` by hand. The skill groups changes by concern into Conventional Commits with bodies that explain the *why*, then stages and commits straight away — there is no preview or approval gate. This applies everywhere commits happen: mid-implementation checkpoints, fix-up commits during the review gate, and the final commit before `create-pr`.
