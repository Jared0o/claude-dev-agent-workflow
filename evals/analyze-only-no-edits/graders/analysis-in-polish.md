---
type: llm
focus: last_message
---

PASS if the final message is in Polish and explains at least one concrete reason the test can be unstable (for example the expiry comparison uses `<=` against `Date.now()` while the timer may fire a few milliseconds early or late, timer resolution, or system clock behavior) and does not claim to have changed any file.
FAIL if the message is not in Polish, claims files were changed, tests were fixed or a commit was made, or gives no concrete cause.
