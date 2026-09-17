#!/usr/bin/env node
/**
 * dev-agent-workflow state helper.
 *
 * Local artifacts and gates for the orchestrator: task state, plan approval digests,
 * working-tree fingerprints, verification evidence, repair budget and delivery records
 * under <repo>/.dev-workflow/tasks/<task>/. It never calls a model and never executes
 * shell strings taken from task files or reports.
 *
 * Usage: node workflow.mjs <command> [--project <path inside repo>] [options]
 * Output: JSON on stdout. Errors: "workflow: <message>" on stderr, exit 1 (validation)
 * or exit 2 (usage). Only the orchestrator (main session) runs mutating commands.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STATE_SCHEMA = 3;
export const CONFIG_SCHEMA = 2;
export const STAGES = ['analysis', 'implementation', 'verification', 'delivery', 'done'];
export const ROLES = ['implementer', 'tester', 'reviewer', 'diagnosis'];
export const RISKS = ['low', 'standard', 'high'];
export const MODES = ['delegated', 'direct-low'];
export const MODEL_ALIASES = ['sonnet', 'opus', 'haiku', 'fable'];
export const COMMANDS = ['config', 'init', 'list', 'status', 'approve', 'task-done', 'record', 'retry', 'deliver', 'advance', 'abort'];
const ASSESSORS = ['orchestrator', 'tester', 'reviewer'];
const RESULTS = ['pass', 'fail', 'not-run'];
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PR_URL_RE = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/[0-9]+$/;
const MARKER = 'active-task';
const PLUGIN_NAME = 'dev-agent-workflow';

export class WorkflowError extends Error {}
export class UsageError extends Error {}

function check(condition, message) {
  if (!condition) throw new WorkflowError(message);
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const now = () => new Date().toISOString();

export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (isPlainObject(value)) {
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value === undefined ? null : value);
}

export const sha256 = (input) => crypto.createHash('sha256').update(input).digest('hex');

export function readJson(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new WorkflowError(`Cannot read ${path.basename(file)}: ${error.code || error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new WorkflowError(`Invalid JSON in ${path.basename(file)}: ${error.message}`);
  }
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let existing = null;
  try { existing = fs.lstatSync(file); } catch { /* new file */ }
  check(!existing || !existing.isSymbolicLink(), `Refusing symlink output: ${file}`);
  const temporary = path.join(path.dirname(file), `.workflow-${crypto.randomBytes(6).toString('hex')}`);
  try {
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', 'utf8');
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

export function identifier(value, label = 'ID') {
  check(typeof value === 'string' && ID_RE.test(value), `${label}s must be 1-64 lowercase letters, digits or hyphens`);
  return value;
}

export function git(root, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });
  if (result.error) throw new WorkflowError(`git is not available: ${result.error.message}`);
  if (result.status !== 0) {
    if (allowFailure) return null;
    throw new WorkflowError(result.stderr.toString('utf8').trim() || `git ${args[0]} failed`);
  }
  return result.stdout;
}

export function projectRoot(project) {
  const resolved = path.resolve(project);
  check(fs.existsSync(resolved), `Project path does not exist: ${resolved}`);
  const top = git(resolved, ['rev-parse', '--show-toplevel'], { allowFailure: true });
  check(top !== null, `--project must be inside a Git repository: ${resolved}`);
  return path.resolve(top.toString('utf8').trim());
}

