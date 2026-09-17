// Exercise risk, authorization, evidence, repairs and delivery through the public CLI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  cli, git, makeRepo, initialize, prepareVerification, writeSpec, writeTasks, defaultPlan,
  report, writeReport, recordPass, writeConfig, taskPath,
} from './helpers.mjs';

test('config merges project overrides and reports effective models per risk', (t) => {
  const ctx = makeRepo(t);
  const base = cli(ctx, 'config');
  assert.equal(base.schema_version, 2);
  assert.equal(base.delivery, 'local');
  assert.equal(base.effective_models.reviewer.agent, 'reviewer');
  assert.equal(base.effective_models.implementer.model, 'opus');
  const high = cli(ctx, 'config', '--risk', 'high');
  assert.equal(high.effective_models.reviewer.agent, 'reviewer-high');
  assert.equal(high.effective_models.reviewer.model, 'fable');
  writeConfig(ctx, { repair_rounds: 3, models: { implementer: { agent: 'implementer', model: 'sonnet' } } });
  const merged = cli(ctx, 'config');
  assert.equal(merged.repair_rounds, 3);
  assert.equal(merged.effective_models.implementer.model, 'sonnet');
});

test('config rejects unknown fields, bad aliases and foreign schema versions', (t) => {
  const ctx = makeRepo(t);
  writeConfig(ctx, { max_agents: 2 });
  cli(ctx, 'config', { error: 'Unknown config field: max_agents' });
  writeConfig(ctx, { models: { reviewer: { agent: 'reviewer', model: 'gpt-5' } } });
  cli(ctx, 'config', { error: 'invalid model alias' });
  writeConfig(ctx, { delivery: 'email' });
  cli(ctx, 'config', { error: 'Invalid delivery mode' });
  writeConfig(ctx, { schema_version: 1 });
  cli(ctx, 'config', { error: 'Unsupported config version' });
});

test('init defaults to standard risk, writes the marker and reports ignore handling', (t) => {
  const ctx = makeRepo(t);
  const state = cli(ctx, 'init', '--title', 'Change behavior');
  assert.equal(state.schema_version, 3);
  assert.equal(state.stage, 'analysis');
  assert.equal(state.risk, 'standard');
  assert.equal(state.execution_mode, 'delegated');
  assert.equal(state.ignore, 'already-ignored');
  assert.equal(fs.readFileSync(path.join(ctx.repo, '.dev-workflow', 'active-task'), 'utf8').trim(), 'change');
  assert.ok(fs.existsSync(taskPath(ctx, 'spec.md')));
  assert.deepEqual(JSON.parse(fs.readFileSync(taskPath(ctx, 'tasks.json'), 'utf8')), []);
  cli(ctx, 'init', '--title', 'Again', { error: 'Task already exists' });
});

test('init adds .dev-workflow/ to .git/info/exclude when the repository does not ignore it', (t) => {
  const ctx = makeRepo(t, { ignore: false });
  const state = cli(ctx, 'init', '--title', 'Change behavior');
  assert.equal(state.ignore, 'added-to-git-info-exclude');
  const exclude = fs.readFileSync(path.join(ctx.repo, '.git', 'info', 'exclude'), 'utf8');
  assert.match(exclude, /^\.dev-workflow\/$/m);
  assert.equal(git(ctx, 'status', '--porcelain'), '');
});

test('init refuses a second active task until the first is done or aborted', (t) => {
  const ctx = makeRepo(t);
  cli(ctx, 'init', '--title', 'First');
  cli(ctx, 'init', '--task', 'second', '--title', 'Second', { error: 'Another task is active: change' });
  cli(ctx, 'abort', '--reason', 'Superseded');
  const second = cli(ctx, 'init', '--task', 'second', '--title', 'Second');
  assert.equal(second.task_id, 'second');
});

