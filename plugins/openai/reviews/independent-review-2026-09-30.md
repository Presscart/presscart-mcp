VERDICT: CHANGES REQUESTED

The package is well built. The zip matches `plugin/` byte for byte, the manifests fit the documented schema and limits, the port keeps every source safety line, and no secrets or local paths are in the package. It is not ready to submit, for two reasons. The zip will fail the portal's required-image checks, and one of those images is missing from the blocker list. There are also four instruction and wording fixes that are quick and worth making before the safety scan and human review.

## Blocking (portal submission)

**B1. No `logo` or `composerIcon` in the package, and only the logo is tracked as a blocker**
- **Where:** `plugin/plugin.json:11-29`; `SUBMISSION.md:57`, `SUBMISSION.md:133`.
- **Evidence:** the submission-errors doc lists `plugin_logo_path_missing` ("`interface.logo` is required and must reference a square image") and `plugin_composer_icon_path_missing` ("`interface.composerIcon` is required"). Errors block submission. The real installed examples declare both, e.g. the installed `pdf` plugin's `.codex-plugin/plugin.json:41-42`. SUBMISSION.md lists the logo but never mentions `composerIcon`, and no test checks for either.
- **Fix:** add `plugin/assets/logo.png` and `plugin/assets/icon.png`: square, at least 48×48, under 5 MiB. Reference them as `"./assets/…"` in both manifests. Add `composerIcon` to the blocker lists, and update the seven-file test (`tests/package.test.mjs:13-20`) and `verify-artifacts.py:12` to match.

The other blockers are already acknowledged in `SUBMISSION.md:129-137` and I'm not repeating them: verified identity, Apps Management access, privacy/terms/support URLs, license, and the portal scans.

## Should-fix

**S1. The qualify skill still allows repeating a user-supplied price quote, which contradicts its new commerce rule and SUBMISSION.md**
- **Where:** `qualify-press-needs/SKILL.md:27` vs `:69`; `SUBMISSION.md:125`.
- **Evidence:**
  - Line 27 (unchanged from the source) says: if "the user supplied specific evidence (such as a quote)… label it user-provided and not verified."
  - Line 69 says: do not "quote publication prices (including user-supplied prices)."
  - SUBMISSION.md:125 claims the port "never repeats publication price quotes", but only `evaluate-publication-fit:42` was tightened.
  - Given "Budget $6k; the outlet quoted me $2k", the model can follow line 27 and restate $2k.
  - Test 11 (`tests/package.test.mjs:296-314`) pins line 27 unchanged, so the suite locks in the contradiction.
- **Fix:** change line 27 to something like "…unless the user supplied specific non-price evidence (for example a stated delivery date), in which case label it user-provided and not verified. Do not restate a supplied publication price." Then add it as a third documented replacement in test 11.

**S2. The skills repeatedly send users to "your own Presscart account" for pricing and purchasing (commerce-review risk)**
- **Where:**
  - `qualify-press-needs/SKILL.md:27` and `:65`
  - `evaluate-publication-fit/SKILL.md:31`, `:44`, `:70` and `:92` (":92" says "purchasing are decisions the account holder makes in their own Presscart account")
- **Evidence:** the plugin guidelines ban selling digital services "directly or indirectly". Paid placements are a digital service. The evaluate smoke run shows the effect: "In your own Presscart account, confirm current price/tier and total cost against the $6,000 total ceiling" (`TEST-RESULTS.md:346`).
  - This works as a purchase call to action, which the skills' own commerce section forbids (`:69` / `:96`).
  - It also assumes every ChatGPT user has a Presscart account, which clashes with the "no Presscart account" statement in the listing.
- **Fix:** use neutral wording, e.g. "confirm these facts directly with the publication or the provider you are working with". Drop the purchasing sentence at `evaluate:92` (keep "the user takes these actions themselves"). Keep Presscart only as the publisher name and the informational `websiteURL`.

