---
type: llm
focus: last_message
---

PASS if the final message is in Polish, says that no task named "foo" exists in this repository (or that the helper reported an unknown task) and suggests listing tasks or starting a new one.
FAIL if the message invents a stage, risk or progress for task "foo", or is not in Polish.