test('approve requires explicit confirmation unless low risk is authorized by request', (t) => {
  const ctx = makeRepo(t);
  initialize(ctx, 'standard');
  cli(ctx, 'approve', { error: 'Explicit user confirmation is required' });
  cli(ctx, 'approve', '--authorized-by-request', { error: 'Explicit user confirmation is required' });
  cli(ctx, 'approve', '--confirmed-by-user', '--authorized-by-request', { error: 'mutually exclusive' });
  const state = cli(ctx, 'approve', '--confirmed-by-user');
  assert.equal(state.stage, 'implementation');
  assert.equal(state.authorization, 'confirmed-by-user');
  const low = makeRepo(t);
  initialize(low, 'low');
  assert.equal(cli(low, 'approve', '--authorized-by-request').authorization, 'authorized-by-request');
});

test('approve requires a written specification and a risk rationale', (t) => {
  const ctx = makeRepo(t);
  cli(ctx, 'init', '--title', 'Change behavior');
  writeTasks(ctx, defaultPlan());
  cli(ctx, 'approve', '--confirmed-by-user', { error: 'nonempty --risk-reason' });
  cli(ctx, 'approve', '--confirmed-by-user', '--risk-reason', 'Assessed', { error: 'Write the specification' });
  writeSpec(ctx);
  writeTasks(ctx, []);
  cli(ctx, 'approve', '--confirmed-by-user', '--risk-reason', 'Assessed', { error: 'at least one implementation task' });
});

test('spec or config changes invalidate approval and block progress', (t) => {
  const ctx = makeRepo(t);
  initialize(ctx, 'standard');
  cli(ctx, 'approve', '--confirmed-by-user');
  assert.equal(cli(ctx, 'status').approval_current, true);
  writeSpec(ctx, '# Change behavior\nA different accepted scope that the user did not confirm.\n');
  assert.equal(cli(ctx, 'status').approval_current, false);
  cli(ctx, 'task-done', '--item', 'work', { error: 'reapprove' });
  cli(ctx, 'approve', '--confirmed-by-user');
  writeConfig(ctx, { repair_rounds: 3 });
  assert.equal(cli(ctx, 'status').approval_current, false);
  cli(ctx, 'advance', { error: 'reapprove' });
});

test('reapproval keeps the repair budget unless the plan itself changed', (t) => {
  const ctx = makeRepo(t);
  initialize(ctx, 'standard');
  cli(ctx, 'approve', '--confirmed-by-user');
  cli(ctx, 'retry', '--problem', 'flaky-test');
  assert.deepEqual(cli(ctx, 'approve', '--confirmed-by-user').attempts, { 'flaky-test': 1 });
  writeSpec(ctx, '# Change behavior\nRevised accepted scope with an additional acceptance scenario.\n');
  assert.deepEqual(cli(ctx, 'approve', '--confirmed-by-user').attempts, {});
});

test('risk reclassification needs a fresh rationale and confirmation once authorized', (t) => {
  const ctx = makeRepo(t);
  initialize(ctx, 'low');
  cli(ctx, 'approve', '--authorized-by-request');
  cli(ctx, 'approve', '--risk', 'high', '--confirmed-by-user', { error: 'fresh --risk-reason' });
  cli(ctx, 'approve', '--risk', 'high', '--risk-reason', 'Touches authorization', '--authorized-by-request', { error: 'explicit user confirmation' });
  const state = cli(ctx, 'approve', '--risk', 'high', '--risk-reason', 'Touches authorization', '--confirmed-by-user');
  assert.equal(state.risk, 'high');
  assert.deepEqual(cli(ctx, 'status').required_assessments, ['tester', 'reviewer']);
  assert.equal(cli(ctx, 'status').effective_models.reviewer.agent, 'reviewer-high');
});

test('direct-low is limited to low risk, a rationale and a single independent task', (t) => {
  const ctx = makeRepo(t);
  cli(ctx, 'init', '--title', 'Typo', '--execution-mode', 'direct-low', '--execution-reason', 'Text only', { error: 'direct-low requires low risk' });
  cli(ctx, 'init', '--title', 'Typo', '--risk', 'low', '--execution-mode', 'direct-low', { error: 'nonempty --execution-reason' });
  initialize(ctx, 'low', ['--execution-mode', 'direct-low', '--execution-reason', 'Unambiguous README wording fix']);
  writeTasks(ctx, [
    { ...defaultPlan()[0], id: 'a' },
    { ...defaultPlan()[0], id: 'b', files: ['docs/'] },
  ]);
  cli(ctx, 'approve', '--authorized-by-request', { error: 'one implementation task without dependencies' });
  writeTasks(ctx, defaultPlan());
  assert.equal(cli(ctx, 'approve', '--authorized-by-request').execution_mode, 'direct-low');
  cli(ctx, 'approve', '--authorized-by-request', '--execution-mode', 'delegated', { error: 'fresh --execution-reason' });
  const switched = cli(ctx, 'approve', '--authorized-by-request', '--execution-mode', 'delegated', '--execution-reason', 'Proved nontrivial');
  assert.equal(switched.execution_mode, 'delegated');
});