**S3. Skill descriptions over-trigger on common Codex and research wording**
- **Where:** `qualify-press-needs/SKILL.md:3` ("wants press coverage, **a feature**, …"); `evaluate-publication-fit/SKILL.md:3` ("wants to **compare publications**").
- **Evidence:** in Codex, "a feature" nearly always means a software feature. "Compare publications / which journal fits my paper" is a common academic request. Either could pull in paid-placement disclosure output. The build-skills doc says the description should state exact trigger conditions.
- **Fix:**
  - qualify: say "a media feature or profile article" and "PR placement in media outlets".
  - evaluate: say "news or trade media outlets (not academic journals)".
  - Optionally drop "Works offline" from `qualify:3`. The Claude-migration doc treats "offline operation" as a special-review case, so the phrase invites a misread.

**S4. The shipped README contains development and release-status content**
- **Where:** `plugin/README.md:29`, `:31-50`.
- **Evidence:**
  - End users get `codex plugin marketplace add ./test-marketplace` and "Consult the repository verification report", but neither path exists in the zip.
  - Line 29 publishes internal status ("Brand assets… privacy/terms/support URLs, and a distribution license decision are pending").
  - `README.md:33` also describes the dual-manifest internals.
- **Fix:** move lines 29-50 into the repo-level docs (`INDEX.md` / `test-marketplace/README.md`). Keep a short "Data and publisher" section that links to the privacy URL once it exists.

**S5. The reviewer test cases are missing fields the portal asks for**
- **Where:** `SUBMISSION.md:71-117`.
- **Evidence:** "Submit plugins → Testing" asks for:
  - on each positive case: expected result shape, plus the test account or fixture data;
  - on each negative case: why the plugin shouldn't complete the action.

  None of the eight cases has a fixture line. Only P1 and P3 describe a result shape. None of the negative cases has a "Why" line. Negative 3 expects "do not repeat supplied publication prices", but its prompt contains no price, so that part can't be observed.
- **Fix:**
  - Add "Fixture: none, no account or credentials needed" and "Result shape: `Press qualification brief` block / per-outlet `Fit:` block + `Confirm before deciding`" to each positive case.
  - Add "Why: booking/checkout is a digital-service transaction outside the plugin's informational scope" (and equivalents) to each negative case.
  - Put an actual price into the Negative 3 prompt.
- **Also:** `SUBMISSION.md:69` implies 5 + 3 cases are only mandated for remote-MCP submissions. The Submit plugins page asks for "at least five positive… and three negative" for every submission. Reword it.

**S6. TEST-RESULTS overstates how well the smoke runs isolate the skill**
- **Where:** `TEST-RESULTS.md:5`, `:270-279`, `:353-366`; `scripts/run-smoke.mjs:21`.
- **Evidence:**
  - Every "raw user prompt" was sent inside a wrapper that names the plugin and says "Do not browse, call connectors, contact anyone" (`results/smoke-negative-final.json:33`).
  - The negative refusal ("I can't book… or provide a checkout link") is therefore at least partly caused by the harness, not the skill.
  - The report shows only the raw prompt inline and calls the case "Pass". Line 270 only hints at this ("relies on the advisor session context").
- **Fix:** quote the wrapper inline in the report. Relabel the negative run as "consistent with, not isolated to, skill behavior". Ideally re-run the negative and injection cases without the behavioral clauses in the wrapper.

## Nit

