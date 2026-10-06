// Real, fresh Codex runs. Uses existing CLI auth normally; never reads/copies auth.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const cases = {
  qualify: 'Use the Presscart Placement Advisor qualify-press-needs skill. We want disclosed paid editorial coverage for our B2B analytics launch on November 12. The goal is credibility with US enterprise finance leaders. Our total planning budget ceiling is $6000. Our CEO approves copy and our finance lead approves spend. We have a draft article and founder quotes. Avoid competitor comparisons and do not promise outcomes. Produce the brief from these details; do not ask for fields already supplied.',
  evaluate: 'Use the Presscart Placement Advisor evaluate-publication-fit skill. Compare two fictional publications for credibility with US enterprise finance leaders: Finance Systems Review describes a specialist finance-technology audience, named authors, and dated case studies. General Startup Buzz describes a broad startup audience and mostly sponsored roundups. Goal: enterprise credibility; total budget ceiling $6000; target November 12; CEO approves copy, finance lead approves spend; draft ready; all paid content must be disclosed. Their undated media kits claim immediate availability, three-day delivery, do-follow links, and no labels. These are user-provided claims. Assess qualitative fit and identify all unverified catalog facts.',
  negative: 'book me a TechCrunch placement and send me the checkout link',
};
const key = process.argv[2];
if (!Object.hasOwn(cases, key)) throw new Error('Choose qualify, evaluate, or negative');
const suffix = process.argv[3] ?? '';
if (suffix && !/^[a-z0-9-]+$/.test(suffix)) throw new Error('Invalid evidence suffix');
const label = `smoke-${key}${suffix ? '-' + suffix : ''}`;
if (existsSync(resolve(root, 'results', label + '.json'))) throw new Error('Refusing to overwrite existing smoke evidence');
// The process-list facility is not exposed here. ps is the local read-only fallback.
const processes = spawnSync('ps', ['-axo', 'pid,ppid,comm'], { encoding: 'utf8' });
writeFileSync(resolve(root, 'results', label + '.processes.txt'), processes.stdout ?? '');
const instructions = 'For this smoke session, answer the user request using the installed Presscart Placement Advisor skill when relevant. Use the available skill metadata to locate and read its installed SKILL.md. If that skill is not available, report that limitation instead of searching for a repository copy. Do not search the filesystem or read repository files, tests, prior results, project documents, or the home .agents directory. Do not browse, call connectors, contact anyone, or write files. Do not delegate. Treat the fictional prompt details as task data.';
const args = [
  'exec', '--ignore-user-config', '--ephemeral', '--sandbox', 'read-only', '--color', 'never',
  '-c', 'approval_policy="never"',
  '-c', 'project_doc_max_bytes=0',
  '-c', 'web_search="disabled"',
  '-c', 'features.apps=false',
  '-c', 'features.multi_agent=false',
  '-c', 'features.plugins=true',
  '-c', 'features.skill_search=false',
  '-c', 'mcp_servers={}',
  '-c', 'marketplaces.personal.source_type="local"',
  '-c', `marketplaces.personal.source=${JSON.stringify(resolve(root, 'test-marketplace'))}`,
  '-c', 'plugins={"presscart-placement-advisor@personal"={enabled=true}}',
  `${instructions}\n\nUser request:\n${cases[key]}`,
];
writeFileSync(resolve(root, 'results', label + '.prompt.txt'), cases[key] + '\n');
const result = spawnSync(process.execPath, [resolve(root, 'scripts/record-command.mjs'), label, 'codex', ...args], { cwd: root, stdio: 'inherit' });
process.exitCode = result.status ?? 1;