test('task-done enforces known items and completed dependencies', (t) => {
  const ctx = makeRepo(t);
  initialize(ctx, 'standard');
  writeTasks(ctx, [
    { ...defaultPlan()[0], id: 'contract', files: ['api/'] },
    { ...defaultPlan()[0], id: 'backend', files: ['internal/'], depends_on: ['contract'] },
  ]);
  cli(ctx, 'approve', '--confirmed-by-user');
  cli(ctx, 'task-done', '--item', 'missing', { error: 'Unknown implementation task' });
  cli(ctx, 'task-done', '--item', 'backend', { error: 'Dependencies are incomplete' });
  cli(ctx, 'task-done', '--item', 'contract');
  assert.deepEqual(cli(ctx, 'task-done', '--item', 'backend').completed_tasks, ['contract', 'backend']);
});

test('tasks.json rejects cycles, unordered overlapping scopes and unsafe file scopes', (t) => {
  const ctx = makeRepo(t);
  initialize(ctx, 'standard');
  writeTasks(ctx, [
    { ...defaultPlan()[0], id: 'a', depends_on: ['b'] },
    { ...defaultPlan()[0], id: 'b', files: ['docs/'], depends_on: ['a'] },
  ]);
  cli(ctx, 'approve', '--confirmed-by-user', { error: 'Cyclic dependencies' });
  writeTasks(ctx, [
    { ...defaultPlan()[0], id: 'a', files: ['src/'] },
    { ...defaultPlan()[0], id: 'b', files: ['src/main.go'] },
  ]);
  cli(ctx, 'approve', '--confirmed-by-user', { error: 'Overlapping scopes need ordered dependencies' });
  writeTasks(ctx, [{ ...defaultPlan()[0], files: ['../outside.txt'] }]);
  cli(ctx, 'approve', '--confirmed-by-user', { error: 'Invalid file scope' });
  writeTasks(ctx, [{ ...defaultPlan()[0], files: ['src/*.go'] }]);
  cli(ctx, 'approve', '--confirmed-by-user', { error: 'Invalid file scope' });
});

test('record rejects a stale fingerprint and requires every approved check verbatim', (t) => {
  const ctx = makeRepo(t);
  prepareVerification(ctx);
  const status = cli(ctx, 'status');
  const file = writeReport(ctx, report('standard'));
  cli(ctx, 'record', '--kind', 'verification', '--result', 'pass', '--report', file, '--fingerprint', 'deadbeef', { error: 'Code changed during checks' });
  writeReport(ctx, report('standard', { checks: [{ command: 'npm test', result: 'pass', exit_code: 0 }] }));
  cli(ctx, 'record', '--kind', 'verification', '--result', 'pass', '--report', file, '--fingerprint', status.fingerprint, { error: 'Missing required checks: node --test' });
  writeReport(ctx, report('standard'));
  const state = cli(ctx, 'record', '--kind', 'verification', '--result', 'pass', '--report', file, '--fingerprint', status.fingerprint);
  assert.equal(state.evidence.verification.result, 'pass');
  assert.equal(state.evidence.verification.report, 'reports/verification.json');
  assert.equal(cli(ctx, 'status').current_evidence.verification, true);
});

