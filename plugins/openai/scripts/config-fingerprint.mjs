// Read only the normal config file, never auth files; output hashes, not values.
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const phase = process.argv[2];
if (!['before', 'after'].includes(phase)) throw new Error('Expected before or after');
const config = resolve(process.env.CODEX_HOME ?? resolve(homedir(), '.codex'), 'config.toml');
let fingerprint;
try {
  const bytes = readFileSync(config);
  fingerprint = { exists: true, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  fingerprint = { exists: false };
}
const results = process.env.PRESSCART_RESULTS_DIR ?? resolve(import.meta.dirname, '../results');
writeFileSync(resolve(results, `config-${phase}.json`), JSON.stringify(fingerprint, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(fingerprint));
