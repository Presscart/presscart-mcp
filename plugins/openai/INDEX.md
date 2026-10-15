# Presscart OpenAI plugin deliverables

Location: `plugins/openai/` in presscart-mcp. `dist/` and the generated `plugin/mcp.json` are gitignored; rebuild with `npm run package -- --mcp-url https://<host>/mcp/openai` from `plugins/openai/` (the packager refuses to overwrite an existing archive).

Current release: **0.2.0**, the first version that declares the remote MCP server (the read-only `/mcp/openai` directory endpoint, OAuth with dynamic client registration). Local development package; not uploaded, connected, scanned, or submitted. OpenAI does not support adding an MCP server to a plugin first submitted as skills-only, so 0.1.x must never be uploaded.

Verification: see [TEST-RESULTS.md](TEST-RESULTS.md). The eight reviewer cases need the signed-in test account and have not been run; offline behavioral results, including re-runs of the two 0.1.1 failures, are in:

- [run 1](results/eval-2026-10-16/EVAL-REPORT.md): 5/10;
- [run 2](results/eval-2026-10-16-r2/EVAL-REPORT.md): 8/10, after one description fix;
- [run 3](results/eval-2026-10-16-r3/EVAL-REPORT.md): 4/10, after Renz's 2026-10-16 decisions, graded strictly; its grading note explains;
- [run 4](results/eval-2026-10-16-r4/EVAL-REPORT.md): 4/10, after Renz's second decisions, graded strictly.

Those decisions dropped the price-repetition rule, kept the planning skills out, renamed the package `presscart`, and narrowed the triggers; they are recorded in [SUBMISSION.md](SUBMISSION.md#decisions-renz-2026-10-16). The [second decisions](SUBMISSION.md#decisions-renz-2026-10-16-second-round) widened the triggers with clauses tied to the user's own account, forbade checkout pointers, and added a connect-first instruction.

In run 4, triggering is right in all ten cases and no skill-loading reply points to a checkout. Every skill-loading case still fails because none asks the user to connect Presscart; the ChatGPT developer-mode run is the real test of that. `npm run check:release` fails by design until the approved logo, composer icon, and support/privacy/terms URLs exist.

| Output | Location |
| --- | --- |
| Installable package source: manifest, README, two skills with UI metadata | [plugin/](plugin/) |
| Portable manifest | [plugin/plugin.json](plugin/plugin.json) |
| MCP server configuration template; the build fills in the URL | [mcp.template.json](mcp.template.json) |
| Usage, tools, boundaries, data handling | [plugin/README.md](plugin/README.md) |
| Order status skill and UI | [plugin/skills/check-order-status/](plugin/skills/check-order-status/) |
| Campaign progress and published links skill and UI | [plugin/skills/report-campaign-progress/](plugin/skills/report-campaign-progress/) |
| Listing and MCP connection fields, annotations, 5 positive/3 negative reviewer cases, release notes, release blockers | [SUBMISSION.md](SUBMISSION.md) |
| Verification summary across releases | [TEST-RESULTS.md](TEST-RESULTS.md) |
| 0.2.0 offline evaluations, manual grades, raw evidence | [results/eval-2026-10-16/](results/eval-2026-10-16/EVAL-REPORT.md), [results/eval-2026-10-16-r2/](results/eval-2026-10-16-r2/EVAL-REPORT.md), [results/eval-2026-10-16-r3/](results/eval-2026-10-16-r3/EVAL-REPORT.md), [results/eval-2026-10-16-r4/](results/eval-2026-10-16-r4/EVAL-REPORT.md) |
| Historical 0.1.1 post-fix evaluation (11/13) and 0.1.0 evaluation (12/13) | [results/fix-2026-09-30/](results/fix-2026-09-30/EVAL-REPORT.md), [results/eval-2026-09-30/](results/eval-2026-09-30/EVAL-REPORT.md) |
| Independent review of 0.1.0, preserved verbatim | [reviews/independent-review-2026-09-30.md](reviews/independent-review-2026-09-30.md) |
| Offline eval cases (no connection needed) | [eval/offline-cases.json](eval/offline-cases.json) |
| Eval runner and evidence-integrity/trace inventory audit | [scripts/run-eval.mjs](scripts/run-eval.mjs), [scripts/audit-eval.mjs](scripts/audit-eval.mjs) |
| Dependency-free Node suite | [tests/](tests/) |
| Release gate (currently fails); npm commands | [scripts/check-release.mjs](scripts/check-release.mjs), [package.json](package.json) |
| Build entry point and standard-library ZIP builder | [scripts/package.sh](scripts/package.sh), [scripts/package.py](scripts/package.py) |
| Exact command capture; never reads auth files | [scripts/record-command.mjs](scripts/record-command.mjs) |
| Read-only config hash comparison and cleanup check | [scripts/config-fingerprint.mjs](scripts/config-fingerprint.mjs), [scripts/verify-cleanup.mjs](scripts/verify-cleanup.mjs) |
| ZIP and installed-cache byte comparison | [scripts/verify-artifacts.py](scripts/verify-artifacts.py) |
| Local test marketplace and procedure | [test-marketplace/](test-marketplace/README.md) |

## How the MCP URL gets into the package

`plugin/` names no host. `scripts/package.py` takes `--mcp-url`, accepts only `https://<public-dns-host>/mcp/openai` (no port, credentials, query, fragment, IP literal, or other path), renders `mcp.template.json` into the ZIP's `mcp.json`, and writes `dist/<host>/presscart-<version>.zip` with a `.build.json` record of the URL and SHA256. `--write-local-config` also writes the gitignored `plugin/mcp.json` so a local marketplace install (via the `test-marketplace` symlink to `plugin/`) matches the ZIP. The release upload must be built with the production URL; staging builds are for local and developer-mode testing only.

## Tools the package describes

Exactly the ten tools in `src/directory/policy.ts` (`STAGE_A_TOOLS`): `get_user`, `list_teams`, `get_team`, `list_profiles`, `list_profile_orders`, `get_order`, `list_campaigns`, `get_campaign`, `list_campaign_articles`, `get_campaign_article_status`. The test suite reads that file and the legacy tool registrations, and fails if a skill or the README mentions any other tool or misses one of these. If the `/mcp/openai` allowlist changes, update the skills, README, reviewer cases, and SUBMISSION.md together.

## Checks

- `node --test tests/` (or `npm test` here): package contents, manifest and listing limits, MCP template, build and URL validation, release gate behavior, skill rules, reviewer case format, and tool coverage against the server source.
- `npm run check:release`: fails until the approved logo, composer icon, and support/privacy/terms URLs are added; see [SUBMISSION.md](SUBMISSION.md#adding-the-assets-and-urls).
- `python3 scripts/verify-artifacts.py --mcp-url <url> [--skip-installed]`: ZIP (and installed cache) against `plugin/` plus the generated `plugin/mcp.json`.
- Offline eval: [test-marketplace/README.md](test-marketplace/README.md). Reviewer cases: [SUBMISSION.md](SUBMISSION.md#reviewer-test-cases).

The 0.1.x planning skills, the source-port script and fixtures, and the retired smoke runner were removed in 0.2.0; git history and the historical result reports keep them. Historical results keep their original version labels and are not overwritten.
