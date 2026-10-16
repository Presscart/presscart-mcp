// Check that Codex loads the installed plugin's MCP server: Codex drops an invalid plugin server
// without an error, and an install alone does not prove the server loads.
// Usage: CODEX_HOME=<throwaway home> node scripts/verify-codex-mcp.mjs --mcp-url https://<host>/mcp/openai
// Runs only `codex mcp list --json`: no login and no auth-file reads. To report an auth status,
// Codex fetches the URL's OAuth discovery metadata.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const at = process.argv.indexOf('--mcp-url');
const url = at > 1 ? process.argv[at + 1] : undefined;
if (!url) throw new Error('Usage: CODEX_HOME=<throwaway home> node scripts/verify-codex-mcp.mjs --mcp-url https://<host>/mcp/openai');
const home = process.env.CODEX_HOME;
const realHome = resolve(homedir(), '.codex');
// Compare directory identity too, so an alias such as the /System/Volumes/Data firmlink can't pass.
const isRealHome = (path) => {
  if (resolve(path) === realHome) return true;
  try {
    const [a, b] = [statSync(path), statSync(realHome)];
    return a.dev === b.dev && a.ino === b.ino;
  } catch {
    return false;
  }
};
assert.ok(home && existsSync(home) && !isRealHome(home), 'Set CODEX_HOME to the existing throwaway home the plugin was installed into.');
const result = spawnSync('codex', ['mcp', 'list', '--json'], { encoding: 'utf8', timeout: 120_000 });
assert.equal(result.status, 0, result.error?.message ?? result.stderr);
const servers = JSON.parse(result.stdout);
const server = servers.find((entry) => entry.name === 'presscart');
assert.ok(server, `Codex did not load the plugin's MCP server; it lists: ${servers.map((entry) => entry.name).join(', ') || 'nothing'}`);
assert.equal(server.enabled, true, 'presscart is disabled');
assert.equal(server.transport?.type, 'streamable_http');
assert.equal(server.transport.url, url, 'presscart was built for a different URL');
for (const key of ['bearer_token_env_var', 'http_headers', 'env_http_headers']) {
  assert.equal(server.transport[key], null, `presscart declares ${key}`);
}
// not_logged_in: discovery found OAuth and no token is stored; o_auth: signed in. The offline eval's
// reserved .invalid placeholder never resolves, so its discovery can only end as unknown.
const statuses = new URL(url).hostname.endsWith('.invalid') ? ['unknown'] : ['not_logged_in', 'o_auth'];
assert.ok(statuses.includes(server.auth_status), `expected auth status ${statuses.join(' or ')}, got ${server.auth_status}`);
console.log(`Codex loads presscart from ${url}; auth status ${server.auth_status}.`);
