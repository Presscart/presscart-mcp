---
name: drive
description: >-
  Use this to kick off a full end-to-end feature workflow and have the agent run
  it NON-STOP through spec → review → plan → review → implementation. Trigger
  whenever the user says "/drive", "let's get to work", "start working on
  X", "let's build/ship X", "get this done", "take this from idea to merge", or
  otherwise signals they want to begin a real piece of development work and have
  it carried all the way through with minimal hand-holding. This is the
  orchestrator that chains superpowers' brainstorming, codex-review,
  writing-plans, and the dispatch/execution skills into one continuous run,
  suppressing the usual "should I continue?" checkpoints. Use it even when the
  user doesn't name the skill but clearly wants to start substantial feature
  work from a clean base branch. Do NOT use it for one-off edits, quick
  questions, debugging an existing bug, or reviewing code that already exists.
---

# Drive

You are the **orchestrator** of a continuous development pipeline. The user
invoked this skill because they want to take a piece of work from a clean
`staging` all the way to "ready to merge" without babysitting you between
stages. Your job is to drive the whole pipeline, calling other skills in
sequence, and **only stopping at the two checkpoints that genuinely need a
human.**

**Base branch in this repo: `staging`.** Features branch off `staging` and
merge back into `staging`. `main` is the stable release branch — it only
advances by merging `staging` (semantic-release cuts `rc` prereleases from
`staging` and stable releases from `main`). Nothing in this pipeline touches
`main`.

**Announce at start:** "Using drive to run the full spec → review → plan →
review → implementation pipeline. I'll only stop for the brainstorming questions
and the final merge approval."

## The Non-Stop Contract

This is the heart of the skill. The sub-skills you call each have their own
natural "stop and ask the human" moments. Most of those exist for a solo run —
here, **you** are the one driving continuity, so you suppress them. The reason
matters: the user has explicitly traded per-stage check-ins for one upfront
planning conversation and one final gate. Honoring that trade is the whole
point. If you stop to ask "should I proceed to the plan now?" you've broken the
contract and wasted their attention.

**There are exactly two places you stop for the human:**

1. **The brainstorming conversation** (Stage 3) — this is interactive by design.
   The user *wants* to be asked questions here; this is where the careful
   thinking happens. Let brainstorming run its normal Q&A.
2. **The final merge approval** (Stage 8) — once everything is built, reviewed,
   and green, you present the work and ask whether to integrate it.

**Everywhere else, you keep moving.** Spec gets written → you send it to review
without asking. Review approves → you start the plan without asking. Plan gets
written → you send it to review without asking. Review approves → you pick an
executor and start building without asking.

The **only** other reasons to stop mid-pipeline are genuine blockers: `staging`
isn't clean (Stage 1), a sub-skill reports it's truly stuck and you can't
resolve it, or a review is *genuinely stalled* (see "Review loop rules"). A
blocker is something that prevents progress — not a routine decision you could
make yourself.

## Prerequisites

This skill orchestrates other skills. They must be available in the current
project:

- **superpowers** skills: `brainstorming`, `writing-plans`,
  `subagent-driven-development`, `dispatching-parallel-agents`,
  `using-git-worktrees`, `finishing-a-development-branch`.
- **codex-review** skill (`/codex-review`) — the cross-model review gate.

If `/codex-review` isn't available in this project, say so and ask the user how
they want to handle the review gates before continuing.

## The Pipeline

Create a TodoWrite list with these stages so the user can see the whole arc and
you don't lose the thread between sub-skill calls:

1. Verify `staging` is clean
2. Create an isolated worktree
3. Brainstorm the spec (interactive)
4. Codex-review the spec → loop until **Approved**
5. Write the implementation plan
6. Codex-review the plan → loop until **Approved**
7. Choose executor and implement (with per-phase review)
8. Present for merge approval (interactive)

---

### Stage 1 — Verify `staging` is clean

`staging` must be clean before any work starts. Check it:

