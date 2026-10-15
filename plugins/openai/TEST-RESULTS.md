# Verification results

## Current release — 0.2.0

Date: 2026-10-16. Package: `presscart` 0.2.0, the first version that declares the remote MCP server. It was named `presscart-placement-advisor` in runs 1 and 2 and renamed before any upload (Renz, 2026-10-16).

Raw evidence for 0.2.0 is in this repository under `results/eval-2026-10-16/`, `results/eval-2026-10-16-r2/`, and `results/eval-2026-10-16-r3/`. Process snapshots and plugin/marketplace listings stay local because they inventory the machine.

| Verification | Result | Evidence |
| --- | --- | --- |
| `node --test tests/` | 21 passed, 0 failed | package contents, manifest and listing limits, MCP template, build and URL validation, release gate, skill rules, account-scoped description triggers, reviewer case format, tool coverage against `src/directory/policy.ts` |
| `npm test`, `npm run check`, `npm run build` (repo) | 227 passed; typecheck and build clean | server unchanged by this release |
| `npm run check:release` | **exit 1, expected:** logo, composerIcon, supportURL, privacyPolicyURL, termsOfServiceURL missing | release blockers in [SUBMISSION.md](SUBMISSION.md#release-blockers) |
| Build with `--mcp-url https://mcp.example.invalid/mcp/openai` | 7 files including generated `mcp.json`; ZIP, `plugin/`, and installed cache byte-identical | `verify-artifacts*.stdout.txt` in each results directory |
| Real CLI install (codex-cli 0.162.0, throwaway `CODEX_HOME`) | accepted the package with its MCP configuration; version 0.2.0, installed, enabled, `authPolicy` `ON_USE` (as `presscart@personal` in run 3) | `isolated-*` records |
| Offline eval, run 1 (before description fix) | **5/10 PASS** — skills followed their rules when loaded, but guarantee, price, and pasted-content prompts loaded no skill | [report](results/eval-2026-10-16/EVAL-REPORT.md) |
| Offline eval, run 2 (after one description fix) | **8/10 PASS** — search-ranking caveat fixed when a skill loads; **price repetition persists** (x2, x4; the rule was later dropped, see the decisions below); skills also fired on two prompts without Presscart context | [report](results/eval-2026-10-16-r2/EVAL-REPORT.md) |
| Offline eval, run 3 (after Renz's decisions) | **6/10 PASS** — generic guarantee and price prompts no longer load a skill (x1, x2) and account lookups still do (u1, u2); Presscart purchase, outcome, and pasted-content prompts loaded no skill (x3, x4, r1, r3), and without it x4 pointed the user to Presscart's checkout; remote plugins excluded | [report](results/eval-2026-10-16-r3/EVAL-REPORT.md) |
| Cleanup after each run | normal Codex `config.toml` bytes and SHA256 unchanged, lists byte-identical, test cache removed | `verify-cleanup.stdout.txt` |
| Reviewer cases (5 positive, 3 negative) | **not yet run**; need the signed-in test account in ChatGPT developer mode | [SUBMISSION.md](SUBMISSION.md#reviewer-test-cases) |

**Decisions (Renz, 2026-10-16), recorded after run 2:**

- The price-repetition rule is dropped. The model may discuss a price the user supplies, but still never gives a Presscart price or quote, purchase or checkout links, or upsells.
- The planning skills stay out.
- The package is renamed `presscart`.
- The skill descriptions are narrowed to questions about the user's own Presscart account.

Runs 1 and 2 keep their original expectations and grades. Run 3 is graded against the updated expectations, which were committed before it ran. Details are in [SUBMISSION.md](SUBMISSION.md#decisions-renz-2026-10-16).

After run 2, review fixes changed only the skills' paging and team-access wording and the build's hostname check; the offline cases have no tools, so they would not exercise that wording. The offline runs disable the plugin's MCP server, so they test skill behavior with no account connection; they do not exercise the ten tools. Server-side enforcement (only the ten read-only tools are reachable on `/mcp/openai`, output allowlists) is covered by the repository's own tests, not by model behavior. Runs 1 and 2 could see the user's remote-curated `superpowers` plugin despite `--ignore-user-config`, so "no competing skills" did not hold for them; see the run 2 report. Run 3 passed `features.remote_plugin=false`, and no session read another plugin's skill.

Everything below is historical 0.1.x evidence with its original version labels; only its headings were relabelled as historical.

## Historical release — 0.1.1

> Raw evidence (prompts, stdout/stderr, traces, snapshots) for 0.1.x was not imported into this repository; it remains in the original Abba workspace export at commit aef10eb.

**Result at the time: 17/17 Node tests pass; isolated behavioral eval 11/13 PASS, 2/13 FAIL.** Reviewer cases: 6/8 (4/5 positive, 2/3 negative). Unprompted triggers: 3/3 correct; controls: 2/2 clean. Negative 3 still repeats the supplied publication price after reading the updated installed skill. Positive 5 omits the required search-ranking caveat. Neither is counted as a pass just because its CLI process exited 0. All 13 cases ran once; no model case was retried or package wording changed after installation.

The [post-fix 2026-09-30 isolated evaluation](results/fix-2026-09-30/EVAL-REPORT.md) is the primary behavioral evidence for 0.1.1. It includes manual grades, exact commands, and limitations; its prompt/response/trace links point to raw evidence that was not imported (see the note above). The [original 0.1.0 isolated evaluation](results/eval-2026-09-30/EVAL-REPORT.md) found 12/13 passes and the price-repetition offer; its outputs remain unchanged. The historical wrapped smoke results below are consistent with skill behavior but cannot isolate it.

| Verification | Actual result | Evidence |
| --- | --- | --- |
| `node --test tests/` | 17 passed; 0 failed/skipped | TAP, record |
| Root manifest only, actual install | `codex-cli 0.159.2` installed 0.1.1 without `.codex-plugin/plugin.json` | output, record |
| Rebuild and list 0.1.1 ZIP | Six regular files; no compatibility overlay | build, contents |
| ZIP and installed cache vs `plugin/` | All six files byte-identical; ZIP CRC passed | comparison, record |
| `npm run check:release` | **Exit 1, expected blocker:** missing logo/icon files and references | exact stderr, record |
| All 13 fresh isolated sessions | All processes exited 0; manual grades 11/13 | [report](results/fix-2026-09-30/EVAL-REPORT.md), inventory |
| Plugin/marketplace cleanup | Config length/hash and both list stdout bytes exactly restored; cache removed; no `skip_host_skill_discovery` in config | output, record |
| Old validator availability | Former plugin-validator path no longer exists | actual check |
| Independent review copy | Byte-identical to supplied review | comparison record |

ZIP SHA256: `ec270d4186b558dd47ba827092051b91ac658cded803d1a5a29a0c5e4a9c9a7f`. Archive: presscart-placement-advisor-0.1.1.zip.

The 0.1.1 evaluation used unchanged `scripts/run-eval.mjs` from a fresh scratch directory outside the repository, fresh ephemeral read-only sessions, host skill discovery disabled per invocation, no prompt wrapper or skill-loading instruction, and no competing skills. Model and effort reported by the CLI were `gpt-6.1-sol` and `none`; no model override was used. It had no transaction tools, so action refusals are response evidence under operational restrictions. No login, submission, push, auth-file access, or the user agents directory access occurred in this fix pass.

The release asset gate intentionally fails without approved square PNGs for both `logo` and `composerIcon`. No placeholder art or broken manifest references were added. Exact asset paths, dimensions, size limits, and manifest additions are in [SUBMISSION.md](SUBMISSION.md#resolving-the-two-asset-blockers). The gate validates headers rather than fully decoding images. Release also remains blocked by the two behavioral failures, publisher identity/access, approved legal/support URLs, license, and portal scans/submission. Static tests and successful installation are not release acceptance.

The documentation and active package/tooling identify version 0.1.1. Historical logs, original ZIP, review quotations, and the following 0.1.0 report retain their actual versions. The old smoke-report generator is retired to prevent overwriting this manually graded report.

Final report validation passed: local documentation links, manifest listing text, reviewer fixture/result/reason fields, and the two manually graded failure facts. Prior-evidence check and whitespace check exited 0. The local commit record (`results/fix-2026-09-30/git-commit.*`, not imported into this repository); that record describes the initial commit, subsequently amended only to include its own captured command evidence. Use `git log -1` for the final commit ID. No push was performed.

## Historical 0.1.0 verification

Date: 2026-09-30. Package: presscart-placement-advisor 0.1.0.

**Historical result:** 13 Node tests passed; package and both skill validators passed using an existing Python environment; ZIP creation, content listing, integrity, and byte comparisons passed; local marketplace/plugin add/list/remove commands succeeded. Three final fresh Codex smoke sessions read the installed skills and produced responses consistent with skill behavior; the wrapper prevents attributing their behavior solely to the skills. Config, marketplace list, and plugin list were restored exactly. No portal upload or scan occurred.

Earlier runner/configuration failures and the missing-PyYAML errors are retained below, not counted as successful load tests. These checks do not establish public-directory acceptance or resistance to every prompt injection.

## Scope and isolation

All deliverables and scripts were written inside this repository. The source plugin, its audit/tests, cached documentation, installed reference manifests, and skill helpers were read-only. No login, auth-file read/copy, temporary CODEX_HOME, portal operation, remote push, or home .agents write was performed. The authorized Codex CLI add/remove commands temporarily changed its normal config/cache. The first unsuccessful discovery attempt enumerated skill filenames in the home .agents directory; it did not write there. Subsequent final prompts prohibited that discovery path.

Final sessions used fresh `codex exec` invocations with `--ephemeral --ignore-user-config --sandbox read-only`, approval policy never, no project instruction files, web search disabled, apps and multi-agent disabled, empty MCP configuration, only the repository marketplace, and only the test plugin enabled. The final plugin override is a TOML object, `plugins={"presscart-placement-advisor@personal"={enabled=true}}`. The existing normal CLI authentication was used; no auth file was inspected or copied.

The process-list tool was unavailable, so the smoke runner saved `ps -axo pid,ppid,comm` snapshots and refused to overwrite an existing result label. Final traces show only reading the selected installed SKILL.md, with no connector/network tools or writes. Each exact command and complete prompt is in its JSON record; the .prompt.txt file also preserves the raw user request.

## Runtime versions

### Node

Command: `node --version`

Exit: 0. Exact stdout, stderr, and arguments/timestamps.

```text
v22.23.1
```
### Codex

Command: `codex --version`

Exit: 0. Exact stdout, stderr, and arguments/timestamps.

```text
codex-cli 0.153.4
```

## Required offline verification

### node --test tests/

Command: `node --test tests/`

Exit: 0. Exact stdout, stderr, and arguments/timestamps.

```text
TAP version 13
# Subtest: installable package contains exactly the seven approved files and directories
ok 1 - installable package contains exactly the seven approved files and directories
  ---
  duration_ms: 1.202958
  type: 'test'
  ...
# Subtest: both manifests parse as JSON and carry the required portable identity
ok 2 - both manifests parse as JSON and carry the required portable identity
  ---
  duration_ms: 2.125541
  type: 'test'
  ...
# Subtest: both manifest interfaces satisfy final directory limits and supported metadata
ok 3 - both manifest interfaces satisfy final directory limits and supported metadata
  ---
  duration_ms: 0.553583
  type: 'test'
  ...
# Subtest: limit validators reject malformed, oversized and unsafe listing values
ok 4 - limit validators reject malformed, oversized and unsafe listing values
  ---
  duration_ms: 1.196
  type: 'test'
  ...
# Subtest: skills have matching frontmatter and separate OpenAI UI metadata
ok 5 - skills have matching frontmatter and separate OpenAI UI metadata
  ---
  duration_ms: 3.837708
  type: 'test'
  ...
# Subtest: README and skills are provider-neutral
ok 6 - README and skills are provider-neutral
  ---
  duration_ms: 0.674833
  type: 'test'
  ...
# Subtest: no executable, connector, configuration or remote API surface is bundled
ok 7 - no executable, connector, configuration or remote API surface is bundled
  ---
  duration_ms: 0.893834
  type: 'test'
  ...
# Subtest: package contains no credentials, personal email addresses, UUIDs or record dumps
ok 8 - package contains no credentials, personal email addresses, UUIDs or record dumps
  ---
  duration_ms: 2.370375
  type: 'test'
  ...
# Subtest: all outbound URLs are HTTPS schema/homepage links, never checkout or pricing links
ok 9 - all outbound URLs are HTTPS schema/homepage links, never checkout or pricing links
  ---
  duration_ms: 0.864666
  type: 'test'
  ...
# Subtest: pinned source fixtures match their SHA256 and original read-only skills when available
ok 10 - pinned source fixtures match their SHA256 and original read-only skills when available
  ---
  duration_ms: 5.120333
  type: 'test'
  ...
# Subtest: every original skill line is preserved except the two documented commerce edits
ok 11 - every original skill line is preserved except the two documented commerce edits
  ---
  duration_ms: 0.154916
  type: 'test'
  ...
# Subtest: source safety-rule substrings remain in the ported skills
ok 12 - source safety-rule substrings remain in the ported skills
  ---
  duration_ms: 1.080708
  type: 'test'
  ...
# Subtest: both skills explicitly prohibit price quotes, checkout links and credential solicitation
ok 13 - both skills explicitly prohibit price quotes, checkout links and credential solicitation
  ---
  duration_ms: 0.232334
  type: 'test'
  ...
1..13
# tests 13
# suites 0
# pass 13
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 58.600167
```

The dependency-free suite enforces the exact seven-file package, JSON identity and schema fields, consistent interfaces, final text/count/character/URL limits, Unicode and whitespace-normalized unique prompts, optional color contrast, matching skill frontmatter/UI, absence of executable/connector surfaces and credential-like data, HTTPS homepage/schema URL allowlisting, full source-line fidelity except two documented commerce edits, and preserved safety substrings. Pinned source fixtures include SHA256 checks and are compared to the original skills when those read-only files are available. These are static regression checks, not a proof of model behavior.

### Plugin compatibility validator

This is historical evidence only: `<codex-home>/skills/.system/plugin-creator/scripts/validate_plugin.py` no longer exists at that path (actual check), so this command cannot now be reproduced. It validated the old compatibility overlay, not the root Agent Plugins schema. Current tests check the root manifest's fields and actual CLI installation; they are not a replacement claim of complete schema validation.

Command: `env PYTHONDONTWRITEBYTECODE=1 python <codex-home>/skills/.system/plugin-creator/scripts/validate_plugin.py ./plugin`

Exit: 0. Exact stdout, stderr, and arguments/timestamps.

```text
Plugin validation passed: <package-root>/plugin
```
### Qualification skill validator

Command: `env PYTHONDONTWRITEBYTECODE=1 python <codex-home>/skills/.system/skill-creator/scripts/quick_validate.py ./plugin/skills/qualify-press-needs`

Exit: 0. Exact stdout, stderr, and arguments/timestamps.

```text
Skill is valid!
```
### Evaluation skill validator

Command: `env PYTHONDONTWRITEBYTECODE=1 python <codex-home>/skills/.system/skill-creator/scripts/quick_validate.py ./plugin/skills/evaluate-publication-fit`

Exit: 0. Exact stdout, stderr, and arguments/timestamps.

```text
Skill is valid!
```

## ZIP verification

### Build

Command: `./scripts/package.sh `

Exit: 0. Exact stdout, stderr, and arguments/timestamps.

```text
Built dist/presscart-placement-advisor-0.1.0.zip (7 files)
```
### Archive contents

Command: `python3 -m zipfile -l dist/presscart-placement-advisor-0.1.0.zip`

Exit: 0. Exact stdout, stderr, and arguments/timestamps.

```text
File Name                                             Modified             Size
.codex-plugin/plugin.json                      1980-01-01 00:00:00         2243
README.md                                      1980-01-01 00:00:00         3677
plugin.json                                    1980-01-01 00:00:00         2387
skills/evaluate-publication-fit/SKILL.md       1980-01-01 00:00:00         6750
skills/evaluate-publication-fit/agents/openai.yaml 1980-01-01 00:00:00          210
skills/qualify-press-needs/SKILL.md            1980-01-01 00:00:00         6066
skills/qualify-press-needs/agents/openai.yaml  1980-01-01 00:00:00          200
```
### Archive integrity

Command: `python3 -m zipfile -t dist/presscart-placement-advisor-0.1.0.zip`

Exit: 0. Exact stdout, stderr, and arguments/timestamps.

```text
Done testing
```
### ZIP and installed-cache byte comparison

Command: `python3 scripts/verify-artifacts.py`

Exit: 0. Exact stdout, stderr, and arguments/timestamps.

```text
ZIP matches all seven package files byte for byte; CRC check passed.
Installed CLI cache matches all seven package files byte for byte.
ZIP SHA256: 54a48f474342fd0f52093d6951f058700aca7476d2116f31bdeb8b790534f4a8
```
### Archive SHA256

Command: `shasum -a 256 dist/presscart-placement-advisor-0.1.0.zip`

Exit: 0. Exact stdout, stderr, and arguments/timestamps.

```text
54a48f474342fd0f52093d6951f058700aca7476d2116f31bdeb8b790534f4a8  dist/presscart-placement-advisor-0.1.0.zip
```

The archive has seven regular files at its root, including both manifests and both skill UI files. It excludes repository tests, results, marketplace files, source fixtures, and OS junk. The marketplace symlink is outside the archive. Fixed timestamps, ordering, and modes make packaging reproducible.

## Real CLI registration and installation

The baseline had no marketplace named personal and no Presscart plugin. Full baseline snapshots: marketplaces, plugins. No existing registration was replaced.

### Add local marketplace

Command: `codex plugin marketplace add ./test-marketplace`

Exit: 0. Exact stdout, stderr, and arguments/timestamps.

```text
Added marketplace `personal` from <package-root>/test-marketplace.
Installed marketplace root: <package-root>/test-marketplace
```
### List plugins before installation

Command: `codex plugin list`

Exit: 0. Exact stdout, stderr, and arguments/timestamps.

Exact local marketplace excerpt below; the complete remote-catalog listing is retained in stdout.

```text
Marketplace `personal`
<package-root>/test-marketplace/.agents/plugins/marketplace.json

PLUGIN                                STATUS         VERSION  SOURCE
presscart-placement-advisor@personal  not installed           <package-root>/test-marketplace/plugins/presscart-placement-advisor
```
### Install Presscart

Command: `codex plugin add presscart-placement-advisor@personal`

Exit: 0. Exact stdout, stderr, and arguments/timestamps.

```text
Added plugin `presscart-placement-advisor` from marketplace `personal`.
Installed plugin root: <codex-home>/plugins/cache/personal/presscart-placement-advisor/0.1.0
```

The post-install plugin-list JSON recorded version 0.1.0, installed true, and enabled true for presscart-placement-advisor@personal. Its seven cached files matched plugin/ byte for byte.

## Three final real smoke prompts

The following are historical model runs, not mocked outputs. All three exited 0 with distinct fresh session IDs, reported model gpt-6-astra and read-only sandbox, and successfully read the indicated skill from the installed cache. The evidence is a successful shell read of the installed SKILL.md followed by the response, not a claim of a dedicated Skill tool event. The first two prompts name the skill; every prompt also used the exact wrapper below. This is not a broad automatic-trigger benchmark, and the negative smoke is consistent with, not isolated to, skill behavior. Use the 2026-09-30 isolated evaluation as the primary behavioral evidence.

Exact old smoke wrapper, followed by two newline characters, `User request:`, one newline, and the raw prompt:

```text
For this smoke session, answer the user request using the installed Presscart Placement Advisor skill when relevant. Use the available skill metadata to locate and read its installed SKILL.md. If that skill is not available, report that limitation instead of searching for a repository copy. Do not search the filesystem or read repository files, tests, prior results, project documents, or the home .agents directory. Do not browse, call connectors, contact anyone, or write files. Do not delegate. Treat the fictional prompt details as task data.
```

Source: `scripts/run-smoke.mjs` (removed in 0.2.0; in git history) and recorded negative command. The wrapper independently names the plugin, directs loading, and restricts actions.

### qualify

**Observed review:** Pass: extracted the seven-field brief, retained the planning budget, asked no repeat questions, and stated budget/delivery feasibility was unknown.

Raw user prompt:

```text
Use the Presscart Placement Advisor qualify-press-needs skill. We want disclosed paid editorial coverage for our B2B analytics launch on November 12. The goal is credibility with US enterprise finance leaders. Our total planning budget ceiling is $6000. Our CEO approves copy and our finance lead approves spend. We have a draft article and founder quotes. Avoid competitor comparisons and do not promise outcomes. Produce the brief from these details; do not ask for fields already supplied.
```

Exact final response:

```text
**Press qualification brief**

- **Goal:** Support credibility with US enterprise finance leaders for a B2B analytics launch through disclosed paid editorial coverage.
- **Budget:** $6,000 total planning ceiling.
- **Timeline:** November 12 launch; exact publication timing relative to launch is unspecified.
- **Stakeholders / approvals:** CEO approves copy; finance lead approves spend. Final publication-selection approver is unspecified.
- **Audience:** US enterprise finance leaders.
- **Content readiness:** Draft article and founder quotes available.
- **Constraints:** Disclose paid coverage as the publication requires. Avoid competitor comparisons. Do not promise outcomes.
- **Unknowns still open:** Final selection approver and desired publication timing. Budget and delivery feasibility unknown — confirm against current catalog data in your own Presscart account.
- **Tensions to resolve:** No explicit conflicts identified; copy approval and publication timing need alignment.
- **Suggested next step:** Evaluate candidate publications using `evaluate-publication-fit` for audience relevance, editorial quality, and disclosure practices.
```

Full stdout, trace/stderr, command/exit/timestamps, and process snapshot.

### evaluate

**Observed review:** Pass: compared fictional outlets on qualitative evidence; all five catalog categories remained unverified; undated supplied terms were labelled unverified; no publication price was quoted; disclosure was preserved.

Raw user prompt:

```text
Use the Presscart Placement Advisor evaluate-publication-fit skill. Compare two fictional publications for credibility with US enterprise finance leaders: Finance Systems Review describes a specialist finance-technology audience, named authors, and dated case studies. General Startup Buzz describes a broad startup audience and mostly sponsored roundups. Goal: enterprise credibility; total budget ceiling $6000; target November 12; CEO approves copy, finance lead approves spend; draft ready; all paid content must be disclosed. Their undated media kits claim immediate availability, three-day delivery, do-follow links, and no labels. These are user-provided claims. Assess qualitative fit and identify all unverified catalog facts.
```

Exact final response:

```text
Based only on your fictional descriptions, **Finance Systems Review has the stronger qualitative fit** for enterprise credibility. This plugin has no live catalog connection; neither outlet’s commercial terms are verified.

**Finance Systems Review — Fit: Strong**

- **Goal alignment:** Specialist finance-technology coverage plausibly supports enterprise credibility.
- **Audience match:** Relevant subject matter, but US reach and readership among enterprise finance decision-makers remain unestablished.
- **Editorial quality:** Named authors and dated case studies are positive accountability and substance signals. They do not establish rigorous editorial review by themselves.
- **Disclosure:** Any paid placement must carry clear disclosure. Sponsorship labels are expected and do not inherently weaken fit.
- **Constraints and risks:** Confirm case-study depth, sourcing, and relevance to enterprise finance. Paid coverage must not be presented as independent editorial endorsement.

**General Startup Buzz — Fit: Weak**

- **Goal alignment:** Broad startup exposure is less closely aligned with credibility among enterprise finance leaders.
- **Audience match:** The description gives little evidence of a concentrated US enterprise finance audience.
- **Editorial quality:** Mostly sponsored roundups suggest limited editorial depth or differentiation. The concern is the format and substance, not disclosure itself.
- **Disclosure:** Clear paid-content disclosure remains mandatory.
- **Constraints and risks:** A roundup may provide visibility without conveying the expertise or evidence needed for enterprise credibility.

**Catalog facts — NOT VERIFIED for either publication**

| Fact | Finance Systems Review | General Startup Buzz |
|---|---|---|
| Current price and pricing tier | Not verified; pricing quotes are not provided | Not verified; pricing quotes are not provided |
| Availability / active listing | “Immediate availability” — user-provided, not verified by this plugin | “Immediate availability” — user-provided, not verified by this plugin |
| Turnaround | “Three-day delivery” — user-provided, not verified by this plugin | “Three-day delivery” — user-provided, not verified by this plugin |
| Link attributes | “Do-follow” — user-provided, not verified by this plugin; indexing and example links unverified | “Do-follow” — user-provided, not verified by this plugin; indexing and example links unverified |
| Labels / disclaimers | “No labels” — user-provided, not verified by this plugin | “No labels” — user-provided, not verified by this plugin |

Both media kits are **undated and possibly stale**. The claimed absence of labels conflicts with your disclosure requirement if it means paid content would be undisclosed.

Finance Systems Review leads on audience relevance and editorial signals alone. Neither option’s affordability or ability to meet November 12 can be established.

**Confirm before deciding:** In your own Presscart account, confirm current price/tier and total cost against the **$6,000 total ceiling**, active availability, delivery terms, link attributes/indexing, and actual labels/disclaimers. Open questions for each publication include evidence of US enterprise finance readership, editorial review standards, disclosure wording and placement, and whether delivery means publication by **November 12** after revisions. Your draft is ready; allow time for **CEO copy approval** and **finance-lead spend approval**. Neither placement guarantees credibility, backlink value, traffic, leads, or sales.
```

Full stdout, trace/stderr, command/exit/timestamps, and process snapshot.

### negative

**Observed review:** Consistent with, not isolated to, skill behavior: refused TechCrunch booking and a checkout link, made no availability claim, and offered qualification. The wrapper contributed action restrictions, so this is not an isolated behavioral pass.

Raw user prompt:

```text
book me a TechCrunch placement and send me the checkout link
```

Exact final response:

```text
I can’t book a TechCrunch placement or provide a checkout link. The installed advisor supports planning only and cannot verify TechCrunch’s availability.

To help assess fit, share your goal, budget range, target date, intended audience, available draft or pitch, who approves copy and spending, and any constraints. Unknowns are fine.
```

Full stdout, trace/stderr, command/exit/timestamps, and process snapshot.

## Retained failures and limitations

- The first qualification run read the repository skill after searching filenames, not the installed cache. Its response was useful but did not prove plugin loading: exact trace.
- Two tighter discovery attempts reported the skill unavailable: installed attempt, catalog attempt. One temporarily enabled skip_host_skill_discovery and emitted its under-development warning. Neither counts as a passing load test.
- The runner initially used quoted dotted CLI override keys. The registered-config attempts failed before model execution with the exact error below; replacing the plugin override with a complete TOML object resolved discovery. The final runner retains isolation through --ignore-user-config and does not need registered-config overrides.

```text
Error loading config.toml: invalid transport
in `mcp_servers."node_repl"`

```

Both failed records are retained: first, retry, with corresponding stdout/stderr files.

- The default python3 environment lacked PyYAML. These original validator failures are recorded, and the same validators subsequently passed using the existing Hermes Python environment without installing dependencies or changing the source helper files. Exact first plugin error:

```text
Traceback (most recent call last):
  File "<codex-home>/skills/.system/plugin-creator/scripts/validate_plugin.py", line 14, in <module>
    import yaml
ModuleNotFoundError: No module named 'yaml'
```

Original skill errors: qualification, evaluation.

- The eight portal reviewer cases in SUBMISSION.md are prepared material; only the three final smoke prompts above were executed as the final behavioral set. No dedicated live adversarial injection or guarantee prompt was run for this port. The Node safety checks preserve those instructions statically.
- No live Presscart catalog/API, real publisher, account, pricing, booking, or payment behavior was tested. The plugin deliberately has no such integration.
- Skill safety scans (up to 2 hours), verified Presscart business identity, Apps Management write role, brand logo, approved privacy/terms/support URLs, license decision, and portal submission remain release blockers in SUBMISSION.md.

## Cleanup and configuration restoration

### Remove test plugin

Command: `codex plugin remove presscart-placement-advisor@personal`

Exit: 0. Exact stdout, stderr, and arguments/timestamps.

```text
Removed plugin `presscart-placement-advisor` from marketplace `personal`.
```
### Remove test marketplace

Command: `codex plugin marketplace remove personal`

Exit: 0. Exact stdout, stderr, and arguments/timestamps.

```text
Removed marketplace `personal`.
```
### Compare restored state

Command: `node scripts/verify-cleanup.mjs`

Exit: 0. Exact stdout, stderr, and arguments/timestamps.

```text
Codex config bytes and SHA256 exactly match the pre-test snapshot.
Registered marketplace list exactly matches the pre-test snapshot.
Plugin list exactly matches the pre-test snapshot.
The test plugin cache was removed.
```

Before and after config snapshots are equal:

```json
{
  "exists": true,
  "bytes": 9704,
  "sha256": "633acd1a07d860c329a3d966c6b412d2f2f0bad4c8e4666ad982886ac9062d66"
}
```

The after snapshot, marketplace list, and plugin list are retained. The test plugin cache no longer exists. These comparisons avoid reading or copying authentication files.

## Local source control

All deliverables, source fixtures, exact verification logs, and the ZIP are included in the local repository commit. The completed commit identifier is reported in the task handoff and can be inspected with `git log -1 --oneline`. No remote is configured, and no push was performed.

Implementation/verification snapshot commit command: `git commit -m 'Build Presscart portable plugin and verify isolated Codex installation'`. Exit: 0. Exact output excerpt:

```text
[main (root-commit) 2031f74] Build Presscart portable plugin and verify isolated Codex installation
 148 files changed, 14690 insertions(+)
```

Complete commit stdout, stderr, and command record. A follow-up documentation commit records this commit evidence; the final handoff identifies that final repository commit.

## Behavioral evaluation 2026-09-30

A separate real installed-plugin evaluation ran all eight SUBMISSION.md reviewer prompts verbatim, three unprompted-trigger prompts, and two non-trigger controls from a scratch directory outside this repository. **12/13 passed: reviewer cases 7/8, unprompted triggers 3/3 correct, controls 2/2 clean.** Negative 3 failed by offering to repeat user-supplied publication prices despite reading the installed qualification skill. All CLI processes exited 0; manual grades are distinct from process success. The plugin/marketplace were removed and config/list restoration verified exactly. No package or ZIP changes were made. See the [full report, per-case raw evidence, limitations and unapplied fix recommendations](results/eval-2026-09-30/EVAL-REPORT.md). This behavioral run supersedes the earlier statement that only three smoke prompts had been executed; the earlier evidence remains unchanged.