test('record enforces identity separation and required assessments per risk', (t) => {
  const standard = makeRepo(t);
  prepareVerification(standard, 'standard');
  let status = cli(standard, 'status');
  let file = writeReport(standard, report('standard', { assessments: { reviewer: { agent_id: 'impl-1', result: 'pass', summary: 'Self review.' } } }));
  cli(standard, 'record', '--kind', 'verification', '--result', 'pass', '--report', file, '--fingerprint', status.fingerprint, { error: 'reviewer must be distinct from implementers' });
  file = writeReport(standard, report('standard', { assessments: {} }));
  cli(standard, 'record', '--kind', 'verification', '--result', 'pass', '--report', file, '--fingerprint', status.fingerprint, { error: 'cannot support a passing result' });
  file = writeReport(standard, report('standard', { checks: [{ command: 'node --test', result: 'pass', exit_code: 1 }] }));
  cli(standard, 'record', '--kind', 'verification', '--result', 'pass', '--report', file, '--fingerprint', status.fingerprint, { error: 'Passing checks need exit_code 0' });

  const high = makeRepo(t);
  prepareVerification(high, 'high');
  status = cli(high, 'status');
  file = writeReport(high, report('high', { assessments: { ...report('high').assessments, tester: { agent_id: 'rev-1', result: 'pass', summary: 'Tested.' } } }));
  cli(high, 'record', '--kind', 'verification', '--result', 'pass', '--report', file, '--fingerprint', status.fingerprint, { error: 'tester and reviewer must be distinct' });
  file = writeReport(high, report('high', { assessments: { reviewer: report('high').assessments.reviewer } }));
  cli(high, 'record', '--kind', 'verification', '--result', 'pass', '--report', file, '--fingerprint', status.fingerprint, { error: 'cannot support a passing result' });
  recordPass(high, 'high');
  assert.equal(cli(high, 'status').current_evidence.verification, true);
});

test('direct-low verification needs the main session as sole implementer and assessor', (t) => {
  const ctx = makeRepo(t);
  prepareVerification(ctx, 'low', ['--execution-mode', 'direct-low', '--execution-reason', 'Text-only change']);
  const status = cli(ctx, 'status');
  let file = writeReport(ctx, report('low'));
  cli(ctx, 'record', '--kind', 'verification', '--result', 'pass', '--report', file, '--fingerprint', status.fingerprint, { error: 'direct-low orchestrator must be the implementer' });
  file = writeReport(ctx, report('low', { implementer_ids: ['orchestrator'] }));
  const state = cli(ctx, 'record', '--kind', 'verification', '--result', 'pass', '--report', file, '--fingerprint', status.fingerprint);
  assert.equal(state.evidence.verification.result, 'pass');
  const delegated = makeRepo(t);
  prepareVerification(delegated, 'low');
  const s2 = cli(delegated, 'status');
  file = writeReport(delegated, report('low', { implementer_ids: ['orchestrator'] }));
  cli(delegated, 'record', '--kind', 'verification', '--result', 'pass', '--report', file, '--fingerprint', s2.fingerprint, { error: 'orchestrator must be distinct from implementers' });
});

test('any project edit makes recorded evidence stale until re-recorded', (t) => {
  const ctx = makeRepo(t);
  prepareVerification(ctx);
  recordPass(ctx, 'standard');
  cli(ctx, 'advance');
  fs.writeFileSync(path.join(ctx.repo, 'README.md'), '# Docs\n');
  assert.equal(cli(ctx, 'status').current_evidence.verification, false);
  cli(ctx, 'advance', { error: 'stale verification evidence' });
  recordPass(ctx, 'standard');
  assert.equal(cli(ctx, 'advance').stage, 'delivery');
});

test('retry budget allows ordinary rounds, then a diagnosed attempt, then blocks', (t) => {
  const ctx = makeRepo(t);
  prepareVerification(ctx, 'high');
  assert.deepEqual(cli(ctx, 'retry', '--problem', 'auth-failure'), { attempt: 1, mode: 'ordinary' });
  assert.equal(cli(ctx, 'retry', '--problem', 'auth-failure').mode, 'ordinary');
  const third = cli(ctx, 'retry', '--problem', 'auth-failure');
  assert.equal(third.mode, 'diagnosis-required');
  assert.deepEqual(third.diagnosis, { agent: 'diagnosis', model: 'fable' });
  cli(ctx, 'retry', '--problem', 'auth-failure', { error: 'Repair budget exhausted' });
  assert.equal(cli(ctx, 'retry', '--problem', 'other').attempt, 1);
  cli(ctx, 'retry', '--problem', 'Bad Id', { error: 'lowercase letters' });
});