```bash
git rev-parse --abbrev-ref HEAD   # confirm you're on staging (the feature base)
git status --porcelain            # MUST be empty
```

**If there is any output from `git status --porcelain`** (uncommitted, unstaged,
or untracked changes): **abort and report.** Show the user exactly which files
are dirty and ask them to commit, stash, or clean up before re-running the
skill. Do not stash or commit on their behalf — a dirty base branch is a signal
that something else is in flight, and silently moving their work risks losing
it.

**If clean:** proceed to Stage 2.

If you're not on `staging`, point that out and confirm the intended base branch
before continuing (in this repo `main` is the release branch — do not base
feature work on it). Also make sure `staging` is up to date with
`origin/staging` before branching off it.

### Stage 2 — Create an isolated worktree

If the user gave a task in their message, use it. If they invoked the skill bare
(no task), ask one short question first: *"What are we working on? One line is
enough — brainstorming will dig into the details."* Use their answer to name the
branch/worktree.

Then invoke **`superpowers:using-git-worktrees`** to create the isolated
workspace off `staging`. Follow that skill exactly (it detects existing
isolation, prefers native worktree tools, verifies a clean test baseline).
Everything from here runs inside the worktree.

### Stage 3 — Brainstorm the spec (interactive — STOP point #1)

Invoke **`superpowers:brainstorming`** and let it run its **normal** session:
project exploration, one-question-at-a-time clarification, 2-3 approaches,
design presentation, and design approval. This is the deliberate planning the
user wants — do not rush it or try to skip the questions.

Brainstorming will write the spec to
`docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` and commit it.

**Override brainstorming's final gate.** Brainstorming normally ends by asking
the user to review the written spec and *then* invoking `writing-plans`. Under
drive, you do **not** ask the user to review the spec, and you do **not**
go straight to `writing-plans`. The spec's reviewer is Codex now. The moment the
spec is written and committed, move to Stage 4 without prompting.

