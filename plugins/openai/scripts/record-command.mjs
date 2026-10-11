// Capture exact subprocess streams without shell interpolation or auth-file access.
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const [label, command, ...args] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(label ?? '') || !command) throw new Error('Usage: node scripts/record-command.mjs label command [args...]');
const root = resolve(import.meta.dirname, '..');
const results = resolve(process.env.PRESSCART_RESULTS_DIR ?? resolve(root, 'results'));
const cwd = resolve(process.env.PRESSCART_COMMAND_CWD ?? root);
const base = resolve(results, label);
if (existsSync(base + '.json')) throw new Error(`Evidence already exists: ${label}`);
mkdirSync(dirname(base), { recursive: true });
const stdout = openSync(base + '.stdout.txt', 'wx');
const stderr = openSync(base + '.stderr.txt', 'wx');
const started = new Date().toISOString();
const child = spawn(command, args, { cwd, stdio: ['ignore', stdout, stderr] });
let spawnError;
let timedOut = false;
child.on('error', error => { spawnError = error.message; });
const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, 240_000);
child.on('close', (exitCode, signal) => {
  clearTimeout(timer);
  closeSync(stdout);
  closeSync(stderr);
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  const commandLine = [command, ...args].map(quote).join(' ');
  const record = { command, args, commandLine, cwd, started, finished: new Date().toISOString(), exitCode, signal, timedOut, ...(spawnError ? { spawnError } : {}) };
  writeFileSync(base + '.json', JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
  console.log(`${label}: exit=${exitCode}, signal=${signal}, timedOut=${timedOut}`);
  console.log(`Exact output: ${base}.stdout.txt and ${base}.stderr.txt`);
  process.exitCode = exitCode ?? 1;
});
