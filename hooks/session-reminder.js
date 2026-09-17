#!/usr/bin/env node
// dev-agent-workflow SessionStart hook (matcher: startup|resume|compact).
// If a task is active in this repository (.dev-workflow/active-task), remind the orchestrator
// where its state lives and how to continue. Always exits 0; prints hookSpecificOutput JSON
// so Claude Code injects the reminder as context. Silent when no task is active.
'use strict';
const fs = require('fs');
const path = require('path');

let input = {};
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8')) || {};
} catch {
  input = {};
}
const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
let task = '';
try {
  task = fs.readFileSync(path.join(root, '.dev-workflow', 'active-task'), 'utf8').trim();
} catch {
  process.exit(0);
}
if (!task) process.exit(0);

let state = null;
try {
  state = JSON.parse(fs.readFileSync(path.join(root, '.dev-workflow', 'tasks', task, 'state.json'), 'utf8'));
} catch {
  state = null;
}
const source = String(input.source || 'startup');
const skill = '/dev-agent-workflow:dev-workflow';
let message;
if (!state) {
  message = `dev-agent-workflow: .dev-workflow/active-task names task "${task}" but its state.json is missing or unreadable. `
    + `Run "${skill} list" to see recorded tasks; delete the stale marker only if the task no longer exists.`;
} else if (state.stage === 'done' || state.aborted) {
  message = `dev-agent-workflow: stale marker -- task "${task}" is already ${state.aborted ? 'aborted' : 'done'}. `
    + 'It is safe to delete .dev-workflow/active-task before starting a new task.';
} else {
  const authorization = state.authorization || 'none yet';
  message = `dev-agent-workflow: task "${task}" (${state.title || 'untitled'}) is ACTIVE in this repository -- `
    + `stage ${state.stage}, risk ${state.risk}, execution mode ${state.execution_mode}, authorization ${authorization}. `
    + (source === 'compact'
      ? 'Context was just compacted: before doing anything else re-read the dev-workflow SKILL.md, run the helper "status" for this task and "git status", then continue from the recorded stage. '
      : `To continue run "${skill} resume ${task}" (or "${skill} abort ${task}" to stop it). `)
    + 'Plan acceptance still requires AskUserQuestion; only the main session runs Git and helper mutations (the guard hook blocks subagents).';
}

process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: message } }));
process.exit(0);
