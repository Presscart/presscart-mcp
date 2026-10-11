// Reproduce the reviewed skill port without changing the original source.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = resolve(process.argv[2] ?? resolve(root, '../presscart-claude-plugin/plugin'));
const replacements = JSON.parse(readFileSync(resolve(root, 'tests/fixtures/source-replacements.json'), 'utf8'));
const commerce = `
## Commerce boundaries

Do not sell digital products or services, provide checkout, pricing, payment, or transaction links, or use purchase calls to action. If asked to book or pay for a placement, decline that action briefly because this plugin's permanent scope is planning only, then continue with qualification or qualitative evaluation. Attribute the refusal to this permanent scope, never to the current session or tool availability.
`;
const privacy = `
## Privacy

Never request passwords, API tokens, login links, payment card details, invoices, customer lists, or private contact data. If supplied, do not repeat them; explain that they are not needed and continue without them.
`;
for (const name of ['qualify-press-needs', 'evaluate-publication-fit']) {
  let text = readFileSync(resolve(source, 'skills', name, 'SKILL.md'), 'utf8');
  for (const { before, after, reason } of replacements[name]) {
    if (text.split(before).length - 1 !== 1) throw new Error(`Source changed; review replacement: ${reason}`);
    text = text.replace(before, after);
  }
  text = text.replaceAll('Claude', 'the assistant').trimEnd() + '\n' + commerce;
  // Qualification already has the full privacy rule in its original intake.
  if (name === 'evaluate-publication-fit') text += privacy;
  const target = resolve(root, 'plugin/skills', name, 'SKILL.md');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
  console.log(`Ported ${name}; reviewed replacements applied; source remains read-only.`);
}
