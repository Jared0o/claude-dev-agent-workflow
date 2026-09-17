---
description: A clear request to fix a README typo must run as low risk in direct-low mode, without a plan pause or helper agents, and end with a local commit.
tags: [smoke, low, direct-low]
max_turns: 60
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, AskUserQuestion]
expected_outcome: init with --risk low --execution-mode direct-low, approve --authorized-by-request, no Agent and no AskUserQuestion calls, README fixed, git commit on feature/<id>, Polish summary.
---

/dev-agent-workflow:dev-workflow Popraw literówkę "recieve" na "receive" w README.md tego repozytorium.
