// Release gate for what the portal requires of an MCP plugin's package: approved
// logo and composer icon, and the four HTTPS listing URLs. It fails until Presscart
// supplies them; it does not certify business identity, licensing, the production
// endpoint, domain verification, reviewer cases, or portal review.
// Usage: node scripts/check-release.mjs [pluginDir]
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const plugin = resolve(process.argv[2] ?? resolve(import.meta.dirname, '../plugin'));
const manifest = JSON.parse(readFileSync(resolve(plugin, 'plugin.json'), 'utf8'));
const presentation = manifest.extensions['com.openai'].interface;
const failures = [];

for (const field of ['websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL']) {
  const value = presentation[field];
  if (value === undefined) {
    failures.push(`${field}: add the publisher-approved public page to plugin/plugin.json at extensions.com.openai.interface (required for MCP review).`);
    continue;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    parsed = undefined;
  }
  if (typeof value !== 'string' || value.length > 1024 || /\s/.test(value) || parsed?.protocol !== 'https:' || parsed.username || parsed.password) {
    failures.push(`${field}: must be an HTTPS URL of at most 1,024 characters without whitespace or credentials.`);
  }
}

for (const [field, path] of [['logo', './assets/logo.png'], ['composerIcon', './assets/icon.png']]) {
  if (presentation[field] !== path) failures.push(`${field}: add ${JSON.stringify(field)}: ${JSON.stringify(path)} to plugin/plugin.json at extensions.com.openai.interface after approved art is added.`);
  const full = resolve(plugin, path);
  if (!existsSync(full)) {
    failures.push(`${field}: missing plugin/${path.slice(2)}; supply publisher-approved square PNG, at least 48x48, under 5 MiB.`);
    continue;
  }
  const stat = lstatSync(full);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    failures.push(`${field}: asset must be a regular file, not a symlink.`);
    continue;
  }
  const bytes = readFileSync(full);
  if (bytes.length >= 5 * 1024 * 1024) failures.push(`${field}: PNG must be under 5 MiB.`);
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.readUInt32BE(8) !== 13) {
    failures.push(`${field}: asset must have a valid PNG signature and IHDR.`);
    continue;
  }
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (width !== height || width < 48 || width > 4096) failures.push(`${field}: PNG must be square and between 48x48 and 4096x4096 (got ${width}x${height}).`);
}

if (failures.length) {
  console.error('Release gate FAILED:\n' + failures.map(item => `- ${item}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log('Release gate passed: four HTTPS listing URLs, logo and composerIcon paths, PNG headers, square dimensions, minimum size, and file sizes. Publisher approval and the remaining submission blockers in SUBMISSION.md require separate review.');
}
