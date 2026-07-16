# Commit Message Examples

Annotated good and bad examples. The goal is to make the *why* legible to a future debugger.

---

## Good examples

### Example 1: Feature with motivation

```
feat(auth): add JWT refresh flow

- Sessions expired at 1h with no extension path, forcing users to
  re-authenticate mid-task; the refresh endpoint rotates the access
  token while the refresh token slides on a 30-day window
- Refresh tokens are stored hashed with a per-user salt; revoking a
  user invalidates all their refresh tokens via the existing
  revocation list

Refs: #482
```

**Why it works**: Subject names the change tersely. Each bullet carries one reason — the first opens with the *problem* (sessions expiring) and the approach, the second covers safety. Anyone debugging session behavior six months from now finds this commit and immediately knows why JWT refresh exists.

---

### Example 2: Bugfix with root cause

```
fix(export): preserve unicode in PDF filenames on Windows

- The Windows code path used latin-1 to encode the
  Content-Disposition header, mangling non-ASCII filenames into
  "?????.pdf"; switched to RFC 5987 encoding so the original name
  round-trips
- The macOS/Linux code path was already correct because their HTTP
  stack handles encoding implicitly — left untouched
- Tested on Windows 10 and 11 with Chinese, Cyrillic, and emoji
  filenames

Closes: #1138
```

**Why it works**: Names the symptom, the root cause, and the fix. A bullet calls out what was *not* changed and why, which prevents future cleanup attempts from breaking the Windows path.

---

### Example 3: Refactor with non-obvious motivation

```
refactor(api/users): extract pagination into a hook

- Pagination logic was duplicated across UserList, AdminUserList,
  and the audit-log view, and all three were drifting — admin list
  didn't reset the page counter on filter change, and the audit view
  used a different page size constant
- Replaced all three with usePagination, centralizing the reset
  behavior and the page size; no user-visible behavior change in the
  non-buggy paths
```

**Why it works**: Pure refactors are easy to second-guess. The body explains the *drift problem* that motivated the work — which is invisible from the diff alone.

---

### Example 4: Tiny commit, no body needed

```
fix(typo): rename 'recieve' to 'receive' in UserSettings
```

**Why it works**: Subject is self-explanatory. A body would be padding.

---

### Example 5: Breaking change

```
feat(api)!: replace /users/:id/posts with /users/:id/content

- Consolidates posts, drafts, and scheduled items under a single
  endpoint to match the new content-model unification; the old
  endpoint returned posts only, so clients needing drafts had to
  call a separate undocumented endpoint
- Migration: switch to /users/:id/content?type=post to preserve the
  old behavior, or omit the type filter to receive the full content
  stream

BREAKING CHANGE: /users/:id/posts is removed. No deprecation window
because the endpoint had no external consumers (verified via API
gateway logs over the last 90 days).
```

**Why it works**: The `!` after type and the `BREAKING CHANGE` footer flag this for changelog tooling. The body justifies skipping a deprecation window with evidence.

---

## Bad examples

### Bad 1: No why

```
fix: update auth code
```

**Why it fails**: What broke? What was the fix? "Update" is the weakest verb in English — it carries zero information. Future debugger learns nothing.

---

### Bad 2: Restates the diff

```
feat(auth): add refresh.ts

Added a new file refresh.ts that exports a function refreshToken
which takes a refresh token and returns a new access token.
```

**Why it fails**: The diff already shows the file and function. The commit message exists to explain what the diff *can't* show — the motivation. This body is filler.

---

### Bad 3: Smashed-together unrelated changes

```
chore: misc updates

- Add JWT refresh
- Fix typo in user settings
- Bump lodash to 4.17.21
- Update README
- Remove unused FeatureFlagX
```

**Why it fails**: Five unrelated changes in one commit. `git bisect` can't isolate which one introduced a bug. `git revert` is now a hand-grenade. Split into five commits. Note the problem is the *unrelated concerns*, not the bullets — each bullet here is a separate change that deserves its own commit. An itemized body lists the reasons *within one* change; it does not bundle independent changes.

---

### Bad 4: Conversation context leaking in

```
fix: address Codex review round 2 feedback

Per the comments in the PR thread, refactored the thing we
discussed yesterday.
```

**Why it fails**: "The thing we discussed" is meaningless outside the conversation. "Round 2 feedback" requires reading the PR. The commit must stand alone.

Better:

```
fix(critique): debounce the apply button to prevent double-submits

Users could click Apply twice before the streaming response
finished, causing duplicate critique entries. Added a 300ms
debounce and a pending state to the button.
```

---

### Bad 5: Co-author trailer (forbidden)

```
feat(auth): add JWT refresh flow

<body>

Co-Authored-By: Claude <noreply@anthropic.com>
```

**Why it fails**: The user has a standing global rule that commits are authored solely by them. Never add this trailer.