(The design-approval step *inside* brainstorming still happens — that's part of
the interactive session. It's the separate "please review the committed spec
file" gate that drive replaces with Codex review.)

### Stage 4 — Codex-review the spec → loop until Approved

Invoke **`/codex-review <path-to-spec-file>`**. Passing the spec file path makes
codex-review run in **DESIGN-SPEC mode** — a pre-implementation gate that checks
feasibility against the real codebase, gaps, internal consistency, and scope.

Apply the **Review loop rules** below: keep going until the verdict is
**Approved**. When Codex requests changes, fix the spec, commit, and resume.

When the spec is Approved, move to Stage 5 without prompting.

### Stage 5 — Write the implementation plan

Invoke **`superpowers:writing-plans`** against the approved spec. It writes the
plan to `docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md`.

**Override writing-plans' execution handoff.** writing-plans normally ends by
asking the user to choose between "Subagent-Driven" and "Inline Execution." Do
**not** ask that question. Under drive, the plan goes to Codex review
first (Stage 6), and *you* choose the executor afterward (Stage 7) by analyzing
the plan. Skip the handoff prompt entirely and move to Stage 6.

### Stage 6 — Codex-review the plan → loop until Approved

Invoke **`/codex-review <path-to-plan-file>`** (DESIGN-SPEC mode again — a plan
is a planning doc). Apply the **Review loop rules**: loop until **Approved**,
fixing and committing plan revisions between rounds.

When the plan is Approved, move to Stage 7 without prompting.

### Stage 7 — Choose executor and implement

Read the approved plan and decide how to execute it. See **"Choosing the
executor"** below. Then run the chosen skill to completion.

During execution, codex-review runs again as a **code** review — at the end of
each phase (PHASE mode) and once across the whole branch before merge (BRANCH
mode). The same **Review loop rules** apply to every one of those reviews: loop
until Approved, don't stop at the cap. `subagent-driven-development` already runs
continuously and ends by handing off to `finishing-a-development-branch` — that
handoff is your Stage 8.

### Stage 8 — Present for merge approval (interactive — STOP point #2)

When implementation is complete, all tests pass, and the final branch review is
Approved, this is the one place at the end where the human decides. Present a
tight summary of what was built and what the reviews concluded, then drive the
integration choice.

**First, check whether `staging` has advanced.** Before presenting options,
detect divergence between the feature branch and `staging`:

```bash
# >0 means staging has commits the feature branch doesn't have (it advanced
# since this branch's base — e.g. someone else merged while you worked).
git rev-list --count HEAD..staging
```

- **If the count is `0`** (staging has not advanced): present the standard
  options and proceed normally.
- **If the count is `>0`** (staging has new updates): a plain local merge or a
  PR opened from a stale base would produce a noisy merge commit and, worse,
  your branch was reviewed against a now-stale base. So **lead with the two
  rebase options and recommend one of them** (rebase + merge locally by default;
  rebase + PR if this work is destined for review on the remote).

**The merge menu under drive (override).**
`superpowers:finishing-a-development-branch` normally presents a fixed
merge / PR / keep / discard menu. Under drive you augment it with the two
rebase options. Present these to the user (lead with the rebase options when
staging has advanced):

1. **Rebase onto `staging`, then merge locally** *(recommended when `staging`
   has advanced and the work merges straight to `staging`)* — rebase the
   worktree branch onto the latest `staging`, resolve any conflicts, re-verify,
   then merge into `staging` locally.
2. **Rebase onto `staging`, then push and open a PR** *(recommended when
   `staging` has advanced and the work goes through PR review)* — rebase onto
   the latest `staging`, resolve any conflicts, re-verify, then push and open a
   Pull Request targeting `staging` from the freshly-rebased branch.
3. Merge back to `staging` locally (no rebase)
4. Push and create a Pull Request targeting `staging` (no rebase)
5. Keep the branch as-is
6. Discard this work

Promotion from `staging` to `main` (the release) stays outside this pipeline —
never offer `main` as the integration target here.

**If the user chooses either rebase option (1 or 2):** first perform the shared
rebase + re-verify procedure, then branch on the chosen integration target.

*Shared rebase + re-verify procedure:*

1. From inside the worktree, rebase onto the updated base:
   ```bash
   git rebase staging
   ```
2. **Resolve any conflicts** that arise. Treat each conflict with real care —
   understand both sides before resolving (use `superpowers:systematic-debugging`
   if a conflict is non-obvious). After editing the conflicted files,
   `git add <files>` and `git rebase --continue`. Repeat until the rebase
   completes. If the rebase is genuinely beyond safe automatic resolution
   (deep semantic conflicts), stop and surface it to the user rather than
   guessing — a botched conflict resolution is worse than asking.
3. **Re-verify after the rebase**, because the branch now sits on new code:
   run the full test suite, and if the rebase resolved any non-trivial conflict
   (i.e., the merge wasn't clean), run one more `/codex-review` BRANCH pass and
   apply the **Review loop rules** until Approved. A clean, conflict-free rebase
   needs only the test suite green.

*Then, depending on the chosen target:*

- **Rebase + merge locally (option 1):** hand off to
  **`superpowers:finishing-a-development-branch`** to perform the local merge
  into `staging` and the worktree/branch teardown.
- **Rebase + PR (option 2):** hand off to
  **`superpowers:finishing-a-development-branch`** to push the rebased branch
  and open the Pull Request targeting `staging`, then handle worktree teardown
  per that skill.

**For every other choice** (merge without rebase, PR without rebase, keep,
discard), invoke **`superpowers:finishing-a-development-branch`** directly — it
verifies tests, executes the choice, and handles worktree teardown.

---

## Review loop rules (Stages 4, 6, and every review in 7)

The user's standing instruction: **do not stop until the verdict is Approved.**
codex-review has a built-in 3-round cap and, on hitting it, normally stops and
hands back to the human. Under drive you **override that cap** — when a
review hits its round cap without Approved, re-invoke `/codex-review` (a fresh
invocation restarts the round counter with full context of the current state)
and keep iterating. The goal is the Approved verdict, not a fixed number of
rounds.

**One responsible guardrail — the stall check.** "Keep going until Approved"
assumes each round makes progress. If it doesn't, looping forever just burns
tokens and hides a real problem. So before starting another full cycle past the
cap, check: *are we actually converging?*

- Fewer/less-severe findings each round, or new distinct findings → **converging,
  keep going.** This is normal; continue without involving the user.
- The **same** Critical/Important findings recur with no progress, or Codex and
  your fixes are in a genuine standoff (e.g., a disagreement rooted in the spec
  itself, or a constraint that can't be satisfied as written) → **that's a real
  blocker, not a cap.** Pause and surface it: explain what's stuck and why, and
  ask the user how to proceed (rework the spec/plan, accept the risk, or change
  scope). This is the senior-engineer move — you're stopping because progress
  has genuinely stalled, not because a counter hit 3.

Never force-approve, and never skip lint/typecheck/tests to make a fix pass —
fix the underlying issue (this is codex-review's own rule; honor it).

## Choosing the executor (Stage 7)

After the plan is Approved, analyze its task structure to pick the executor.
**Default to `superpowers:subagent-driven-development`** — it's the plan executor
built for this: fresh subagent per task, two-stage review (spec compliance, then
code quality), continuous execution with no per-task check-ins, and a clean
handoff to `finishing-a-development-branch`. Most feature plans are incremental
and want this.

**Only choose `superpowers:dispatching-parallel-agents` when the plan genuinely
decomposes into independent parallel workstreams** — distinct tasks with no
shared state, no sequential dependency (Task N doesn't build on Task N-1), and no
overlapping files. Think several unrelated modules or independent fixes that
could each be handed to a separate agent at the same time without conflict.

Decision heuristic:

| Plan shape | Executor |
|---|---|
| Tasks build on each other / share files / form one incremental feature (the common case) | `subagent-driven-development` |
| 2+ fully independent workstreams, no shared state, no ordering, no file overlap | `dispatching-parallel-agents` |
| Mixed — a few independent chunks, each internally sequential | `subagent-driven-development`, or parallel-dispatch the independent chunks then review the integrated result |

If you choose parallel dispatch, you still own quality: after the agents return
and you integrate their work, run the branch through `/codex-review` (Review loop
rules apply) before Stage 8 — `dispatching-parallel-agents` doesn't include the
spec/quality review gates that `subagent-driven-development` does.

State your choice and the one-line reason ("Tasks are sequential and share the
parser module → subagent-driven"), then proceed without asking for confirmation.

## When you're tempted to stop

If you catch yourself about to write "Should I proceed to..." or "The spec is
approved — want me to start the plan?" — that's the contract breaking. Re-read
"The Non-Stop Contract." Unless you're at one of the two human checkpoints or
hitting a genuine blocker, the answer is: keep going.

## Quick reference

| Stage | Skill | Stops for human? | Override applied |
|---|---|---|---|
| 1. Clean staging | (git) | only if dirty | — |
| 2. Worktree | `using-git-worktrees` | no | — |
| 3. Brainstorm | `brainstorming` | **yes (Q&A)** | skip its spec-review gate; don't auto-call writing-plans |
| 4. Spec review | `/codex-review <spec>` | no | loop past 3-round cap until Approved |
| 5. Plan | `writing-plans` | no | skip its execution-handoff question |
| 6. Plan review | `/codex-review <plan>` | no | loop past 3-round cap until Approved |
| 7. Implement | `subagent-driven-development` or `dispatching-parallel-agents` | no | you pick executor; per-phase reviews loop until Approved |
| 8. Finish | `finishing-a-development-branch` | **yes (merge choice)** | if `staging` advanced (`git rev-list --count HEAD..staging` > 0), lead with two recommended rebase options — "Rebase onto staging, then merge locally" and "Rebase onto staging, then push + open PR targeting staging"; both share rebase → resolve conflicts → re-verify (+BRANCH review if conflicts were non-trivial), then diverge on the integration target |
