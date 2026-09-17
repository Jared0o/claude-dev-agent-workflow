// Drive the hook scripts with crafted stdin the way Claude Code does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, makeRepo, cli, initialize } from './helpers.mjs';

const HOOKS = path.join(ROOT, 'hooks');

function runHook(name, input, repo) {
  const result = spawnSync(process.execPath, [path.join(HOOKS, name)], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo, CLAUDE_PLUGIN_ROOT: ROOT },
    encoding: 'utf8',
  });
  assert.ok(!/\n\s+at /.test(result.stderr), `stack trace leaked: ${result.stderr}`);
  return result;
}

const bash = (command, agent = 'agent-123') => ({
  session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command },
  ...(agent ? { agent_id: agent, agent_type: 'dev-agent-workflow:implementer' } : {}),
});
const write = (file, agent = 'agent-123') => ({
  session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: file, content: 'x' },
  ...(agent ? { agent_id: agent, agent_type: 'dev-agent-workflow:implementer' } : {}),
});

test('guard is silent without an active task and for the main session', (t) => {
  const ctx = makeRepo(t);
  assert.equal(runHook('guard.js', bash('git commit -m x'), ctx.repo).status, 0);
  initialize(ctx, 'standard');
  assert.equal(runHook('guard.js', bash('git commit -m x', null), ctx.repo).status, 0, 'main session may commit');
  assert.equal(runHook('guard.js', write('.dev-workflow/tasks/change/state.json', null), ctx.repo).status, 0);
  assert.equal(runHook('guard.js', 'not json', ctx.repo).status, 0, 'fails open on malformed input');
});

test('guard blocks Git writes, helper mutations and state edits for subagents', (t) => {
  const ctx = makeRepo(t);
  initialize(ctx, 'standard');
  const blocked = [
    'git commit -m "done"', 'git -C /work push origin main', 'cd web && git stash', 'git add .', 'git switch -c feature/x',
    'git checkout -- app.txt', 'git reset --hard HEAD~1', 'git branch -D old', 'git branch new-branch', 'git rebase main',
    'git tag v1', 'git remote add origin https://example.com/r.git', 'git config user.name "x"', 'git worktree add ../w',
    'env GIT_DIR=.git git commit -m x', 'npm test; git push', 'git fetch origin', 'git pull',
    'node "/plugin/scripts/workflow.mjs" approve --task change --confirmed-by-user',
    'node /plugin/scripts/workflow.mjs record --task change --kind verification',
    'echo done > .dev-workflow/tasks/change/state.json', 'rm -rf .dev-workflow/tasks/change', 'sed -i s/a/b/ .dev-workflow/active-task',
  ];
  for (const command of blocked) {
    const result = runHook('guard.js', bash(command), ctx.repo);
    assert.equal(result.status, 2, `expected block: ${command}`);
    assert.match(result.stderr, /dev-agent-workflow: blocked for subagent agent-123 while task "change"/);
  }
  const result = runHook('guard.js', write('.dev-workflow/tasks/change/state.json'), ctx.repo);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /inside \.dev-workflow\//);
  assert.equal(runHook('guard.js', write(path.join(ctx.repo, '.dev-workflow', 'active-task')), ctx.repo).status, 2);
  assert.equal(runHook('guard.js', { ...write('.dev-workflow/tasks/change/tasks.json'), tool_name: 'Edit' }, ctx.repo).status, 2);
});

test('guard allows read-only Git, project commands and task logs for subagents', (t) => {
  const ctx = makeRepo(t);
  initialize(ctx, 'standard');
  const allowed = [
    'git status', 'git diff HEAD -- src/', 'git log -n 3 --oneline', 'git show HEAD:app.txt', 'git blame app.txt',
    'git branch --show-current', 'git branch -a', 'git rev-parse HEAD', 'git worktree list', 'git remote -v', 'git stash list',
    'git config --get user.name', 'git config user.name', 'git ls-files', 'git --version', 'git -C . --no-pager diff --stat',
    'npm test', 'dotnet test --no-build', 'go test ./...', 'grep -rn "git commit" docs/',
    'echo out > .dev-workflow/tasks/change/logs/run.txt', 'mkdir -p .dev-workflow/tasks/change/logs',
    'node "/plugin/scripts/workflow.mjs" status --task change', 'node /plugin/scripts/workflow.mjs list --brief',
    'cat .dev-workflow/tasks/change/spec.md',
  ];
  for (const command of allowed) {
    const result = runHook('guard.js', bash(command), ctx.repo);
    assert.equal(result.status, 0, `expected allow: ${command}\n${result.stderr}`);
  }
  assert.equal(runHook('guard.js', write('.dev-workflow/tasks/change/logs/impl-1.log'), ctx.repo).status, 0);
  assert.equal(runHook('guard.js', write('src/app.js'), ctx.repo).status, 0);
  assert.equal(runHook('guard.js', write(path.join(ctx.repo, 'README.md')), ctx.repo).status, 0);
});

test('session reminder reports the active task and adapts to compaction', (t) => {
  const ctx = makeRepo(t);
  let result = runHook('session-reminder.js', { hook_event_name: 'SessionStart', source: 'startup' }, ctx.repo);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  initialize(ctx, 'high');
  result = runHook('session-reminder.js', { hook_event_name: 'SessionStart', source: 'startup' }, ctx.repo);
  const output = JSON.parse(result.stdout);
  assert.equal(output.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(output.hookSpecificOutput.additionalContext, /task "change" \(Change behavior\) is ACTIVE/);
  assert.match(output.hookSpecificOutput.additionalContext, /stage analysis, risk high/);
  assert.match(output.hookSpecificOutput.additionalContext, /dev-workflow resume change/);
  result = runHook('session-reminder.js', { hook_event_name: 'SessionStart', source: 'compact' }, ctx.repo);
  assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, /Context was just compacted/);
  cli(ctx, 'abort', '--reason', 'Stop');
  fs.writeFileSync(path.join(ctx.repo, '.dev-workflow', 'active-task'), 'change\n');
  result = runHook('session-reminder.js', { hook_event_name: 'SessionStart', source: 'resume' }, ctx.repo);
  assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, /stale marker/);
});

test('agent log appends runtime identities only while a task is active', (t) => {
  const ctx = makeRepo(t);
  const stop = { hook_event_name: 'SubagentStop', agent_id: 'agent-9', agent_type: 'dev-agent-workflow:reviewer', session_id: 's1' };
  assert.equal(runHook('agent-log.js', stop, ctx.repo).status, 0);
  assert.ok(!fs.existsSync(path.join(ctx.repo, '.dev-workflow')));
  initialize(ctx, 'standard');
  assert.equal(runHook('agent-log.js', stop, ctx.repo).status, 0);
  assert.equal(runHook('agent-log.js', { ...stop, agent_id: 'agent-10' }, ctx.repo).status, 0);
  const lines = fs.readFileSync(path.join(ctx.repo, '.dev-workflow', 'tasks', 'change', 'agents.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).agent_id, 'agent-9');
  assert.equal(JSON.parse(lines[1]).agent_type, 'dev-agent-workflow:reviewer');
});
