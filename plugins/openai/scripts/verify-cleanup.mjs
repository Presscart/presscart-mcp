import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const results = process.env.PRESSCART_RESULTS_DIR ?? resolve(root, 'results');
const read = name => JSON.parse(readFileSync(resolve(results, name), 'utf8'));
assert.deepEqual(read('config-after.json'), read('config-before.json'));
console.log('Codex config bytes and SHA256 exactly match the pre-test snapshot.');
assert.deepEqual(read('marketplaces-after.stdout.txt'), read('marketplaces-before.stdout.txt'));
console.log('Registered marketplace list exactly matches the pre-test snapshot.');
assert.deepEqual(read('plugins-after.stdout.txt'), read('plugins-before.stdout.txt'));
console.log('Plugin list exactly matches the pre-test snapshot.');
for (const name of ['marketplaces', 'plugins']) {
  assert.deepEqual(readFileSync(resolve(results, `${name}-after.stdout.txt`)), readFileSync(resolve(results, `${name}-before.stdout.txt`)));
}
console.log('Marketplace and plugin list stdout also match byte for byte.');
const cache = resolve(process.env.CODEX_HOME ?? resolve(homedir(), '.codex'), 'plugins/cache/personal/presscart-placement-advisor');
assert.equal(existsSync(cache), false);
console.log('The test plugin cache was removed.');

const config = resolve(homedir(), '.codex/config.toml');
if (existsSync(config)) {
  assert.doesNotMatch(readFileSync(config, 'utf8'), /skip_host_skill_discovery/, 'Host skill-discovery override remains in ~/.codex/config.toml');
}
console.log('~/.codex/config.toml contains no skip_host_skill_discovery setting.');
