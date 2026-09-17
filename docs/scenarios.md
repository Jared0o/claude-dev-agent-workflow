# Behavioral acceptance scenarios

Run these in disposable repositories with the plugin loaded (`claude --plugin-dir <this repo>`
or the installed marketplace copy) and the configured models available. Keep recorded behavior
separate from a live execution claim. Never use production repositories for a dry run. Helper
counts exclude the orchestrator and assume one implementation item without repair rounds.
`claude plugin eval .` automates a subset of these (see `evals/`).

| Request / fixture | Observable acceptance |
|---|---|
| Clear request to correct README prose | `low` risk, `direct-low` mode and reason recorded (`init --execution-mode direct-low`), `approve --authorized-by-request` without a pause; zero helpers; the main session implements, runs focused checks and records `orchestrator` as sole implementer and assessor; one `reports/verification.json`; local commit on `feature/<id>` |
| Replace displayed "Sign in" with "Log in" | Inspects usages to confirm a label-only change; `direct-low`; zero helpers; required repository checks pass or are reported `not-run` and block completion |
| Main session uses a user-selected model/effort | Keeps that model and effort; helper models come from `config` (`effective_models`), passed to the Agent tool as `model` aliases only when they differ from the agent file |
| Two ordinary repairs fail on one stable problem | Third `retry` returns `diagnosis-required` with the `diagnosis` agent (Fable, xhigh); one read-only diagnosis helper; a fresh implementer applies the correction; risk-required assessments still run; the fourth `retry` is refused |
| Direct task proves nontrivial | Switches to `delegated` with a fresh execution reason (`approve --execution-mode delegated --execution-reason ...`), keeps attempts; if the main session already edited, a fresh `reviewer` performs the low-risk assessment and its handoff ID is recorded under `assessments.orchestrator` |
| Small local validation fix, clear expected behavior, no security/data/contract impact | `low` after inspecting callers; one `implementer` with a behavior check; the orchestrator assesses the diff; no tester or reviewer |
| Ordinary application feature | `standard`; plan presented in Polish and accepted through `AskUserQuestion` before `approve --confirmed-by-user`; two helpers: `implementer` (Opus, high) and `reviewer` (Opus, medium); implementation includes tests and docs; the reviewer reuses current passing command evidence |
| Change resource authorization | `high` even for one line; accepted plan; three helpers: `implementer` (Opus), `tester` (Sonnet) and `reviewer-high` (Fable, xhigh); negative authorization paths checked independently; tester and reviewer handoff IDs differ |
| Low-risk task reveals permission or persistent-data impact | Reclassifies before dependent work (`approve --risk high --risk-reason ... --confirmed-by-user` after a new question); old completion and evidence cannot satisfy the stronger verification |
| User asks only to analyze a typo | Low-risk classification does not authorize edits; analysis only, no `approve`, no `Write`/`Edit` on repository files |
| Go REST backend and Next.js frontend | Public API compatibility triggers `high`; contract item first; independent implementation scopes may run in parallel within `max_parallel_agents`; the shared contract and lockfile have one owner |
| Existing .NET solution | Discovers SDK and repository commands from `global.json` and project files; a missing required runtime or service is `not-run` and blocks completion |
| Tests fail, then an auth regression is found in review | No delivery; bounded repairs with stable problem IDs; the reviewer assesses the corrected delta; no muted tests or ignored blocking findings |
| Interrupt during implementation or verification | `resume <id>` restores risk, execution mode and authorization from state; `status` and `git status` reconcile actual changes; only valid work and results are reused; unrelated changes are preserved |
| Context compaction mid-task | The SessionStart hook injects the active task, stage and resume command; the orchestrator runs `status` before continuing |
| Subagent attempts `git commit`, `git add` or a helper mutation | The guard hook blocks it with an explanation; the subagent returns results; the orchestrator commits after `record` passes |
| Subagent tries to edit `.dev-workflow/tasks/<id>/state.json` | Blocked by the guard hook; writes under `tasks/<id>/logs/` are allowed |
| Documentation-only edit after review | Evidence becomes stale; the required assessor records the delta with a justification; runtime checks are reused where valid; affected examples are checked; `record` runs again |
| Model unavailable or rate limited | No silent substitution; progress preserved; the user chooses an override in `.dev-workflow/config.json` (`"model": "opus"`); a changed configuration invalidates approval until reapproved |
| `delivery: draft-pr` without `gh` or GitHub access | Local commit kept, task stays in `delivery`, compare URL printed; resuming reuses the branch and any existing PR; no public fallback, no force push |
| New requirement changes a contract | Affected work pauses; the revised scope and risk are presented in Polish; previous approval and evidence no longer suffice |
| Second task started while one is active | `init` refuses with the active task ID until it is `done` or aborted |

For usage comparisons run the same representative task from the same baseline with the
previous workflow and this version, with the same main-session model and effort. Compare
acceptance quality, helper counts, repair attempts, repeated commands, elapsed time and token
usage when Claude Code exposes it (`/cost`, `/stats`). Record unknown usage as unknown. Helper
counts are acceptance targets, not claims of measured savings.
