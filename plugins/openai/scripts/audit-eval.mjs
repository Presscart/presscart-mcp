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
if (!process.env.PRESSCART_RESULTS_DIR) throw new Error('Set PRESSCART_RESULTS_DIR to the results directory to audit');
const results = resolve(process.env.PRESSCART_RESULTS_DIR);
const read = name => readFileSync(resolve(results, name), 'utf8');
const cases = JSON.parse(read('cases.json'));
const harness = JSON.parse(read('harness.json'));
assert.deepEqual(cases, JSON.parse(readFileSync(resolve(root, 'eval/offline-cases.json'), 'utf8')), 'cases.json differs from eval/offline-cases.json');
const submission = readFileSync(resolve(root, 'SUBMISSION.md'), 'utf8');
for (const c of cases.filter(c => c.group === 'reviewer-offline')) {
  assert.ok(submission.includes(`**Prompt:** ${c.prompt}\n`), `${c.id} prompt is not a SUBMISSION.md reviewer prompt`);
}
const skillNames = /check-order-status|report-campaign-progress/i;
const sessions = new Set();
const inventory = cases.map(c => {
  const record = JSON.parse(read(`case-${c.id}.json`));
  const trace = read(`case-${c.id}.stderr.txt`);
  const stdout = read(`case-${c.id}.stdout.txt`);
  assert.equal(read(`case-${c.id}.prompt.txt`), c.prompt);
  assert.equal(record.args.at(-1), c.prompt);
  assert.deepEqual(record.args.slice(0, -1), harness.baseArgs);
  assert.equal(record.cwd, harness.scratch);
  assert.ok(!record.cwd.startsWith(root + '/'));
  assert.equal(record.args[record.args.indexOf('--sandbox') + 1], 'read-only');
  assert.doesNotMatch(c.prompt, skillNames, `${c.id} names a skill`);
  const sessionId = trace.match(/^session id: (.+)$/m)?.[1];
  assert.ok(sessionId, `Missing session for ${c.id}`);
  assert.ok(!sessions.has(sessionId), `Reused session for ${c.id}`);
  sessions.add(sessionId);
  const execEvents = [...trace.matchAll(/^exec\n([^\n]+)\n([^\n]+)/gm)].map(m => ({ command: m[1], result: m[2] }));
  const installedSkillReads = execEvents.filter(e => /succeeded/.test(e.result)).flatMap(e =>
    [...e.command.matchAll(installedSkillPattern)]
      .map(m => ({ skill: m[1], path: m[0], command: e.command, result: e.result })));
  const mcpEvents = [...trace.matchAll(/^(?:mcp|tool) [^\n]*$/gm)].map(m => m[0]);
  return { id: c.id, group: c.group, sessionId, model: trace.match(/^model: (.+)$/m)?.[1], exitCode: record.exitCode, timedOut: record.timedOut, started: record.started, finished: record.finished, stdoutBytes: Buffer.byteLength(stdout), execEvents, installedSkillReads, mcpEvents };
});
writeFileSync(resolve(results, 'trace-inventory.json'), JSON.stringify(inventory, null, 2) + '\n', { flag: 'wx' });
console.log(`Verified ${cases.length} verbatim prompts matching eval/offline-cases.json; reviewer-offline prompts match SUBMISSION.md; no prompt names a skill.`);
console.log('Verified every session is fresh, read-only, outside the repository, and used the recorded harness arguments.');
for (const c of inventory) console.log(`${c.id}: exit=${c.exitCode}; ${c.model}; loaded=${c.installedSkillReads.map(r => r.skill).join(', ') || 'none'}; execEvents=${c.execEvents.length}; mcpEvents=${c.mcpEvents.length}`);
console.log('Trace inventory is evidence extraction only, not a behavioral grader.');