/** Hash tracked + non-ignored untracked files (index modes, working-tree bytes), skipping .dev-workflow/. */
export function fingerprint(root) {
  const entries = new Map();
  for (const line of git(root, ['ls-files', '--cached', '-s', '-z']).toString('utf8').split('\0')) {
    if (!line) continue;
    const tab = line.indexOf('\t');
    const mode = line.slice(0, tab).split(' ')[0];
    entries.set(line.slice(tab + 1), mode);
  }
  for (const name of git(root, ['ls-files', '--others', '--exclude-standard', '-z']).toString('utf8').split('\0')) {
    if (name && !entries.has(name)) entries.set(name, null);
  }
  const digest = crypto.createHash('sha256');
  for (const name of [...entries.keys()].sort()) {
    if (name === '.dev-workflow' || name.startsWith('.dev-workflow/')) continue;
    const mode = entries.get(name);
    check(mode !== '160000', `Submodules need separate workflows: ${name}`);
    const file = path.join(root, ...name.split('/'));
    let stat;
    try { stat = fs.lstatSync(file); } catch { continue; }
    let content;
    if (stat.isSymbolicLink()) {
      content = Buffer.from('link:' + fs.readlinkSync(file));
    } else if (stat.isDirectory()) {
      throw new WorkflowError(`Submodules/nested Git directories need separate workflows: ${name}`);
    } else {
      const effectiveMode = mode ?? (process.platform !== 'win32' && (stat.mode & 0o111) ? '100755' : '100644');
      content = Buffer.concat([Buffer.from(effectiveMode + ':'), fs.readFileSync(file)]);
    }
    digest.update(name + '\0');
    digest.update(crypto.createHash('sha256').update(content).digest());
  }
  return digest.digest('hex');
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function merge(base, override, prefix = '') {
  check(isPlainObject(override), `Config override at ${prefix || 'root'} must be an object`);
  for (const [key, value] of Object.entries(override)) {
    check(Object.prototype.hasOwnProperty.call(base, key), `Unknown config field: ${prefix}${key}`);
    if (isPlainObject(base[key])) merge(base[key], value, `${prefix}${key}.`);
    else base[key] = value;
  }
  return base;
}

function validateRole(role, label) {
  check(isPlainObject(role) && sameSet(Object.keys(role), ['agent', 'model']), `${label} needs exactly agent and model`);
  check(typeof role.agent === 'string' && ID_RE.test(role.agent), `${label}: invalid agent name`);
  check(role.model === null || (typeof role.model === 'string' && MODEL_ALIASES.includes(role.model)),
    `${label}: invalid model alias (use ${MODEL_ALIASES.join('|')} or null)`);
}

export function validateConfig(data) {
  check(isPlainObject(data) && data.schema_version === CONFIG_SCHEMA, `Unsupported config version (expected ${CONFIG_SCHEMA})`);
  check(isPlainObject(data.models) && sameSet(Object.keys(data.models), ROLES), `Config models must define exactly: ${ROLES.join(', ')}`);
  for (const [role, value] of Object.entries(data.models)) validateRole(value, `models.${role}`);
  check(isPlainObject(data.risk_model_overrides) && sameSet(Object.keys(data.risk_model_overrides), ['high'])
    && isPlainObject(data.risk_model_overrides.high) && sameSet(Object.keys(data.risk_model_overrides.high), ['reviewer']),
  'Risk model overrides support only the high-risk reviewer');
  validateRole(data.risk_model_overrides.high.reviewer, 'risk_model_overrides.high.reviewer');
  for (const key of ['max_parallel_agents', 'repair_rounds', 'escalated_attempts']) {
    check(Number.isInteger(data[key]) && data[key] >= 1 && data[key] <= 8, `Invalid ${key} (integer 1-8)`);
  }
  check(data.communication_language === 'pl' && data.working_language === 'en',
    'This version supports Polish communication and English working materials');
  check(['local', 'draft-pr'].includes(data.delivery), 'Invalid delivery mode (local|draft-pr)');
  return data;
}

export function loadConfig(root) {
  const data = readJson(path.join(PLUGIN_ROOT, 'config', 'defaults.json'));
  const override = path.join(root, '.dev-workflow', 'config.json');
  if (fs.existsSync(override)) merge(data, readJson(override));
  return validateConfig(data);
}

export function roleModels(settings, risk) {
  return { ...settings.models, ...(settings.risk_model_overrides[risk] ?? {}) };
}

// ---------------------------------------------------------------------------
// Task directory, marker, plan
// ---------------------------------------------------------------------------

export function taskDir(root, task) {
  return path.join(root, '.dev-workflow', 'tasks', identifier(task, 'Task ID'));
}

const markerPath = (root) => path.join(root, '.dev-workflow', MARKER);

export function readMarker(root) {
  try {
    const value = fs.readFileSync(markerPath(root), 'utf8').trim();
    return value || null;
  } catch {
    return null;
  }
}

function writeMarker(root, task) {
  fs.mkdirSync(path.dirname(markerPath(root)), { recursive: true });
  fs.writeFileSync(markerPath(root), task + '\n', 'utf8');
}

function clearMarker(root, task) {
  if (readMarker(root) === task) fs.unlinkSync(markerPath(root));
}

function activeTaskConflict(root, task) {
  const marker = readMarker(root);
  if (!marker || marker === task) return null;
  try {
    const other = loadState(taskDir(root, marker));
    if (other.stage === 'done' || other.aborted) return null;
    return marker;
  } catch {
    return null; // stale marker for a missing or unreadable task
  }
}

function textList(value, label, { nonempty = true } = {}) {
  check(Array.isArray(value) && (value.length > 0 || !nonempty) && value.every(isNonEmptyString), `Invalid ${label}`);
}

export function tasks(directory) {
  const plan = readJson(path.join(directory, 'tasks.json'));
  check(Array.isArray(plan) && plan.length > 0, 'Provide at least one implementation task in tasks.json');
  const fields = ['id', 'goal', 'files', 'depends_on', 'contract', 'acceptance', 'checks'];
  const ids = new Set();
  for (const task of plan) {
    check(isPlainObject(task) && sameSet(Object.keys(task), fields), `Task fields: ${fields.join(', ')}`);
    identifier(task.id, 'Task item ID');
    check(!ids.has(task.id), `Duplicate task ID: ${task.id}`);
    ids.add(task.id);
    check(isNonEmptyString(task.goal), `Missing goal for task ${task.id}`);
    check(typeof task.contract === 'string', `Contract must be a string for task ${task.id}`);
    for (const field of ['files', 'acceptance', 'checks']) textList(task[field], `${field} for task ${task.id}`);
    textList(task.depends_on, `depends_on for task ${task.id}`, { nonempty: false });
    for (const name of task.files) {
      const parts = name.replace(/\/$/, '').split('/');
      check(!parts.some((p) => ['', '.', '..', '.git', '.dev-workflow'].includes(p)) && !/[\\*?[\]]/.test(name),
        `Invalid file scope in task ${task.id}: ${name}`);
    }
  }
  const graph = new Map(plan.map((t) => [t.id, new Set(t.depends_on)]));
  for (const [id, deps] of graph) for (const dep of deps) check(ids.has(dep), `Unknown dependency ${dep} in task ${id}`);
  const ancestors = new Map();
  const visit = (node, pending) => {
    check(!pending.has(node), 'Cyclic dependencies in tasks.json');
    if (!ancestors.has(node)) {
      const result = new Set(graph.get(node));
      for (const dep of graph.get(node)) for (const a of visit(dep, new Set([...pending, node]))) result.add(a);
      ancestors.set(node, result);
    }
    return ancestors.get(node);
  };
  for (const node of graph.keys()) visit(node, new Set());
  const overlaps = (a, b) => a.replace(/\/$/, '') === b.replace(/\/$/, '')
    || (a.endsWith('/') && b.startsWith(a)) || (b.endsWith('/') && a.startsWith(b));
  for (let i = 0; i < plan.length; i++) {
    for (const right of plan.slice(i + 1)) {
      const left = plan[i];
      const overlap = left.files.some((a) => right.files.some((b) => overlaps(a, b)));
      check(!overlap || ancestors.get(right.id).has(left.id) || ancestors.get(left.id).has(right.id),
        `Overlapping scopes need ordered dependencies: ${left.id}, ${right.id}`);
    }
  }
  return plan;
}

export function planDigest(root, directory) {
  let spec;
  try {
    spec = fs.readFileSync(path.join(directory, 'spec.md'), 'utf8');
  } catch {
    throw new WorkflowError('Missing spec.md in the task directory');
  }
  check(spec.trim().length >= 20, 'Write the specification (spec.md) before approval');
  return sha256(canonical({ spec, tasks: tasks(directory), config: loadConfig(root) }));
}

export function validateExecution(risk, mode, reason, directory = null) {
  check(typeof mode === 'string' && MODES.includes(mode), `Invalid execution mode (${MODES.join('|')})`);
  check(reason === null || reason === undefined || typeof reason === 'string', 'Invalid execution reason');
  if (mode === 'direct-low') {
    check(risk === 'low', 'direct-low requires low risk');
    check(isNonEmptyString(reason), 'direct-low requires a nonempty --execution-reason');
    if (directory !== null) {
      const plan = tasks(directory);
      check(plan.length === 1 && plan[0].depends_on.length === 0, 'direct-low requires one implementation task without dependencies');
    }
  }
}

export function approvalDigest(root, directory, { risk, risk_reason, execution_mode, execution_reason }) {
  check(RISKS.includes(risk), `Invalid risk (${RISKS.join('|')})`);
  check(isNonEmptyString(risk_reason), 'A nonempty --risk-reason is required for approval');
  validateExecution(risk, execution_mode, execution_reason, directory);
  return sha256(canonical({
    plan: planDigest(root, directory), risk, risk_reason, execution_mode, execution_reason: execution_reason ?? null,
  }));
}

// ---------------------------------------------------------------------------
// State and evidence
// ---------------------------------------------------------------------------

export function loadState(directory) {
  const file = path.join(directory, 'state.json');
  check(fs.existsSync(file), `Unknown task: ${path.basename(directory)} (use list)`);
  const state = readJson(file);
  check(isPlainObject(state), 'Invalid task state');
  if (state.schema_version === 1 || state.schema_version === 2) {
    throw new WorkflowError(`Task state schema_version ${state.schema_version} was created by the Codex dev-agent-workflow plugin; this plugin handles schema_version ${STATE_SCHEMA} only`);
  }
  check(state.schema_version === STATE_SCHEMA && STAGES.includes(state.stage), 'Invalid or unsupported task state');
  check(Array.isArray(state.completed_tasks) && isPlainObject(state.evidence) && isPlainObject(state.attempts), 'Invalid state collections');
  check(RISKS.includes(state.risk) && (state.risk_reason === null || typeof state.risk_reason === 'string'), 'Invalid risk state');
  validateExecution(state.risk, state.execution_mode, state.execution_reason);
  check(state.aborted === null || state.aborted === undefined || isPlainObject(state.aborted), 'Invalid aborted state');
  return state;
}

export function approved(root, directory, state) {
  return state.approval !== null && state.approval === approvalDigest(root, directory, state);
}

function reportFile(directory, name) {
  check(isNonEmptyString(name), 'Report path is required');
  const file = path.resolve(directory, name);
  const relative = path.relative(path.resolve(directory), file);
  check(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Evidence must be inside the task directory');
  check(fs.existsSync(file) && fs.statSync(file).isFile(), 'Evidence must be an existing file inside the task directory');
  check(!['state.json', 'spec.md', 'tasks.json', 'delivery.json'].includes(path.basename(file)), 'Use a separate evidence report');
  check(fs.statSync(file).size > 0, 'Empty evidence report');
  return file;
}

export function evidenceValid(directory, state, current) {
  const item = state.evidence.verification;
  if (!isPlainObject(item) || item.result !== 'pass' || item.fingerprint !== current) return false;
  try {
    const report = reportFile(directory, item.report);
    return sha256(fs.readFileSync(report)) === item.report_hash;
  } catch {
    return false;
  }
}

export const requiredRoles = (risk) => ({ low: ['orchestrator'], standard: ['reviewer'], high: ['tester', 'reviewer'] })[risk];

export function verificationResult(data, risk, executionMode = 'delegated') {
  check(MODES.includes(executionMode), 'Invalid execution mode');
  check(executionMode !== 'direct-low' || risk === 'low', 'direct-low requires low risk');
  check(isPlainObject(data), 'Verification report must be a JSON object');
  const implementers = data.implementer_ids;
  textList(implementers, 'implementer_ids');
  check(new Set(implementers).size === implementers.length, 'implementer_ids must be unique');
  check(Array.isArray(data.checks) && data.checks.length > 0, 'checks must be a nonempty list');
  const outcomes = [];
  for (const item of data.checks) {
    check(isPlainObject(item) && sameSet(Object.keys(item), ['command', 'result', 'exit_code'])
      && isNonEmptyString(item.command) && RESULTS.includes(item.result)
      && (Number.isInteger(item.exit_code) || item.exit_code === null), 'Invalid verification check (command, result, exit_code)');
    if (item.result === 'pass') check(item.exit_code === 0, `Passing checks need exit_code 0: ${item.command}`);
    if (item.result === 'not-run') check(item.exit_code === null, `not-run checks need a null exit_code: ${item.command}`);
    outcomes.push(item.result);
  }
  check(isPlainObject(data.assessments), 'assessments must be an object');
  for (const [role, assessment] of Object.entries(data.assessments)) {
    check(ASSESSORS.includes(role) && isPlainObject(assessment) && sameSet(Object.keys(assessment), ['agent_id', 'result', 'summary'])
      && isNonEmptyString(assessment.agent_id) && RESULTS.includes(assessment.result) && isNonEmptyString(assessment.summary),
    `Invalid verification assessment: ${role}`);
    outcomes.push(assessment.result);
  }
  check(isNonEmptyString(data.documentation), 'documentation must be a nonempty string (changed docs or why none are needed)');
  textList(data.blockers, 'blockers', { nonempty: false });
  const roles = requiredRoles(risk);
  const missing = roles.filter((role) => !(role in data.assessments));
  if (missing.length > 0) outcomes.push('not-run');
  if (executionMode === 'direct-low') {
    check(implementers.length === 1, 'direct-low requires exactly one implementer');
    if (data.assessments.orchestrator) {
      check(data.assessments.orchestrator.agent_id === implementers[0], 'direct-low orchestrator must be the implementer');
    }
  } else {
    for (const role of roles) {
      if (data.assessments[role]) check(!implementers.includes(data.assessments[role].agent_id), `${role} must be distinct from implementers`);
    }
  }
  if (risk === 'high' && missing.length === 0) {
    check(data.assessments.tester.agent_id !== data.assessments.reviewer.agent_id, 'tester and reviewer must be distinct');
  }
  if (data.blockers.length > 0 || outcomes.includes('fail')) return 'fail';
  return outcomes.includes('not-run') ? 'not-run' : 'pass';
}

function ensureExcluded(root) {
  fs.mkdirSync(path.join(root, '.dev-workflow'), { recursive: true });
  const ignored = spawnSync('git', ['-C', root, 'check-ignore', '-q', '.dev-workflow'], { encoding: 'utf8' });
  if (ignored.status === 0) return 'already-ignored';
  try {
    const relative = git(root, ['rev-parse', '--git-path', 'info/exclude']).toString('utf8').trim();
    const exclude = path.resolve(root, relative);
    fs.mkdirSync(path.dirname(exclude), { recursive: true });
    const existing = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
    if (!existing.split(/\r?\n/).some((line) => ['.dev-workflow/', '.dev-workflow'].includes(line.trim()))) {
      fs.appendFileSync(exclude, (existing && !existing.endsWith('\n') ? '\n' : '') + '.dev-workflow/\n', 'utf8');
    }
    return 'added-to-git-info-exclude';
  } catch (error) {
    return `not-ignored: add .dev-workflow/ to .gitignore manually (${error.message})`;
  }
}

function summary(root, task, marker) {
  try {
    const state = loadState(taskDir(root, task));
    return {
      task_id: state.task_id, title: state.title, stage: state.stage, risk: state.risk,
      execution_mode: state.execution_mode, updated_at: state.updated_at ?? null,
      active: marker === task && state.stage !== 'done' && !state.aborted, aborted: Boolean(state.aborted),
    };
  } catch (error) {
    return { task_id: task, error: error.message };
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function listTasks(project, brief) {
  let root;
  try {
    root = projectRoot(project);
  } catch {
    return brief ? '' : [];
  }
  const base = path.join(root, '.dev-workflow', 'tasks');
  if (!fs.existsSync(base)) return brief ? '' : [];
  const marker = readMarker(root);
  const items = fs.readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(base, entry.name, 'state.json')))
    .map((entry) => summary(root, entry.name, marker))
    .sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')));
  if (!brief) return items;
  return items.map((item) => item.error
    ? `${item.task_id}\tunreadable\t${item.error}`
    : `${item.task_id}\t${item.stage}\t${item.risk}\t${item.execution_mode}${item.active ? '\tactive' : ''}${item.aborted ? '\taborted' : ''}`)
    .join('\n');
}

export function run(command, o) {
  check(COMMANDS.includes(command), `Unknown command: ${command}`);
  const project = o.project ?? process.cwd();
  if (command === 'list') return listTasks(project, Boolean(o.brief));
  const root = projectRoot(project);
  if (command === 'config') {
    const risk = o.risk ?? 'standard';
    check(RISKS.includes(risk), `Invalid risk (${RISKS.join('|')})`);
    const settings = loadConfig(root);
    return { ...settings, effective_models: roleModels(settings, risk) };
  }
  check(isNonEmptyString(o.task), `--task is required for ${command}`);
  const directory = taskDir(root, o.task);
  const statePath = path.join(directory, 'state.json');

  if (command === 'init') {
    check(isNonEmptyString(o.title), '--title is required for init');
    const risk = o.risk ?? 'standard';
    check(RISKS.includes(risk), `Invalid risk (${RISKS.join('|')})`);
    const mode = o['execution-mode'] ?? 'delegated';
    validateExecution(risk, mode, o['execution-reason'] ?? null);
    check(!fs.existsSync(directory), 'Task already exists; use status or resume');
    const conflict = activeTaskConflict(root, o.task);
    check(conflict === null, `Another task is active: ${conflict}; finish or abort it first`);
    const timestamp = now();
    const state = {
      schema_version: STATE_SCHEMA, plugin: PLUGIN_NAME, task_id: o.task, title: o.title,
      stage: 'analysis', risk, risk_reason: o['risk-reason'] ?? null,
      execution_mode: mode, execution_reason: o['execution-reason'] ?? null,
      approval: null, plan_digest: null, authorization: null,
      completed_tasks: [], evidence: {}, attempts: {}, baseline: fingerprint(root), aborted: null,
      created_at: timestamp, updated_at: timestamp,
    };
    writeJson(statePath, state);
    writeJson(path.join(directory, 'tasks.json'), []);
    fs.writeFileSync(path.join(directory, 'spec.md'), `# ${o.title}\n`, 'utf8');
    writeMarker(root, o.task);
    return { directory, ignore: ensureExcluded(root), ...state };
  }

  const state = loadState(directory);
  const current = fingerprint(root);
  const settings = loadConfig(root);

  if (command === 'status') {
    let valid = false;
    let issue = null;
    try {
      valid = approved(root, directory, state);
    } catch (error) {
      issue = error.message;
    }
    return {
      ...state, fingerprint: current, approval_current: valid, plan_issue: issue,
      current_evidence: { verification: evidenceValid(directory, state, current) },
      required_assessments: requiredRoles(state.risk), effective_models: roleModels(settings, state.risk),
      active: readMarker(root) === o.task, delivery: settings.delivery,
    };
  }

  if (command === 'abort') {
    check(isNonEmptyString(o.reason), '--reason is required for abort');
    check(!state.aborted, 'Task is already aborted');
    state.aborted = { reason: o.reason, at: now() };
    state.updated_at = now();
    writeJson(statePath, state);
    clearMarker(root, o.task);
    return state;
  }

  check(!state.aborted, 'Task is aborted; start a new task');

  if (command === 'approve') {
    check(!(o['confirmed-by-user'] && o['authorized-by-request']), 'Approval flags are mutually exclusive');
    const risk = o.risk ?? state.risk;
    const reason = o['risk-reason'] ?? state.risk_reason;
    const mode = o['execution-mode'] ?? state.execution_mode;
    const executionReason = o['execution-reason'] ?? state.execution_reason;
    if (o['execution-mode'] !== undefined && mode !== state.execution_mode) {
      check(isNonEmptyString(o['execution-reason']), 'Execution mode changes require a fresh --execution-reason');
    }
    if (risk !== state.risk) {
      check(isNonEmptyString(o['risk-reason']), 'Risk changes require a fresh --risk-reason');
      check(state.approval === null || o['confirmed-by-user'], 'Reclassifying an authorized task requires explicit user confirmation');
    }
    check(o['confirmed-by-user'] || (risk === 'low' && o['authorized-by-request']),
      'Explicit user confirmation is required unless low risk is authorized by request');
    const conflict = activeTaskConflict(root, o.task);
    check(conflict === null, `Another task is active: ${conflict}; finish or abort it first`);
    const approval = approvalDigest(root, directory, { risk, risk_reason: reason, execution_mode: mode, execution_reason: executionReason ?? null });
    const plan = planDigest(root, directory);
    const executionChanged = mode !== state.execution_mode || (executionReason ?? null) !== (state.execution_reason ?? null);
    const attempts = executionChanged || state.plan_digest === plan ? state.attempts : {};
    Object.assign(state, {
      risk, risk_reason: reason, execution_mode: mode, execution_reason: executionReason ?? null,
      plan_digest: plan, approval, stage: 'implementation', completed_tasks: [], evidence: {}, attempts,
      authorization: o['confirmed-by-user'] ? 'confirmed-by-user' : 'authorized-by-request', updated_at: now(),
    });
    writeJson(statePath, state);
    writeMarker(root, o.task);
    return state;
  }

  if (command === 'advance') check(state.stage !== 'analysis', 'Cannot advance from analysis; approve the plan first');
  check(approved(root, directory, state), 'Plan/config changed or is unapproved; reapprove');

  if (command === 'task-done') {
    const plan = new Map(tasks(directory).map((t) => [t.id, t]));
    check(plan.has(o.item), `Unknown implementation task: ${o.item}`);
    check(plan.get(o.item).depends_on.every((dep) => state.completed_tasks.includes(dep)), 'Dependencies are incomplete');
    if (!state.completed_tasks.includes(o.item)) state.completed_tasks.push(o.item);
  } else if (command === 'record') {
    check(o.kind === 'verification', 'Only --kind verification is supported');
    check(RESULTS.includes(o.result), `Invalid --result (${RESULTS.join('|')})`);
    check(o.fingerprint === current, 'Code changed during checks; inspect and rerun affected checks');
    const report = reportFile(directory, o.report);
    const data = readJson(report);
    check(isPlainObject(data), 'Verification report must be a JSON object');
    if (o.result === 'pass') {
      check(verificationResult(data, state.risk, state.execution_mode) === 'pass', 'Verification report cannot support a passing result');
      const required = new Set(tasks(directory).flatMap((t) => t.checks));
      const recorded = new Set(data.checks.map((c) => c.command));
      const missing = [...required].filter((c) => !recorded.has(c)).sort();
      check(missing.length === 0, `Missing required checks: ${missing.join(', ')}`);
    }
    state.evidence.verification = {
      result: o.result, fingerprint: current,
      report: path.relative(directory, report).split(path.sep).join('/'), report_hash: sha256(fs.readFileSync(report)),
    };
  } else if (command === 'retry') {
    const problem = identifier(o.problem, 'Problem ID');
    const count = (state.attempts[problem] ?? 0) + 1;
    check(count <= settings.repair_rounds + settings.escalated_attempts, 'Repair budget exhausted; report the blocker to the user');
    state.attempts[problem] = count;
    state.updated_at = now();
    writeJson(statePath, state);
    const result = { attempt: count, mode: count <= settings.repair_rounds ? 'ordinary' : 'diagnosis-required' };
    if (count > settings.repair_rounds) result.diagnosis = roleModels(settings, state.risk).diagnosis;
    return result;
  } else if (command === 'deliver') {
    check(state.stage === 'delivery', 'Deliver only in the delivery stage; run advance first');
    check(evidenceValid(directory, state, current), 'Missing, failed or stale verification evidence');
    for (const key of ['commit', 'branch', 'base']) check(isNonEmptyString(o[key]), `--${key} is required for deliver`);
    const head = git(root, ['rev-parse', 'HEAD']).toString('utf8').trim();
    check(o.commit === head, 'Delivery commit must match HEAD');
    const prUrl = o['pr-url'] ?? null;
    if (settings.delivery === 'draft-pr') check(prUrl !== null && PR_URL_RE.test(prUrl), 'Record the verified draft PR URL');
    else if (prUrl !== null) check(PR_URL_RE.test(prUrl), 'Invalid PR URL');
    const delivery = { fingerprint: current, commit: head, branch: o.branch, base: o.base, pr_url: prUrl, delivered_at: now() };
    writeJson(path.join(directory, 'delivery.json'), delivery);
    state.updated_at = now();
    writeJson(statePath, state);
    return { ...state, delivery };
  } else if (command === 'advance') {
    const stage = state.stage;
    check(stage !== 'analysis', 'Cannot advance from analysis; approve the plan first');
    check(stage !== 'done', 'Task is already done');
    check(tasks(directory).every((t) => state.completed_tasks.includes(t.id)), 'Implementation tasks are incomplete');
    if (stage === 'verification' || stage === 'delivery') {
      check(evidenceValid(directory, state, current), 'Missing, failed or stale verification evidence');
    }
    if (stage === 'delivery') {
      const file = path.join(directory, 'delivery.json');
      check(fs.existsSync(file), 'Run deliver before finishing the delivery stage');
      const delivered = readJson(file);
      check(delivered.fingerprint === current, 'Stale delivery record');
      if (settings.delivery === 'draft-pr') check(typeof delivered.pr_url === 'string' && PR_URL_RE.test(delivered.pr_url), 'Record the verified draft PR URL');
      check(delivered.commit === git(root, ['rev-parse', 'HEAD']).toString('utf8').trim(), 'Delivery commit must match HEAD');
    }
    state.stage = STAGES[STAGES.indexOf(stage) + 1];
    if (state.stage === 'done') clearMarker(root, o.task);
  }
  state.updated_at = now();
  writeJson(statePath, state);
  return state;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const OPTIONS = {
  project: { type: 'string' }, task: { type: 'string' }, title: { type: 'string' }, risk: { type: 'string' },
  'risk-reason': { type: 'string' }, 'execution-mode': { type: 'string' }, 'execution-reason': { type: 'string' },
  'confirmed-by-user': { type: 'boolean' }, 'authorized-by-request': { type: 'boolean' },
  item: { type: 'string' }, kind: { type: 'string' }, result: { type: 'string' }, report: { type: 'string' },
  fingerprint: { type: 'string' }, problem: { type: 'string' }, commit: { type: 'string' }, branch: { type: 'string' },
  base: { type: 'string' }, 'pr-url': { type: 'string' }, reason: { type: 'string' }, brief: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

const REQUIRED = {
  config: [], list: [], init: ['task', 'title'], status: ['task'], approve: ['task'], 'task-done': ['task', 'item'],
  record: ['task', 'kind', 'result', 'report', 'fingerprint'], retry: ['task', 'problem'],
  deliver: ['task', 'commit', 'branch', 'base'], advance: ['task'], abort: ['task', 'reason'],
};

const USAGE = `Usage: node workflow.mjs <command> [--project <path>] [options]

Commands:
  config    [--risk <risk>]                    effective configuration and helper models
  list      [--brief]                          tasks in this repository (brief: one line per task)
  init      --task <id> --title <text> [--risk low|standard|high] [--risk-reason <text>]
            [--execution-mode delegated|direct-low] [--execution-reason <text>]
  status    --task <id>
  approve   --task <id> (--confirmed-by-user | --authorized-by-request)
            [--risk <risk> --risk-reason <text>] [--execution-mode <mode> --execution-reason <text>]
  task-done --task <id> --item <task-item-id>
  record    --task <id> --kind verification --result pass|fail|not-run --report <relative path> --fingerprint <hex>
  retry     --task <id> --problem <stable-problem-id>
  deliver   --task <id> --commit <sha> --branch <name> --base <name> [--pr-url <url>]
  advance   --task <id>
  abort     --task <id> --reason <text>
`;

export function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    process.stderr.write(`workflow: ${error.message}\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help || positionals.length === 0) {
    process.stdout.write(USAGE);
    return values.help ? 0 : 2;
  }
  const command = positionals[0];
  try {
    check(COMMANDS.includes(command) && positionals.length === 1, `Unknown command: ${positionals.join(' ')}`);
    for (const name of REQUIRED[command]) {
      if (values[name] === undefined || values[name] === '') throw new UsageError(`--${name} is required for ${command}`);
    }
    if (!['init', 'approve'].includes(command)) {
      check(values['execution-mode'] === undefined && values['execution-reason'] === undefined, 'Execution options are only supported by init and approve');
    }
    if (!['config', 'init', 'approve'].includes(command)) {
      check(values.risk === undefined && values['risk-reason'] === undefined, 'Risk options are only supported by config, init and approve');
    }
    const result = run(command, values);
    process.stdout.write(typeof result === 'string' ? (result ? result + '\n' : '') : JSON.stringify(result, null, 2) + '\n');
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`workflow: ${error.message}\n${USAGE}`);
      return 2;
    }
    process.stderr.write(`workflow: ${error.message}\n`);
    return 1;
  }
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
const self = fileURLToPath(import.meta.url);
const isMain = process.platform === 'win32' ? invoked.toLowerCase() === self.toLowerCase() : invoked === self;
if (isMain) process.exit(main());
