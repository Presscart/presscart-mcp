---
name: merge-pr
description: Use when the user wants to merge a pull request — phrases like "$merge-pr", legacy "/merge-pr", "merge this PR", "merge it", "land this branch", "squash and merge". Confirms the PR is mergeable, resolves any merge conflict against the base until the branch is clean, then squash-merges and cleans up the branch or worktree. Use this even when the PR shows a conflict — resolving it to a clean, mergeable state is the job, not a reason to stop.
---

<!-- Mirrored skill: a Claude Code twin of this file ships in the kane-claude bundle (.claude/skills/merge-pr/SKILL.md). Apply shared fixes to both copies; only invocation syntax and tool wording intentionally differ. -->

# Merge PR

The last mile: take an approved PR from "there's a conflict / not sure it's mergeable" to a single clean commit on the base branch, with the branch and any worktree cleaned up behind it.

## Why this skill exists

A PR that sits blocked on a conflict is dead weight — the reviewer already approved it, and the only thing between it and `main` is mechanical. This skill does that mechanical work correctly: it resolves the conflict **on the feature branch** (never on `main`), verifies the result still builds and passes tests, then squash-merges so `main` gets one clean commit instead of the branch's WIP noise. Squash also means the conflict-resolution merge commits never reach `main`.

## Preconditions

- `gh` is authenticated (`gh auth status`).
- The working tree is committed — resolving a conflict needs a clean tree to start from. If there are uncommitted changes, commit or stash them first (use the `$commit` skill).

## Process

### 1. Identify the PR

- If the user gives a PR number, use it.
- Otherwise resolve the current branch's PR: `gh pr view --json number,title,state,headRefName,baseRefName,isCrossRepository`.
- Confirm it exists and `state` is `OPEN`. If it's already `MERGED` or `CLOSED`, stop and say so.

### 2. Assess mergeability

```bash
gh pr view <number> --json mergeable,mergeStateStatus,headRefName,baseRefName
```

- `mergeable`: `MERGEABLE` | `CONFLICTING` | `UNKNOWN`.
- `mergeStateStatus`: `CLEAN`, `DIRTY` (conflicts), `BEHIND` (base moved ahead), `BLOCKED` (checks/reviews), `UNSTABLE` (non-required check failing), `UNKNOWN`.

GitHub computes `mergeable` asynchronously — if it comes back `UNKNOWN`, wait a couple of seconds and re-query (up to ~3 tries) before treating it as unknown.

- `MERGEABLE` / `CLEAN` → skip to step 4.
- `CONFLICTING` / `DIRTY`, or `BEHIND` → go to step 3 (resolve).
- `BLOCKED` / `UNSTABLE` from **failing CI or missing reviews** → that's the pre-merge gate, handled in step 4, not a conflict. Don't try to "resolve" it by editing code.

### 3. Resolve the conflict until clean

Bring the base branch into the feature branch and resolve, so no force-push is needed (the merges get squashed away on land anyway).

```bash
git fetch origin
git checkout <headRefName>          # the PR's branch
git merge origin/<baseRefName>      # pull the base in; conflicts surface here
```

Then:

1. **Resolve each conflicted file on its own merits.** Read both sides — do not blindly accept `--ours` or `--theirs`. A conflict is a real semantic collision; the resolution has to preserve the intent of *both* changes. For a non-trivial resolution, treat it with the same care as any code change (and, per the orchestration discipline in AGENTS.md, dispatch a Codex subagent for substantial multi-file resolution rather than hand-editing inline).
2. **Complete the merge:** `git add <resolved files>` then `git commit` (accept the default merge message — this commit is squashed away on land, so it need not go through the `$commit` skill).
3. **Verify the resolution didn't break anything** — run the project's detected test and build commands (same detection as `$create-pr`: package manager from the lockfile, script names from `package.json`). A conflict resolved wrong compiles a lie; the gate is what catches it.
4. **Push:** `git push origin <headRefName>` (no `--force` — this is a fast-forward on the branch).
5. **Re-check mergeability** (step 2). Loop until `mergeable` is `MERGEABLE`. If a fresh conflict appears because the base moved again, repeat.

