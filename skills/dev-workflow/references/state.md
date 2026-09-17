# State and helper commands

Node 20+ and Git are required. Run the helper as
`node "${CLAUDE_PLUGIN_ROOT}/scripts/workflow.mjs" <command> --project <path inside repo>`;
`--project` resolves to the repository root (default: the current directory). Every command
prints JSON on stdout; failures print `workflow: <reason>` on stderr with exit 1 (validation) or
2 (usage). Only the orchestrator writes state; a guard hook blocks subagents from mutating
commands and from editing `.dev-workflow/` (except `tasks/<task>/logs/`). The helper never
executes shell strings taken from tasks or reports.

`init` appends `.dev-workflow/` to `.git/info/exclude` when the repository does not ignore it
already, so task artifacts never appear in `git status` or commits. The result reports it under
`ignore`.

## Task lifecycle

```sh
workflow config [--risk high]
workflow init --task add-orders --title "Add orders" --risk standard --risk-reason "Changes behavior without high-risk boundaries"
workflow status --task add-orders
workflow list [--brief]
```

Risk defaults to `standard`; record a meaningful reason before approval. Write the short
`spec.md` and `tasks.json` in `.dev-workflow/tasks/<task>/` following [handoffs](handoffs.md).
One task entry suffices for one implementation owner. Only one task may be active per
repository: `init` and `approve` refuse while another task is neither `done` nor aborted.

After explicit acceptance of that exact plan (an `AskUserQuestion` result), or when a clear
request already authorizes low-risk work:

```sh
workflow approve --task add-orders --confirmed-by-user
workflow approve --task add-orders --authorized-by-request      # low risk only
```

The flags are mutually exclusive. Neither risk selection nor a request for analysis only is
authorization. Reclassify with
`workflow approve --task <id> --risk high --risk-reason "<new rationale>" --confirmed-by-user`;
an already authorized task requires explicit confirmation for any risk change, including
lowering it. Approval fingerprints `spec.md`, `tasks.json`, the effective configuration, risk,
execution mode and their reasons; changing any of them invalidates approval. Approval clears
completion and evidence but never replenishes the repair budget of an unchanged plan.

```sh
workflow task-done --task add-orders --item backend
workflow advance --task add-orders
```

Completing an item requires its dependencies. Stages are
`analysis → implementation → verification → delivery → done`. `advance` refuses incomplete
items and missing, failed or stale evidence; leaving `delivery` additionally requires a current
`delivery.json`.

## Direct execution for trivial low-risk work

`init` and `approve` accept `--execution-mode delegated|direct-low` with
`--execution-reason "<rationale>"`. `direct-low` requires `--risk low`, a nonempty reason and one
task without dependencies. Logic, security, data or contract changes never qualify, even in one
line. The main session implements, runs the focused and repository-required checks and assesses
the diff; the report lists `orchestrator` as the sole `implementer_ids` entry and as
`assessments.orchestrator.agent_id`. Switch modes with
`approve --execution-mode <mode> --execution-reason "<fresh reason>"` plus the applicable
authorization flag; attempts are preserved.

## One verification report

Collect actual command results and assessments into `reports/verification.json` inside the task
directory. A standard-risk example:

```json
{
  "implementer_ids": ["impl-1"],
  "checks": [
    {"command": "npm test", "result": "pass", "exit_code": 0},
    {"command": "npm run lint", "result": "not-run", "exit_code": null}
  ],
  "assessments": {
    "reviewer": {"agent_id": "rev-1", "result": "pass", "summary": "Reviewed the integrated diff and docs; no blocking findings."}
  },
  "documentation": "Updated README.md for the new endpoint.",
  "blockers": [],
  "runtime_agents": [{"agent_id": "agent-…", "agent_type": "dev-agent-workflow:implementer"}]
}
```

Rules enforced by the helper on `--result pass`:

- `implementer_ids` nonempty and unique; `agent_id` values are the handoff IDs you assigned
  (`impl-1`, `test-1`, `rev-1`, or `orchestrator` for the main session).
