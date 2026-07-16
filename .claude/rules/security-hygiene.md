# Security Hygiene

These rules apply to anything committed under `.claude/` or referenced from it.

## No secrets in committed files

- No API tokens, JWTs, OAuth secrets, Stripe keys, Sentry DSNs (the real ones), database URLs, or other credentials in any file under `.claude/`, `docs/`, source code, or test fixtures.
- Use environment variables and `.env.local` (gitignored) for runtime secrets.
- Use placeholder values in examples: `sk_test_REPLACE_ME`, `<TOKEN>`, `https://example.com/webhook`.

## No personal paths or machine-local references

- Don't hardcode `/home/<username>/...` or `/Users/<username>/...` paths in skills, rules, or commit messages. Use relative paths or environment variables.
- The one allowed exception: skills that document the **auto-memory directory** (`/home/<user>/.claude/projects/...`) — these necessarily reference the current machine path. Document them as variables (e.g. `MEMORY_DIR`) so users can substitute their own.

## No internal URLs in public-facing files

- Anything under `.claude/skills/` ships with the repo. Treat it as semi-public.
- Internal-only Slack channels, Linear/Jira board URLs, and team rosters can go in skills, but avoid pasting full webhook URLs, API tokens, or anything that grants access on its own.

## Pre-commit awareness

- Pre-commit hooks (`.husky`, lint-staged, etc.) run on every commit. Don't bypass with `--no-verify` unless explicitly authorized.
- If a hook flags a secret, the commit should fail — investigate, don't override.

## Why this matters

`.claude/` is checked into the repo and visible to everyone with read access — including past contributors whose access may not be revoked. A single committed token in a skill file becomes a long-lived credential leak.
