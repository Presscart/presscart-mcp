# Local Presscart test marketplace

This repository fixture registers the `../plugin/` package for local Codex testing. It is not a home-directory marketplace and must not be copied to or generated under the user agents directory.

The descriptor is `.agents/plugins/marketplace.json` under this directory. Its marketplace name is `personal`, its display name is `Personal`, and its plugin source is `./plugins/presscart`, a repository symlink to `../../plugin`. Preserve symlinks when using this fixture. Its `policy.authentication` is `ON_USE`, so installing never starts an OAuth sign-in. The distribution ZIP is built separately and contains no marketplace files or symlink.

## Build before installing

`plugin/` has no `mcp.json`; the URL is a build input. Build first so the installed package matches a ZIP:

```sh
npm run package -- --mcp-url https://<host>/mcp/openai --write-local-config
```

For the offline eval, build with a placeholder that never resolves (`https://mcp.example.invalid/mcp/openai`); the runner disables the plugin's MCP server anyway. For a signed-in developer-mode run, build with the staging or production `/mcp/openai` URL. Never upload a non-production build.

## Install, evaluate, remove

The eval runner uses `--ignore-user-config` and enables the plugin with `-c` overrides, so a run needs only the installed files in `<codex-home>/plugins/cache/personal/`, not a registration in the user's `config.toml`. Other Codex sessions on the same machine read that config, so do not register this fixture there. Instead (the 2026-10-16 procedure):

1. Check that `~/.codex/plugins/cache/personal` does not exist. If it does, another marketplace named `personal` is in use: do not touch it; rename this fixture and update the runner.
2. Capture the baseline from `plugins/openai/`, with `PRESSCART_RESULTS_DIR` set to a fresh results directory:

   ```sh
   node scripts/config-fingerprint.mjs before
   node scripts/record-command.mjs marketplaces-before codex plugin marketplace list --json
   node scripts/record-command.mjs plugins-before codex plugin list --json
   ```

3. Install with the real CLI into an empty throwaway home. It needs no authentication; never copy auth files into it.

   ```sh
   CODEX_HOME=<empty scratch dir> codex plugin marketplace add ./test-marketplace
   CODEX_HOME=<empty scratch dir> codex plugin add presscart@personal
   CODEX_HOME=<empty scratch dir> python3 scripts/verify-artifacts.py --mcp-url <build url>
   ```

4. Copy `<scratch dir>/plugins/cache/personal/presscart/0.2.0` to the same path under `~/.codex/plugins/cache/`, then `python3 scripts/verify-artifacts.py --mcp-url <build url>` against the real home.
5. Run `scripts/run-eval.mjs` with `PRESSCART_EVAL_SCRATCH` set to a fresh initialized scratch repository outside this repository: `prepare` once, then each id from [eval/offline-cases.json](../eval/offline-cases.json) as a separate invocation (at most three at a time). Each case is a fresh ephemeral read-only session with host skill discovery disabled, the plugin's MCP server disabled, and the user prompt passed verbatim. The runner refuses to overwrite evidence. Run every case once; do not retry a case to get a different answer. Manually grade complete responses and installed-skill reads; CLI exit 0 is not a behavioral pass. `scripts/audit-eval.mjs` checks evidence integrity only.
6. Delete `~/.codex/plugins/cache/personal` and the scratch home, then verify nothing else changed:

   ```sh
   node scripts/config-fingerprint.mjs after
   node scripts/record-command.mjs marketplaces-after codex plugin marketplace list --json
   node scripts/record-command.mjs plugins-after codex plugin list --json
   node scripts/verify-cleanup.mjs
   ```

`verify-cleanup.mjs` requires identical config fingerprints, identical list output, removal of the test cache, and no `skip_host_skill_discovery` in the normal config.

Do not read or copy authentication files, log in, submit to a portal, or push changes during these runs. Record command output and failures rather than claiming success when the CLI reports an error.

The reviewer cases in [SUBMISSION.md](../SUBMISSION.md#reviewer-test-cases) need a signed-in Presscart test account and run in ChatGPT developer mode, not with this fixture.