- Every command from the approved `tasks.json` `checks` appears verbatim in `checks[].command`
  with `pass` and `exit_code: 0`; extra relevant commands are allowed. `not-run` uses
  `exit_code: null` and blocks a pass.
- Required assessments: `orchestrator` for `low`, `reviewer` for `standard`, `tester` and
  `reviewer` for `high`. In `delegated` mode assessors differ from implementers; at high risk the
  tester differs from the reviewer; in `direct-low` the orchestrator is the sole implementer and
  assessor.
- `documentation` is a nonempty string (changed docs or why none are needed); `blockers` is an
  array. Any blocker or `fail` yields a failing report.
- Additional keys such as `runtime_agents`, `models_observed` or `notes` are allowed.

Read `fingerprint` from `status` before running checks, then record:

```sh
workflow record --task add-orders --kind verification --result pass --report reports/verification.json --fingerprint <fingerprint-before-checks>
```

Recording fails when the working tree changed since that fingerprint. Editing the report
requires recording it again. The helper validates structure and identity separation; it cannot
prove that a command ran, an agent was independent or a person approved. Never manufacture
evidence to satisfy a gate.

## Fingerprints, reuse and interruption

Fingerprints hash tracked and non-ignored untracked files (index mode plus working-tree
bytes, symlink targets), excluding `.dev-workflow/` and commit metadata. Committing identical
content does not invalidate evidence. Submodules require separate workflows. Ignored
dependencies and external services are not captured: record relevant versions and reassess
when they change.

Any project-file change makes recorded evidence stale. Rerun affected checks, assess the delta
and record again. A documentation-only delta may reuse runtime results after the required
assessor reviews its impact; check affected executable examples. On interruption run `status`,
`git status` and `git log`, reconcile dirty work with `completed_tasks`, and resume only
unfinished or invalidated work. `list --brief` prints one line per task for quick orientation.

## Repairs, delivery, abort

```sh
workflow retry --task add-orders --problem auth-failure
```

Record a retry before each repair round with a stable problem ID. The result is `ordinary`
within `repair_rounds`, then `diagnosis-required` once (`escalated_attempts`) together with the
configured `diagnosis` agent and model; afterwards the budget is exhausted and the problem is a
blocker for the user. Diagnosis is read-only, does not clear blockers and does not extend the
budget.

```sh
workflow deliver --task add-orders --commit <sha> --branch feature/add-orders --base main [--pr-url <url>]
workflow advance --task add-orders
workflow abort --task add-orders --reason "Requirements changed"
```

`deliver` requires the `delivery` stage, current evidence and `--commit` equal to `HEAD`; with
`delivery: draft-pr` a verified `https://github.com/<owner>/<repo>/pull/<n>` URL is mandatory.
It writes `delivery.json` (`fingerprint`, `commit`, `branch`, `base`, `pr_url`). `advance` then
moves to `done` and releases the active-task marker. `abort` records the reason, releases the
marker and blocks further mutations; it never touches the user's code. See
[delivery](delivery.md).

## Configuration

Defaults live in the plugin's `config/defaults.json`; a project may override fields in
`.dev-workflow/config.json` (unknown fields are rejected):

```json
{
  "models": {"implementer": {"agent": "implementer", "model": "sonnet"}},
  "risk_model_overrides": {"high": {"reviewer": {"agent": "reviewer-high", "model": "fable"}}},
  "max_parallel_agents": 2,
  "repair_rounds": 2,
  "escalated_attempts": 1,
  "delivery": "local"
}
```

`model` is a Claude Code alias (`sonnet|opus|haiku|fable`) passed to the Agent tool, or `null`
to keep the agent file's default; `agent` names the plugin agent to dispatch. Effort is fixed in
each agent definition because the Agent tool cannot override it. `config --risk <risk>` shows the
`effective_models` for that risk. Changing effective configuration invalidates approval.
