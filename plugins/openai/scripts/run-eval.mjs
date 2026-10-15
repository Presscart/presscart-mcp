// Behavioral evaluation: verbatim prompts, fresh scratch sessions, no trigger nudges.
// Cases come from eval/offline-cases.json: prompts that can run without a signed-in
// Presscart connection. The plugin's MCP server is disabled per invocation, so these
// runs test skill behavior when no account connection is available. Reviewer cases
// that need the connection live in SUBMISSION.md and run against the test account.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
if (!process.env.PRESSCART_RESULTS_DIR) throw new Error('Set PRESSCART_RESULTS_DIR to a fresh results directory');
const results = resolve(process.env.PRESSCART_RESULTS_DIR);
const scratch = process.env.PRESSCART_EVAL_SCRATCH;
if (!scratch || resolve(scratch).startsWith(root + '/')) throw new Error('Set PRESSCART_EVAL_SCRATCH outside the repository');
const cases = JSON.parse(readFileSync(resolve(root, 'eval/offline-cases.json'), 'utf8'));
if (new Set(cases.map(c => c.id)).size !== cases.length) throw new Error('Case ids must be unique');
const instructions = 'This session is read-only. Do not browse the web, call connectors, contact anyone, log in, submit anything, buy anything, or write files. Do not delegate. Do not search the filesystem or access repository files, prior results, project documents, or the home .agents directory. The only local files you may read are installed-plugin cache files whose exact paths are already supplied in the available metadata.';
const baseArgs = ['exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--color', 'never',
  '-c', 'approval_policy="never"', '-c', 'project_doc_max_bytes=0', '-c', 'web_search="disabled"',
  '-c', 'features.apps=false', '-c', 'features.multi_agent=false', '-c', 'features.plugins=true',
  '-c', 'features.skill_search=false', '-c', 'features.skip_host_skill_discovery=true',
  '-c', 'features.browser_use=false', '-c', 'features.computer_use=false', '-c', 'features.hooks=false',
  // Remote-curated plugins (the user's superpowers) still loaded under --ignore-user-config
  // in the first two 0.2.0 runs; keep them out so only this plugin's skills compete.
  '-c', 'features.remote_plugin=false',
  '-c', 'mcp_servers={}', '-c', 'marketplaces.personal.source_type="local"',
  '-c', `marketplaces.personal.source=${JSON.stringify(resolve(root, 'test-marketplace'))}`,
  // The bundled server stays disabled: no account connection, no network calls to Presscart.
  '-c', 'plugins={"presscart@personal"={enabled=true,mcp_servers={presscart={enabled=false}}}}',
  '-c', `developer_instructions=${JSON.stringify(instructions)}`];
const id = process.argv[2];
if (id === 'prepare') {
  writeFileSync(resolve(results, 'cases.json'), JSON.stringify(cases, null, 2) + '\n', { flag: 'wx' });
  writeFileSync(resolve(results, 'harness.json'), JSON.stringify({ root, scratch: resolve(scratch), baseArgs, instructions, note: 'No skill-use instruction or case expectations are sent to the model. User prompts are passed verbatim as the last argv element. The plugin MCP server is disabled per invocation.' }, null, 2) + '\n', { flag: 'wx' });
  console.log(`Prepared ${cases.length} cases; scratch: ${resolve(scratch)}`);
} else {
  const c = cases.find(c => c.id === id);
  if (!c) throw new Error('Expected prepare or a case ID: ' + cases.map(c => c.id).join(', '));
  const base = resolve(results, `case-${c.id}`);
  if (['.json', '.stdout.txt', '.stderr.txt', '.prompt.txt', '.processes.txt'].some(suffix => existsSync(base + suffix))) throw new Error(`Refusing to overwrite evidence for ${c.id}`);
  // process_manage is unavailable; save a read-only process snapshot instead.
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
