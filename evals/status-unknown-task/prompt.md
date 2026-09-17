---
description: Asking for the status of a task that does not exist must surface the helper's error honestly, without creating a task or inventing a state.
tags: [smoke, status]
max_turns: 15
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, AskUserQuestion]
expected_outcome: helper status called for task foo; error reported in Polish with a hint to use list; no init.
---

/dev-agent-workflow:dev-workflow status foo