test('advance refuses incomplete implementation and missing evidence', (t) => {
  const ctx = makeRepo(t);
  initialize(ctx, 'standard');
  cli(ctx, 'advance', { error: 'approve the plan first' });
  cli(ctx, 'approve', '--confirmed-by-user');
  cli(ctx, 'advance', { error: 'Implementation tasks are incomplete' });
  cli(ctx, 'task-done', '--item', 'work');
  assert.equal(cli(ctx, 'advance').stage, 'verification');
  cli(ctx, 'advance', { error: 'Missing, failed or stale verification evidence' });
  const status = cli(ctx, 'status');
  const file = writeReport(ctx, report('standard', { blockers: ['Auth regression open'] }));
  cli(ctx, 'record', '--kind', 'verification', '--result', 'fail', '--report', file, '--fingerprint', status.fingerprint);
  cli(ctx, 'advance', { error: 'Missing, failed or stale verification evidence' });
});

test('local delivery requires the delivery stage, a HEAD commit and completes the task', (t) => {
  const ctx = makeRepo(t);
  prepareVerification(ctx);
  fs.writeFileSync(path.join(ctx.repo, 'app.txt'), 'implemented\n');
  cli(ctx, 'deliver', '--commit', 'abc', '--branch', 'feature/change', '--base', 'main', { error: 'Deliver only in the delivery stage' });
  recordPass(ctx, 'standard');
  cli(ctx, 'advance');
  cli(ctx, 'advance');
  cli(ctx, 'advance', { error: 'Run deliver before finishing' });
  git(ctx, 'switch', '-q', '-c', 'feature/change');
  git(ctx, 'add', 'app.txt');
  git(ctx, 'commit', '-q', '-m', 'Implement change');
  const head = git(ctx, 'rev-parse', 'HEAD');
  assert.equal(cli(ctx, 'status').current_evidence.verification, true, 'committing identical content keeps the fingerprint');
  cli(ctx, 'deliver', '--commit', 'abc', '--branch', 'feature/change', '--base', 'main', { error: 'Delivery commit must match HEAD' });
  const delivered = cli(ctx, 'deliver', '--commit', head, '--branch', 'feature/change', '--base', 'main');
  assert.equal(delivered.delivery.commit, head);
  assert.equal(delivered.delivery.pr_url, null);
  assert.ok(fs.existsSync(taskPath(ctx, 'delivery.json')));
  const done = cli(ctx, 'advance');
  assert.equal(done.stage, 'done');
  assert.ok(!fs.existsSync(path.join(ctx.repo, '.dev-workflow', 'active-task')));
  cli(ctx, 'advance', { error: 'already done' });
});

test('draft-pr delivery requires a verified GitHub pull request URL', (t) => {
  const ctx = makeRepo(t);
  writeConfig(ctx, { delivery: 'draft-pr' });
  prepareVerification(ctx);
  recordPass(ctx, 'standard');
  cli(ctx, 'advance');
  cli(ctx, 'advance');
  const head = git(ctx, 'rev-parse', 'HEAD');
  cli(ctx, 'deliver', '--commit', head, '--branch', 'feature/change', '--base', 'main', { error: 'verified draft PR URL' });
  cli(ctx, 'deliver', '--commit', head, '--branch', 'feature/change', '--base', 'main', '--pr-url', 'https://example.com/pr/1', { error: 'verified draft PR URL' });
  const delivered = cli(ctx, 'deliver', '--commit', head, '--branch', 'feature/change', '--base', 'main', '--pr-url', 'https://github.com/Jared0o/app/pull/12');
  assert.equal(delivered.delivery.pr_url, 'https://github.com/Jared0o/app/pull/12');
  assert.equal(cli(ctx, 'advance').stage, 'done');
});

