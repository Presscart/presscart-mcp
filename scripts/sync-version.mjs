import { readFile, writeFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const versionFileUrl = new URL('../src/version.ts', import.meta.url);

await writeFile(
  versionFileUrl,
  `// Generated from package.json by npm run sync:version.\nexport const PACKAGE_VERSION = '${packageJson.version}';\n`,
  'utf8'
);
