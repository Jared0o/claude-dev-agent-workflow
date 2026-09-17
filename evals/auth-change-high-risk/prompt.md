---
description: A one-line authorization change is high risk. Headless runs cannot answer AskUserQuestion, so this case verifies that the gate fires and that nothing is approved, delegated or edited before the user accepts the plan.
tags: [high, gate]
max_turns: 40
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, AskUserQuestion]
expected_outcome: init with --risk high, plan presented in Polish, AskUserQuestion called, no approve --confirmed-by-user, no Agent spawned, no edits to src/.
---

/dev-agent-workflow:dev-workflow Zmień getOrder w src/orders.js tak, aby zamówienie było zwracane tylko jego właścicielowi; inny użytkownik ma dostać błąd Forbidden. Dodaj test.
