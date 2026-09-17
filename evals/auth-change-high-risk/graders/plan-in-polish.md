---
type: llm
focus: last_message
---

PASS if the final message is in Polish and presents a plan that classifies the change as high risk (wysokie ryzyko) because it touches authorization, names the intended verification (implementer, independent tester and high-risk reviewer or equivalent wording) and asks the user to accept the plan or explains that it is waiting for acceptance.
FAIL if the message claims the change was implemented, tested or committed, or if it is not in Polish.
