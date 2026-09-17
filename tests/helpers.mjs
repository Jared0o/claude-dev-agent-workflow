// Shared helpers for the dev-agent-workflow test suite: temporary Git repositories
// with isolated configuration and a CLI wrapper around scripts/workflow.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const SCRIPT = path.join(ROOT, 'scripts', 'workflow.mjs');

export function isolatedEnv(tmp) {
  const globalConfig = path.join(tmp, 'gitconfig');
  if (!fs.existsSync(globalConfig)) fs.writeFileSync(globalConfig, '');
  return {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_TERMINAL_PROMPT: '0',
  };
}

export function makeTmp(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'daw-test-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  return tmp;
}

export function makeRepo(t, { ignore = true, initialCommit = true } = {}) {
  const tmp = makeTmp(t);
  const repo = path.join(tmp, 'application');
  fs.mkdirSync(repo);
  const ctx = { tmp, repo, env: isolatedEnv(tmp), taskId: 'change' };
  git(ctx, 'init', '-q', '-b', 'main');
  git(ctx, 'config', 'user.name', 'Workflow test');
  git(ctx, 'config', 'user.email', 'workflow@example.invalid');
  git(ctx, 'config', 'commit.gpgsign', 'false');
  git(ctx, 'config', 'core.autocrlf', 'false');
  if (ignore) fs.writeFileSync(path.join(repo, '.gitignore'), '.dev-workflow/\n');
  fs.writeFileSync(path.join(repo, 'app.txt'), 'source\n');
  if (initialCommit) {
    git(ctx, 'add', '.');
    git(ctx, 'commit', '-q', '-m', 'initial');
  }
  return ctx;
}

export function git(ctx, ...args) {
  const result = spawnSync('git', ['-C', ctx.repo, ...args], { env: ctx.env, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

/** Run the helper. Pass { error: 'text' } or { raw: true } as the last argument. */
export function cli(ctx, command, ...args) {
  let expect = null;
  if (args.length > 0 && typeof args[args.length - 1] === 'object' && args[args.length - 1] !== null) expect = args.pop();
  const withTask = !['config', 'list'].includes(command) && !args.includes('--task');
  const argv = [SCRIPT, command, '--project', ctx.repo, ...(withTask ? ['--task', ctx.taskId] : []), ...args];
  const result = spawnSync(process.execPath, argv, { env: ctx.env, encoding: 'utf8' });
  assert.ok(!/\n\s+at /.test(result.stderr), `stack trace leaked: ${result.stderr}`);
  if (expect && expect.error !== undefined) {
    assert.notEqual(result.status, 0, `expected failure, got: ${result.stdout}`);
    assert.match(result.stderr, /^workflow: /, result.stderr);
    assert.ok(result.stderr.includes(expect.error), `expected "${expect.error}" in: ${result.stderr}`);
    if (expect.status !== undefined) assert.equal(result.status, expect.status);
    return result;
  }
  assert.equal(result.status, 0, result.stderr);
  if (expect && expect.raw) return result.stdout;
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}

export const taskPath = (ctx, ...parts) => path.join(ctx.repo, '.dev-workflow', 'tasks', ctx.taskId, ...parts);

export function writeSpec(ctx, text = '# Change behavior\nImplement the accepted behavior and focused checks.\n') {
  fs.writeFileSync(taskPath(ctx, 'spec.md'), text);
}

export function writeTasks(ctx, plan) {
  fs.writeFileSync(taskPath(ctx, 'tasks.json'), JSON.stringify(plan, null, 2));
}

export const defaultPlan = () => [{
  id: 'work', goal: 'Change application behavior', files: ['app.txt'], depends_on: [], contract: '',
  acceptance: ['Expected behavior works'], checks: ['node --test'],
}];

export function initialize(ctx, risk = null, extra = []) {
  const options = risk ? ['--risk', risk] : [];
  const state = cli(ctx, 'init', '--title', 'Change behavior', '--risk-reason', 'Assessed the affected behavior', ...options, ...extra);
  writeSpec(ctx);
  writeTasks(ctx, defaultPlan());
  return state;
}

export function approveFlag(risk) {
  return risk === 'low' ? '--authorized-by-request' : '--confirmed-by-user';
}

/** init + approve + task-done for the default single-item plan. */
export function prepareVerification(ctx, risk = 'standard', extra = []) {
  initialize(ctx, risk, extra);
  cli(ctx, 'approve', approveFlag(risk));
  cli(ctx, 'task-done', '--item', 'work');
}

export function report(risk, overrides = {}) {
  const assessments = {
    low: { orchestrator: { agent_id: 'orchestrator', result: 'pass', summary: 'Inspected the diff and checks.' } },
    standard: { reviewer: { agent_id: 'rev-1', result: 'pass', summary: 'Reviewed integrated code and docs.' } },
    high: {
      tester: { agent_id: 'test-1', result: 'pass', summary: 'Acceptance and negative paths verified.' },
      reviewer: { agent_id: 'rev-1', result: 'pass', summary: 'Reviewed integrated code and docs.' },
    },
  }[risk];
  return {
    implementer_ids: ['impl-1'],
    checks: [{ command: 'node --test', result: 'pass', exit_code: 0 }],
    assessments,
    documentation: 'Updated README.md for the new behavior.',
    blockers: [],
    ...overrides,
  };
}

export function writeReport(ctx, data) {
  fs.mkdirSync(taskPath(ctx, 'reports'), { recursive: true });
  fs.writeFileSync(taskPath(ctx, 'reports', 'verification.json'), JSON.stringify(data, null, 2));
  return 'reports/verification.json';
}

export function recordPass(ctx, risk, overrides = {}) {
  const status = cli(ctx, 'status');
  const file = writeReport(ctx, report(risk, overrides));
  return cli(ctx, 'record', '--kind', 'verification', '--result', 'pass', '--report', file, '--fingerprint', status.fingerprint);
}

export function writeConfig(ctx, data) {
  fs.mkdirSync(path.join(ctx.repo, '.dev-workflow'), { recursive: true });
  fs.writeFileSync(path.join(ctx.repo, '.dev-workflow', 'config.json'), JSON.stringify(data));
}