test('abort records the reason, releases the marker and blocks further mutations', (t) => {
  const ctx = makeRepo(t);
  prepareVerification(ctx);
  cli(ctx, 'abort', { error: '--reason is required', status: 2 });
  const state = cli(ctx, 'abort', '--reason', 'Requirements changed');
  assert.equal(state.aborted.reason, 'Requirements changed');
  assert.ok(!fs.existsSync(path.join(ctx.repo, '.dev-workflow', 'active-task')));
  cli(ctx, 'task-done', '--item', 'work', { error: 'Task is aborted' });
  cli(ctx, 'approve', '--confirmed-by-user', { error: 'Task is aborted' });
  cli(ctx, 'abort', '--reason', 'Again', { error: 'already aborted' });
  assert.equal(cli(ctx, 'status').aborted.reason, 'Requirements changed');
});

test('list enumerates tasks with activity flags and supports brief text output', (t) => {
  const ctx = makeRepo(t);
  assert.deepEqual(cli(ctx, 'list'), []);
  assert.equal(cli(ctx, 'list', '--brief', { raw: true }), '');
  initialize(ctx, 'standard');
  cli(ctx, 'approve', '--confirmed-by-user');
  cli(ctx, 'abort', '--reason', 'Replaced');
  cli(ctx, 'init', '--task', 'second', '--title', 'Second task', '--risk', 'low');
  const items = cli(ctx, 'list');
  assert.equal(items.length, 2);
  const second = items.find((i) => i.task_id === 'second');
  assert.equal(second.active, true);
  assert.equal(items.find((i) => i.task_id === 'change').aborted, true);
  const brief = cli(ctx, 'list', '--brief', { raw: true });
  assert.match(brief, /^second\tanalysis\tlow\tdelegated\tactive$/m);
  assert.match(brief, /^change\timplementation\tstandard\tdelegated\taborted$/m);
  const outside = { ...ctx, repo: ctx.tmp };
  assert.equal(cli(outside, 'list', '--brief', { raw: true }), '');
});

test('status reports unknown tasks and refuses Codex-era state files', (t) => {
  const ctx = makeRepo(t);
  cli(ctx, 'status', { error: 'Unknown task: change' });
  fs.mkdirSync(taskPath(ctx), { recursive: true });
  fs.writeFileSync(taskPath(ctx, 'state.json'), JSON.stringify({ schema_version: 2, stage: 'analysis' }));
  cli(ctx, 'status', { error: 'Codex dev-agent-workflow plugin' });
  cli(ctx, 'bogus', { error: 'Unknown command' });
  cli(ctx, 'record', { error: '--kind is required', status: 2 });
  cli(ctx, 'status', '--risk', 'high', { error: 'Risk options are only supported' });
});

test('project paths inside the repository resolve to its root', (t) => {
  const ctx = makeRepo(t);
  fs.mkdirSync(path.join(ctx.repo, 'web'));
  fs.writeFileSync(path.join(ctx.repo, 'web', 'index.html'), '<html></html>\n');
  const nested = { ...ctx, repo: path.join(ctx.repo, 'web') };
  const state = cli(nested, 'init', '--title', 'Nested start');
  assert.ok(state.directory.replace(/\\/g, '/').endsWith('/application/.dev-workflow/tasks/change'));
  cli({ ...ctx, repo: ctx.tmp }, 'status', { error: 'must be inside a Git repository' });
});

test('symbolic links and nested repositories are handled in the fingerprint', { skip: process.platform === 'win32' ? 'symlinks need privileges on Windows' : false }, (t) => {
  const ctx = makeRepo(t);
  fs.symlinkSync('app.txt', path.join(ctx.repo, 'link.txt'));
  const first = cli(ctx, 'init', '--title', 'Links').baseline;
  fs.unlinkSync(path.join(ctx.repo, 'link.txt'));
  fs.symlinkSync('README.md', path.join(ctx.repo, 'link.txt'));
  assert.notEqual(cli(ctx, 'status').fingerprint, first);
  fs.mkdirSync(path.join(ctx.repo, 'nested'));
  git({ ...ctx, repo: path.join(ctx.repo, 'nested') }, 'init', '-q');
  fs.writeFileSync(path.join(ctx.repo, 'nested', 'x.txt'), 'x\n');
  cli(ctx, 'status', { error: 'separate workflows' });
});
