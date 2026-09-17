---
type: llm
focus: last_message
---

PASS if the final message is written in Polish, states that the typo in README.md was corrected, names the checks that were actually run (or says none were needed) and mentions the branch or commit created locally without claiming that anything was pushed or that a pull request exists.
FAIL if the message is not in Polish, claims a push or pull request, claims tests passed without naming a command, or asks the user to approve a plan for this trivial change.