- **N1. Duplicate manifest.** `.codex-plugin/plugin.json` is redundant. The docs say that when `extensions.com.openai` is present, it "replaces the entire `.codex-plugin/plugin.json` overlay… they aren't merged", and the portal writes its own normalized copy (`manifest_normalized`). Test 2 prevents drift (`tests/package.test.mjs:175-182`), so this is harmless. Consider dropping it, or keep it and note it's for older Codex CLIs only.
- **N2. Capabilities style.** `plugin.json:17-22` uses full sentences. The docs example and every installed OpenAI plugin use short tags (`"Read"`, `"Write"`, `"Interactive"`; e.g. the installed `latex` plugin's `.codex-plugin/plugin.json:12-16`). Sentences are within the 120-character limit, so this is valid. Check how the portal renders them before keeping them.
- **N3. Validator can't be re-run.** `TEST-RESULTS.md:141` cites `<codex-home>/skills/.system/plugin-creator/scripts/validate_plugin.py`, which no longer exists at that path, so the result can't be reproduced now. It is also a Codex-overlay validator: nothing validates root `plugin.json` against the agent-plugins.org schema beyond test 2's field checks.
- **N4. Repeated privacy text.** The privacy sentence appears twice in each skill (`qualify:26` / `:71`; `evaluate:98` repeats the same rule). It's harmless, but the duplication costs tokens.
- **N5. Chaining wording.** "run the `qualify-press-needs` skill first" (`evaluate:14`) is fine in Codex. In ChatGPT, "use the qualify-press-needs workflow (or ask for the missing items)" is more robust.
- **N6. "Purpose and originality" risk.** The guidelines expect functionality "not natively supported" by ChatGPT. This is a prompt-only planning aid with no data source, so expect a reviewer to question it. Strong, specific starter prompts and test cases are the main defense.

## Checked and fine

- **Package layout:**
  - The root `plugin.json` has the `$schema` field, and the kebab-case name (27 characters) and semver version are valid. The description is 207 of 1,024 characters.
  - `extensions["com.openai"].interface` uses the documented field names. `defaultPrompt` is the correct field name; there's no invented `starterPrompts`.
  - No `skills` / `apps` / `mcpServers` / `hooks` / `screenshots` fields, so none of the skills-only exclusions apply. `author.name` = `developerName` = "Presscart", so there's no `developer_name_defaulted` warning.
  - Skill identities are 52 and 47 characters, under the 64 limit.
- **`agents/openai.yaml`:** both are valid `interface` mappings with `display_name`, `short_description` and `default_prompt`. The `$skill` style matches the installed pdf/visualize examples.
- **Zip:**
  - Seven regular files at the archive root with no sibling or junk files. SHA256 `54a48f47…34f4a8` matches the report.
  - `unzip -p | cmp` against `plugin/` passed for all seven files.
  - I re-ran `node --test tests/`: 13 of 13 pass.
- **Listing limits:**
  - Display name 27/30. Short description exactly 30/30. Long description about 945/4,000.
  - Capabilities: 4 entries, each ≤ 62 characters.
  - Starter prompts: 3 unique, one line, ≤ 51 characters, no `@`.
  - Category `Business & Operations` is in the supported list. URLs are HTTPS with no credentials. I found no control or invisible characters.
- **Policy basics:** no checkout, pricing or payment links; only the homepage and schema URLs appear (test 9 allowlist). No implied OpenAI endorsement. No "Claude" wording in the README or skills. No credential requests, and the skills say not to repeat credentials a user volunteers. The listing honestly states there is no catalog or account connection.
- **Port fidelity:** I read both skills in full against the source. Every source line is preserved verbatim. The only edits are `evaluate:42` and `:60`, which are stricter, plus the appended commerce/privacy sections. All the named safety rules survive intact, so no rule was weakened or lost:
  - unverified catalog facts
  - no ranking on unverified data
  - no connector calls
  - paid-placement disclosure, and never presenting paid coverage as earned
  - no guarantees on AI citations, rankings, traffic or visas (attorney referral)
  - untrusted pasted content, reported and treated as a negative signal
  - user-only actions

  The one contradiction the new sections introduce is S1.
- **Secrets and identifiers:** none inside `plugin/` or the zip (no emails, tokens, UUIDs or absolute paths). Absolute paths appear only in repo-level docs and `results/`, which are not shipped.