If a conflict is genuinely ambiguous (two intentional changes to the same logic that can't both be right), stop and ask the user how to resolve it — don't guess on semantics.

### 4. Pre-merge gate

Before merging, confirm the PR is actually ready:

```bash
gh pr checks <number>                       # CI — all required checks must pass
gh pr view <number> --json reviewDecision   # APPROVED / REVIEW_REQUIRED / CHANGES_REQUESTED
```

- Failing required CI → **stop and report**. Do not merge red. (If the failure was caused by your conflict resolution, fix it on the branch and push; if it's unrelated, hand it back to the user.)
- `CHANGES_REQUESTED` or `REVIEW_REQUIRED` on a repo that requires review → warn the user and stop unless they explicitly say to merge anyway.
- Unresolved review comments → warn before proceeding.

### 5. Squash merge

```bash
gh pr merge <number> --squash --delete-branch
```

- Combines the branch's commits into one commit on the base, titled from the PR.
- Deletes the **remote** branch.
- **From inside a linked worktree**, the remote merge and remote-branch deletion still succeed, but `--delete-branch`'s *local* cleanup fails with "main is already checked out" (a linked worktree can't check out the base branch). That's expected — do local cleanup in step 6 from the primary checkout.
- If the merge itself fails (branch protection, a race that reintroduced a conflict) → report and, if it's a new conflict, return to step 3.

### 6. Post-merge cleanup — branch or worktree

Detect where you are and clean up accordingly:

```bash
# Are we inside a linked worktree? (git-dir differs from the common git-dir)
[ "$(git rev-parse --git-dir)" != "$(git rev-parse --git-common-dir)" ] && echo worktree || echo branch
```

**If inside a worktree** (do the local steps from the primary checkout — a linked worktree can't check out the base):

```bash
MAIN=$(git rev-parse --path-format=absolute --git-common-dir); MAIN=${MAIN%/.git}
cd "$MAIN"
git checkout <baseRefName>
git pull origin <baseRefName>
git worktree remove --force <worktree-path>   # --force: worktree may carry build artifacts / symlinked env
git worktree prune
git branch -D <headRefName>                    # -D: already merged on the remote
```

**If on a plain branch:**

```bash
git checkout <baseRefName>
git pull origin <baseRefName>
git branch -D <headRefName>
```

In both cases, if `--delete-branch` didn't already remove the remote branch: `git push origin --delete <headRefName>`.

### 7. Report

Confirm the merge and show the squashed commit on the base branch (`git log -1 --oneline <baseRefName>`). Note what was cleaned up (branch and/or worktree) and, if a conflict was resolved, one line on how.

## Why squash merge

- **On the branch:** commit freely per task — keeps the PR reviewable and traceable.
- **On the base:** one commit per PR keeps history clean and scannable.
- **No noise:** WIP commits, "fix lint", and the conflict-resolution merge commits never pollute the base branch.

## Rules

- **ALWAYS** `--squash` — never a merge commit or fast-forward that carries branch noise onto the base.
- **ALWAYS** delete the remote branch after merge (`--delete-branch`), and clean up the local branch + any worktree.
- Resolve conflicts **on the feature branch**, never on the base branch. Merge the base *into* the branch; do not rebase-and-force-push a shared PR branch.
- **NEVER** merge with failing required CI, and **NEVER** merge past `CHANGES_REQUESTED` / required-but-missing review without explicit user say-so.
- **NEVER** blindly resolve a conflict with `--ours`/`--theirs` — read both sides and preserve both intents; verify with build + tests.
- Run post-merge **local** cleanup from the primary checkout, never from inside the worktree.
- Always remove the task worktree after merge (`git worktree remove --force` + `git worktree prune`) so worktrees don't accumulate.
