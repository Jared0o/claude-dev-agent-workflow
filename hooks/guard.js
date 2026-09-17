#!/usr/bin/env node
// dev-agent-workflow PreToolUse hook (matchers: Bash and Edit|Write|MultiEdit|NotebookEdit).
//
// While a task is active in this repository (.dev-workflow/active-task exists), SUBAGENTS
// may not: run Git commands that write or switch state (commit, push, add, stash, checkout,
// reset, ...), call mutating helper commands (workflow.mjs init|approve|...), or write under
// .dev-workflow/ except tasks/<task>/logs/. The main session (orchestrator) is unrestricted:
// Claude Code puts agent_id/agent_type into hook input only inside subagents.
//
// Exit 2 blocks the tool call and returns stderr to the model; exit 0 lets it run.
// The hook fails open only when stdin is not JSON.
'use strict';
const fs = require('fs');
const path = require('path');

const HELPER_MUTATION = /workflow\.mjs["']?\s+(init|approve|task-done|record|retry|advance|deliver|abort)\b/;
const DEV_PATH = /\.dev-workflow[\\/](?!tasks[\\/][^\\/\s"']+[\\/]logs[\\/])/;
const DESTRUCTIVE_FILE_TOOLS = /(^|\s)(rm|mv|cp|tee|truncate|sed|install|dd|shred|unlink)(\s|$)/;
const READ_ONLY_GIT = new Set([
  'status', 'diff', 'log', 'show', 'blame', 'ls-files', 'ls-tree', 'ls-remote', 'rev-parse', 'grep', 'describe',
  'shortlog', 'cat-file', 'rev-list', 'name-rev', 'for-each-ref', 'show-ref', 'merge-base', 'diff-tree', 'diff-index',
  'diff-files', 'count-objects', 'check-ignore', 'check-attr', 'var', 'version', 'help', 'whatchanged', 'range-diff',
]);
const GLOBAL_WITH_ARG = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env']);
const GLOBAL_FLAG = /^(-C\S+|-c\S+|--git-dir=.*|--work-tree=.*|--namespace=.*|--exec-path=.*|--config-env=.*|--no-pager|-p|--paginate|--no-optional-locks|--bare|--literal-pathspecs|--glob-pathspecs|--no-replace-objects)$/;
const BRANCH_LIST_FLAG = /^(--list|-a|-r|-v|-vv|--all|--remotes|--verbose|--show-current|--no-color|--color(=\S+)?|--column|--no-column|--format=\S+|--sort=\S+|--contains=\S+|--no-contains=\S+|--merged=\S+|--no-merged=\S+|--points-at=\S+)$/;
const RUNNER_PREFIX = new Set(['env', 'sudo', 'command', 'exec', 'time', 'nice', 'nohup']);

function tokenize(segment) {
  return segment.trim().split(/\s+/).filter(Boolean).map((t) => t.replace(/^["']|["']$/g, ''));
}

function isGitToken(token) {
  return /(^|[\\/])git(\.exe)?$/i.test(token);
}

/** Returns the index of the git executable when git is the command of this segment, else -1. */
function findGit(tokens) {
  let i = 0;
  while (i < tokens.length && (RUNNER_PREFIX.has(tokens[i]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]))) i += 1;
  return i < tokens.length && isGitToken(tokens[i]) ? i : -1;
}

/** Returns a reason when a git invocation writes or switches state; null for read-only use. */
function gitVerdict(tokens) {
  let i = 0;
  while (i < tokens.length) {
    if (GLOBAL_WITH_ARG.has(tokens[i])) { i += 2; continue; }
    if (GLOBAL_FLAG.test(tokens[i])) { i += 1; continue; }
    break;
  }
  const sub = tokens[i];
  const args = tokens.slice(i + 1);
  if (!sub || sub.startsWith('--')) return null; // git --version, git --help
  if (READ_ONLY_GIT.has(sub)) return null;
  const positionals = args.filter((a) => !a.startsWith('-'));
  switch (sub) {
    case 'branch':
      return args.every((a) => BRANCH_LIST_FLAG.test(a)) ? null : 'git branch may only list branches';
    case 'remote':
      return args.length === 0 || ['-v', '--verbose', 'show', 'get-url'].includes(args[0]) ? null : 'git remote changes are reserved for the orchestrator';
    case 'config':
      return args.some((a) => ['--get', '--get-all', '--get-regexp', '--list', '-l', '--show-origin'].includes(a)) || args.length === 1
        ? null : 'git config writes are reserved for the orchestrator';
    case 'worktree':
      return args[0] === 'list' ? null : 'git worktree changes are reserved for the orchestrator';
    case 'stash':
      return ['list', 'show'].includes(args[0]) ? null : 'git stash would move working-tree changes';
    case 'reflog':
      return args.length === 0 || args[0] === 'show' ? null : 'git reflog changes are reserved for the orchestrator';
    case 'submodule':
      return args[0] === 'status' ? null : 'git submodule changes are reserved for the orchestrator';
    case 'symbolic-ref':
      return positionals.length <= 1 ? null : 'git symbolic-ref writes are reserved for the orchestrator';
    case 'tag':
      return args.length === 0 || ['-l', '--list', '-n', '--contains', '--points-at'].includes(args[0]) ? null : 'git tag creation is reserved for the orchestrator';
    default:
      return `git ${sub} writes repository state or talks to a remote`;
  }
}

function checkBash(command) {
  if (!command) return null;
  if (HELPER_MUTATION.test(command)) return 'mutating workflow helper commands (init/approve/task-done/record/retry/advance/deliver/abort) are reserved for the orchestrator';
  for (const segment of command.split(/\|\||&&|[;|\n]|\$\(|`|\(/)) {
    const tokens = tokenize(segment);
    const at = findGit(tokens);
    if (at >= 0) {
      const reason = gitVerdict(tokens.slice(at + 1));
      if (reason) return reason;
    }
    if (DEV_PATH.test(segment) && (/>{1,2}\s*["']?[^\s"']*\.dev-workflow/.test(segment) || DESTRUCTIVE_FILE_TOOLS.test(segment))) {
      return 'writing under .dev-workflow/ (only tasks/<task>/logs/ is writable for subagents)';
    }
  }
  return null;
}

function inside(file, dir) {
  const normalize = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const relative = path.relative(normalize(dir), normalize(file));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function checkEdit(toolInput, root, task) {
  const file = toolInput.file_path || toolInput.notebook_path || toolInput.path;
  if (!file) return null;
  const absolute = path.resolve(root, String(file));
  const devDir = path.resolve(root, '.dev-workflow');
  const logs = path.resolve(devDir, 'tasks', task, 'logs');
  if (inside(absolute, devDir) && !inside(absolute, logs)) {
    return `editing ${file} inside .dev-workflow/ (only tasks/${task}/logs/ is writable for subagents)`;
  }
  return null;
}

function main() {
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    return 0;
  }
  if (!input || typeof input !== 'object') return 0;
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  let task = '';
  try {
    task = fs.readFileSync(path.join(root, '.dev-workflow', 'active-task'), 'utf8').trim();
  } catch {
    return 0; // no active task: nothing to guard
  }
  if (!task) return 0;
  const agent = input.agent_id || input.agent_type;
  if (!agent) return 0; // main session: the orchestrator owns Git and task state
  const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const reason = String(input.tool_name || '') === 'Bash'
    ? checkBash(String(toolInput.command || ''))
    : checkEdit(toolInput, root, task);
  if (!reason) return 0;
  process.stderr.write(
    `dev-agent-workflow: blocked for subagent ${agent} while task "${task}" is active -- ${reason}.\n`
    + 'Subagents return results to the orchestrator instead: only the main session runs Git write commands, helper mutations and edits under .dev-workflow/ (logs/ excepted).\n',
  );
  return 2;
}

if (require.main === module) process.exit(main());
module.exports = { checkBash, checkEdit, gitVerdict };
