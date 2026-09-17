#!/usr/bin/env node
// dev-agent-workflow SubagentStop hook (all agent types).
// While a task is active, append the stopped subagent's runtime identity to
// .dev-workflow/tasks/<task>/agents.jsonl so the orchestrator can attach real agent IDs
// to reports/verification.json as supporting evidence. Best effort: never blocks, always exits 0.
'use strict';
const fs = require('fs');
const path = require('path');

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8')) || {};
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const task = fs.readFileSync(path.join(root, '.dev-workflow', 'active-task'), 'utf8').trim();
  const directory = path.join(root, '.dev-workflow', 'tasks', task);
  if (task && fs.existsSync(path.join(directory, 'state.json'))) {
    const entry = {
      agent_id: input.agent_id ?? null,
      agent_type: input.agent_type ?? null,
      session_id: input.session_id ?? null,
      stopped_at: new Date().toISOString(),
    };
    if (input.agent_transcript_path) entry.transcript = String(input.agent_transcript_path);
    fs.appendFileSync(path.join(directory, 'agents.jsonl'), JSON.stringify(entry) + '\n', 'utf8');
  }
} catch {
  // best effort only
}
process.exit(0);
