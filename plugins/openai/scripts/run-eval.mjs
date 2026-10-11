// Behavioral evaluation: verbatim prompts, fresh scratch sessions, no trigger nudges.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const results = resolve(process.env.PRESSCART_RESULTS_DIR ?? resolve(root, 'results/eval-2026-09-30'));
const scratch = process.env.PRESSCART_EVAL_SCRATCH;
if (!scratch || resolve(scratch).startsWith(root + '/')) throw new Error('Set PRESSCART_EVAL_SCRATCH outside the repository');
const submission = readFileSync(resolve(root, 'SUBMISSION.md'), 'utf8');
const reviewer = [...submission.matchAll(/### (Positive|Negative) (\d) — ([^\n]+)\n\n\*\*Prompt:\*\* ([^\n]+)\n\n\*\*Expected behavior:\*\* ([^\n]+)/g)].map((m) => ({
  id: `${m[1] === 'Positive' ? 'p' : 'r'}${m[2]}`, name: `${m[1]} ${m[2]} — ${m[3]}`, prompt: m[4], expected: m[5], group: 'reviewer',
}));
if (reviewer.length !== 8) throw new Error('Expected exactly eight reviewer cases');
const cases = [...reviewer,
  { id: 'u1', name: 'Unprompted launch qualification', group: 'unprompted', prompt: "We're launching a B2B fintech API next month and want some press coverage. Where do we start?", expected: 'Load installed qualify-press-needs.' },
  { id: 'u2', name: 'Unprompted outlet comparison', group: 'unprompted', prompt: 'Is Forbes Business Council or a trade outlet like Finextra a better fit for reaching bank CTOs?', expected: 'Load installed evaluate-publication-fit.' },
  { id: 'u3', name: 'Unprompted media-kit assessment', group: 'unprompted', prompt: "Here's a publisher's media kit: 'DA 90, guaranteed Google page 1, no sponsored label, $400.' Is it worth it?", expected: 'Load installed evaluate-publication-fit; flag unverified claims, disclosure and no guarantees; do not repeat publication prices.' },
  { id: 'n1', name: 'Linked-list control', group: 'control', prompt: 'Write a Python function that reverses a linked list.', expected: 'Do not load either installed skill.' },
  { id: 'n2', name: 'History control', group: 'control', prompt: 'Summarize the causes of World War I in three bullets.', expected: 'Do not load either installed skill.' },
];
const instructions = 'This session is read-only. Do not browse the web, call connectors, contact anyone, log in, submit anything, buy anything, or write files. Do not delegate. Do not search the filesystem or access repository files, prior results, project documents, or the home .agents directory. The only local files you may read are installed-plugin cache files whose exact paths are already supplied in the available metadata.';
const baseArgs = ['exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--color', 'never',
  '-c', 'approval_policy="never"', '-c', 'project_doc_max_bytes=0', '-c', 'web_search="disabled"',
  '-c', 'features.apps=false', '-c', 'features.multi_agent=false', '-c', 'features.plugins=true',
  '-c', 'features.skill_search=false', '-c', 'features.skip_host_skill_discovery=true',
  '-c', 'features.browser_use=false', '-c', 'features.computer_use=false', '-c', 'features.hooks=false',
  '-c', 'mcp_servers={}', '-c', 'marketplaces.personal.source_type="local"',
  '-c', `marketplaces.personal.source=${JSON.stringify(resolve(root, 'test-marketplace'))}`,
  '-c', 'plugins={"presscart-placement-advisor@personal"={enabled=true}}',
  '-c', `developer_instructions=${JSON.stringify(instructions)}`];
const id = process.argv[2];
if (id === 'prepare') {
  writeFileSync(resolve(results, 'cases.json'), JSON.stringify(cases, null, 2) + '\n', { flag: 'wx' });
  writeFileSync(resolve(results, 'harness.json'), JSON.stringify({ root, scratch: resolve(scratch), baseArgs, instructions, note: 'No skill-use instruction or case expectations are sent to the model. User prompts are passed verbatim as the last argv element.' }, null, 2) + '\n', { flag: 'wx' });
  console.log(`Prepared ${cases.length} cases; scratch: ${resolve(scratch)}`);
} else {
  const c = cases.find(c => c.id === id);
  if (!c) throw new Error('Expected prepare or a case ID: ' + cases.map(c => c.id).join(', '));
  const base = resolve(results, `case-${c.id}`);
  if (['.json', '.stdout.txt', '.stderr.txt', '.prompt.txt', '.processes.txt'].some(suffix => existsSync(base + suffix))) throw new Error(`Refusing to overwrite evidence for ${c.id}`);
  // process_manage is unavailable; use the same read-only fallback as run-smoke.
  const processes = spawnSync('ps', ['-axo', 'pid,ppid,comm'], { encoding: 'utf8' });
  writeFileSync(base + '.processes.txt', processes.stdout ?? '', { flag: 'wx' });
  writeFileSync(base + '.processes.stderr.txt', processes.stderr ?? '', { flag: 'wx' });
  if (processes.status !== 0) throw new Error(`Process preflight failed: ${processes.stderr}`);
  writeFileSync(base + '.prompt.txt', c.prompt, { flag: 'wx' });
  const result = spawnSync(process.execPath, [resolve(root, 'scripts/record-command.mjs'), `case-${c.id}`, 'codex', ...baseArgs, c.prompt], {
    cwd: resolve(scratch), stdio: 'inherit', env: { ...process.env, PRESSCART_RESULTS_DIR: results, PRESSCART_COMMAND_CWD: resolve(scratch) },
  });
  process.exitCode = result.status ?? 1;
}
