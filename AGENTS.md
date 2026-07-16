# Project Agent Instructions

This repository contains project-scoped agent rules, skills, and reviewer agents.
Codex reads this file before doing work in the repo. Codex-native artifacts
live in:

- `.agents/skills/` for reusable Codex skills.
- `.codex/agents/` for Codex custom subagents.
- `.codex/rules/stack.md` for the pinned stack conventions.
- `.codex/config.toml` for project agent defaults.
- `AGENTS.md` for durable repository instructions.

## Workflow

### Orchestration Discipline

These rules govern the top-level agent in the user-facing thread.

If you are spawned as a subagent, you are a terminal worker. Do the assigned
work directly, report results, and do not spawn further subagents. Keep agent
depth to one level: main agent -> worker.

For non-trivial tasks, the main agent should orchestrate instead of doing all
implementation inline. Treat a task as non-trivial when it has 3 or more steps,
touches 2 or more files, or needs review gates.

The main agent may do inline:

- Read files to gather context.
- Run non-destructive commands such as `git status`, `ls`, `rg`, and tests.
- Make a true one-line trivial edit.
- Invoke Codex skills such as `$commit`, `$codex-review`, `$create-pr`, and
  `$merge-pr`.
- Commit, push, and create PRs through the project skills.

The main agent should delegate when practical:

- Writing function bodies, hooks, or component implementations.
- Writing or modifying tests.
- Editing multiple files as one logical change.
- Large documentation rewrites.
- TDD cycles.

When subagents are unavailable or the user asks to work inline, proceed inline
but preserve the same checkpoints: understand the code first, keep edits scoped,
run verification, and report evidence.

### TDD

Feature work and bug fixes should follow red -> green -> refactor.

Use focused tests that exercise real behavior. Test layout, mocking rules,
and test utilities are stack-specific and live in `.codex/rules/stack.md`
("Testing conventions"). Regardless of stack: mock at the network boundary
only, never the data/state libraries themselves, and let integration tests
render real component/module trees.

### Review Gate

After non-trivial implementation and before finishing a branch:

1. Run the project Codex review skill (`$codex-review`) unless the user
   explicitly asks to skip it.
2. Fix Critical and Important findings.
3. Re-run review until APPROVE or the configured round cap is reached.
4. Run the project's tests and build before PR creation.

For pre-implementation plans or specs, use the review skills in design-spec
mode so the plan is checked against the real codebase before implementation.

### Finish Work

Before opening a PR, use the project `$create-pr` skill. It runs the pre-PR
review gate with the Codex custom agents:

- `dry-checker`
- `security-reviewer`
- `api-checker`
- `general-code-reviewer`

Do not open a PR with unresolved Critical findings or failing tests/build.

### Merge — the user's call, not the agent's

The pipeline ends when the PR is open. Merging is the user's decision and the
user's action — do not run the merge yourself, and do not treat green CI plus
an approval as license to land the branch.

After `$create-pr` opens the PR, stop and hand off: report that the PR is up
and ready, and tell the user they can land it by running `/merge-pr`
themselves. That skill (mergeability check, conflict resolution against the
base, squash merge, branch/worktree cleanup) is theirs to invoke.

Only run `$merge-pr` yourself if the user explicitly tells you to merge in this
session. Absent that explicit instruction, prompting the user to run
`/merge-pr` is the correct end state — never the merge itself.

### Committing

Use the `$commit` skill for commits. Do not run raw `git add` or `git commit`
for project work unless the user explicitly overrides the workflow.

Commit messages should use Conventional Commits and explain the why. Do not add
Claude, Anthropic, Codex, or OpenAI co-author/generated-by trailers.

## Security Hygiene

These rules apply to files committed under `.agents/`, `.codex/`, docs,
source, tests, and fixtures.

- Do not commit API tokens, JWTs, OAuth secrets, Stripe keys, Sentry DSNs, real
  database URLs, private keys, or other credentials.
- Use environment variables and gitignored local env files for runtime secrets.
- Use placeholders in examples, such as `sk_test_REPLACE_ME`, `<TOKEN>`, and
  `https://example.com/webhook`.
- Do not hardcode machine-local paths such as `/Users/<name>/...` or
  `/home/<name>/...` in committed skills or rules. Use relative paths or
  environment variables.
- Treat skills and agent instructions as semi-public: avoid internal webhook
  URLs, private team rosters, and anything that grants access on its own.
- Do not bypass pre-commit hooks with `--no-verify` unless the user explicitly
  authorizes it.

## Codex Compatibility Notes

- Codex discovers repo skills from `.agents/skills/**/SKILL.md`.
- Codex discovers project custom agents from `.codex/agents/*.toml`.
- Codex reads `AGENTS.md` once at session start, so restart Codex after changing
  this file if a running session needs the new guidance.
- Some Codex releases have a regression where project custom agents under
  `.codex/agents/*.toml` are not selectable by `spawn_agent`
  (openai/codex#26363). If the custom reviewers won't spawn, run the same
  reviews by pasting each agent's `developer_instructions` into a generic
  subagent prompt.
- Codex primarily reads user config from `~/.codex/config.toml`; if the
  project-scoped `.codex/config.toml` here doesn't take effect on your
  release, merge its settings into your user config.
