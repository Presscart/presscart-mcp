# Presscart OpenAI plugin deliverables

Location: this package now lives at `plugins/openai/` in presscart-mcp. `dist/` is gitignored and rebuilt with `npm run package`.

> Raw evidence (prompts, stdout/stderr, traces, snapshots) was not imported into this repository; it remains in the original Abba workspace export at commit aef10eb.

Current release: **0.1.1**. Local development package; not uploaded or submitted. The user-facing README is limited to usage, boundaries, and data/publisher information. Development, marketplace, and release status belong here and in the [local marketplace guide](test-marketplace/README.md).

Verification: **17/17 static tests pass; isolated eval 11/13 passes**. Negative 3 still repeats a supplied publication price; Positive 5 omits the search-ranking caveat. Triggers: 3/3 correct; controls: 2/2 clean. Root-only installation and ZIP/cache byte comparisons pass. Release-asset check intentionally fails for missing approved logo/icon. Plugin/marketplace removed; config and lists restored exactly, with no host-discovery override left.

| Output | Location |
| --- | --- |
| Installable package; six files before approved assets are supplied | [plugin/](plugin/) |
| Portable manifest | [plugin/plugin.json](plugin/plugin.json) |
| Usage and boundaries | [plugin/README.md](plugin/README.md) |
| Press qualification skill and UI | [plugin/skills/qualify-press-needs/](plugin/skills/qualify-press-needs/) |
| Publication evaluation skill and UI | [plugin/skills/evaluate-publication-fit/](plugin/skills/evaluate-publication-fit/) |
| Paste-ready portal fields, counts, 5 positive/3 negative cases, release blockers | [SUBMISSION.md](SUBMISSION.md) |
| Executed verification, failures, smoke review, cleanup evidence | [TEST-RESULTS.md](TEST-RESULTS.md) |
| Independent review preserved verbatim | [reviews/independent-review-2026-09-30.md](reviews/independent-review-2026-09-30.md) |
| Post-fix 13-case evaluation, manual grades, remaining failures | [EVAL-REPORT.md](results/fix-2026-09-30/EVAL-REPORT.md) |
| Historical 0.1.0 behavioral evaluation: 12/13 passes, original failure evidence | [EVAL-REPORT.md](results/eval-2026-09-30/EVAL-REPORT.md) |
| Verbatim behavioral runner and evidence-integrity/trace inventory audit | [scripts/run-eval.mjs](scripts/run-eval.mjs), [scripts/audit-eval.mjs](scripts/audit-eval.mjs) |
| Dependency-free Node suite and pinned source safety fixtures | [tests/](tests/) |
| Required asset release gate (currently fails); npm commands | [scripts/check-release.mjs](scripts/check-release.mjs), [package.json](package.json) |
| Exact documented source replacements used by test 11 and port script | [tests/fixtures/source-replacements.json](tests/fixtures/source-replacements.json) |
| Build entry point and standard-library ZIP implementation | [scripts/package.sh](scripts/package.sh), [scripts/package.py](scripts/package.py) |
| Narrow, reproducible source-skill port | [scripts/port-source.mjs](scripts/port-source.mjs) |
| Exact command capture; never reads auth files | [scripts/record-command.mjs](scripts/record-command.mjs) |
| Read-only config hash comparison | [scripts/config-fingerprint.mjs](scripts/config-fingerprint.mjs) |
| Fresh, isolated read-only CLI smoke runner | [scripts/run-smoke.mjs](scripts/run-smoke.mjs) |
| ZIP/cache and cleanup evidence checks | [scripts/verify-artifacts.py](scripts/verify-artifacts.py), [scripts/verify-cleanup.mjs](scripts/verify-cleanup.mjs) |
| Historical smoke-report generator; do not overwrite current verification | [scripts/write-test-report.mjs](scripts/write-test-report.mjs) |
| Test marketplace descriptor | [test-marketplace/.agents/plugins/marketplace.json](test-marketplace/.agents/plugins/marketplace.json) |
| Marketplace usage and cleanup instructions | [test-marketplace/README.md](test-marketplace/README.md) |

The marketplace source `test-marketplace/plugins/presscart-placement-advisor` is a symlink to `plugin/`. It is outside the ZIP. The root manifest contains portable identity and `extensions.com.openai` presentation. The redundant compatibility overlay was removed: actual `codex-cli 0.159.2` installation succeeded using the root manifest alone. This agrees with the [official packaging guidance](https://developers.openai.com/plugins/build/plugins).

Development checks: `node --test tests/`, `./scripts/package.sh`, ZIP content/byte verification, and the isolated eval procedure in the marketplace guide. `npm run check:release` is a separate release asset gate: it must fail until the approved production logo and composer icon exist and are referenced in the manifest. Drop them at `plugin/assets/logo.png` and `plugin/assets/icon.png`; exact requirements and manifest additions are in [SUBMISSION.md](SUBMISSION.md#resolving-the-two-asset-blockers).

No invented or placeholder brand assets are supplied. Both behavioral failures, both images, verified identity, Apps Management access, approved privacy/terms/support URLs, license approval, portal safety scans, and submission work remain release blockers. Source material outside this repository is read-only. Historical results and the original ZIP retain their original version labels; no earlier evidence is overwritten.
