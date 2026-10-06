// Evidence integrity and trace inventory only. Behavioral grades are manual.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'plugin/plugin.json'), 'utf8'));
const installedPrefix = resolve(process.env.CODEX_HOME ?? resolve(homedir(), '.codex'), 'plugins/cache/personal', manifest.name, manifest.version, 'skills') + '/';
const escapedPrefix = installedPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const installedSkillPattern = new RegExp(escapedPrefix + '([^/]+)/SKILL\\.md', 'g');
const results = resolve(process.env.PRESSCART_RESULTS_DIR ?? resolve(root, 'results/eval-2026-09-30'));
const read = name => readFileSync(resolve(results, name), 'utf8');
const cases = JSON.parse(read('cases.json'));
const harness = JSON.parse(read('harness.json'));
const reviewerPrompts = [...readFileSync(resolve(root, 'SUBMISSION.md'), 'utf8').matchAll(/\*\*Prompt:\*\* ([^\n]+)/g)].map(m => m[1]);
assert.deepEqual(cases.filter(c => c.group === 'reviewer').map(c => c.prompt), reviewerPrompts);
const sessions = new Set();
const inventory = cases.map(c => {
  const record = JSON.parse(read(`case-${c.id}.json`));
  const trace = read(`case-${c.id}.stderr.txt`);
  const stdout = read(`case-${c.id}.stdout.txt`);
  assert.equal(read(`case-${c.id}.prompt.txt`), c.prompt);
  assert.equal(record.args.at(-1), c.prompt);
  assert.equal(record.cwd, harness.scratch);
  assert.ok(!record.cwd.startsWith(root + '/'));
  assert.equal(record.args[record.args.indexOf('--sandbox') + 1], 'read-only');
  if (c.group !== 'reviewer') assert.doesNotMatch(c.prompt, /presscart|qualify-press-needs|evaluate-publication-fit/i);
  const sessionId = trace.match(/^session id: (.+)$/m)?.[1];
  assert.ok(sessionId, `Missing session for ${c.id}`);
  assert.ok(!sessions.has(sessionId), `Reused session for ${c.id}`);
  sessions.add(sessionId);
  const execEvents = [...trace.matchAll(/^exec\n([^\n]+)\n([^\n]+)/gm)].map(m => ({ command: m[1], result: m[2] }));
  const installedSkillReads = execEvents.filter(e => /succeeded/.test(e.result)).flatMap(e =>
    [...e.command.matchAll(installedSkillPattern)]
      .map(m => ({ skill: m[1], path: m[0], command: e.command, result: e.result })));
  return { id: c.id, sessionId, model: trace.match(/^model: (.+)$/m)?.[1], exitCode: record.exitCode, timedOut: record.timedOut, started: record.started, finished: record.finished, stdoutBytes: Buffer.byteLength(stdout), execEvents, installedSkillReads };
});
writeFileSync(resolve(results, 'trace-inventory.json'), JSON.stringify(inventory, null, 2) + '\n', { flag: 'wx' });
console.log('Verified 13 verbatim prompts, eight matching SUBMISSION.md; all sessions fresh and read-only outside the repository.');
console.log('Verified U1–U3 and N1–N2 contain no skill or plugin names.');
for (const c of inventory) console.log(`${c.id}: exit=${c.exitCode}; ${c.model}; loaded=${c.installedSkillReads.map(r => r.skill).join(', ') || 'none'}; execEvents=${c.execEvents.length}`);
console.log('Trace inventory is evidence extraction only, not a behavioral grader.');
