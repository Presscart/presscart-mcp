// Required release assets are deliberately absent until publisher-approved art
// is supplied. This gate fails without both real PNGs and manifest references;
// it does not certify business identity, licensing, or portal review.
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const plugin = resolve(root, 'plugin');
const manifest = JSON.parse(readFileSync(resolve(plugin, 'plugin.json'), 'utf8'));
const presentation = manifest.extensions['com.openai'].interface;
const failures = [];
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
  console.error('Release asset gate FAILED:\n' + failures.map(item => `- ${item}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log('Release asset gate passed: logo and composerIcon paths, PNG headers, square dimensions, minimum size, and file sizes. Publisher approval and remaining submission blockers require separate review.');
}
