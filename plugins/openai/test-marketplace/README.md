# Local Presscart test marketplace

This repository fixture registers the installable `../plugin/` package for local Codex testing. It is not a home-directory marketplace and must not be copied to or generated under the user agents directory.

The descriptor is `.agents/plugins/marketplace.json` under this directory. Its marketplace name is `personal`, its display name is `Personal`, and its plugin source is `./plugins/presscart-placement-advisor`, relative to this marketplace root. That path is a repository symlink to `../../plugin`; it avoids a second, potentially stale copy of the package. Preserve symlinks when using this fixture. The distribution ZIP is built separately from `plugin/` and contains no marketplace files or symlink.

The initial CLI baseline for this task found no registered marketplace named `personal`. Before reusing the fixture later, check existing registrations: if `personal` already belongs to another marketplace, do not overwrite it or later remove it. Create a distinct repository-local fixture name in that case and update the evaluation configuration to match. Actual installation, evaluation, errors, and cleanup are recorded in [TEST-RESULTS.md](../TEST-RESULTS.md).

From the plugin root (`plugins/openai/` in presscart-mcp), the requested local test flow is:

```sh
codex plugin marketplace add ./test-marketplace
codex plugin list
codex plugin add presscart-placement-advisor@personal
```

Run `scripts/run-eval.mjs` after installation with `PRESSCART_RESULTS_DIR` set to a fresh results directory and `PRESSCART_EVAL_SCRATCH` set to a fresh initialized scratch repository outside this repository. Run `prepare`, then `p1 p2 p3 p4 p5 r1 r2 r3 u1 u2 u3 n1 n2` as separate invocations. The harness uses fresh ephemeral read-only sessions, disables host skill discovery per invocation, and passes user prompts verbatim. It refuses to overwrite evidence. Manually grade the complete responses and successful installed-skill reads; CLI exit 0 is not a behavioral pass. Use `scripts/audit-eval.mjs` for evidence integrity only.

Keep outputs in the new results directory. Do not create or copy a temporary `CODEX_HOME`, read or copy authentication files, log in, submit to a portal, push changes, or access the user agents directory. The CLI may update its normal plugin registration/cache state as part of this explicitly requested test; do not manually write home-directory marketplace files or persist `skip_host_skill_discovery` in config.toml.

After testing, remove only the registration and plugin created by this fixture:

```sh
codex plugin remove presscart-placement-advisor@personal
codex plugin marketplace remove personal
```

Record command output and failures rather than claiming successful loading or cleanup when the CLI reports an error. Recheck the user's plugin state against the baseline. These instructions are a test procedure, not a claim that commands are supported or that the plugin is published.

Before installation and after removal, capture config fingerprints with `scripts/config-fingerprint.mjs` and save `codex plugin marketplace list --json` and `codex plugin list --json`. Run `scripts/verify-cleanup.mjs` with the same results directory; it requires identical config fingerprints, identical list bytes, removal of the test cache, and absence of `skip_host_skill_discovery` in the normal config.

The package's user README intentionally omits this development fixture. Current version is 0.1.1. The root portable manifest carries `extensions.com.openai`; no compatibility overlay is intended. The actual install evidence determines CLI compatibility. Test, package, asset-gate, and release-status details live in [INDEX.md](../INDEX.md), not in the distribution README.
