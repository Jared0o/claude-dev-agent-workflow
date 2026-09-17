# Eval suite

Cases for `claude plugin eval` (Claude Code 2.1.269+). Every case seeds its workspace with a
Bash `scaffold.sh` (a small Git repository) and drives the orchestrator skill with an explicit
`/dev-agent-workflow:dev-workflow ...` prompt, because the skill is not model-invocable.

The orchestrator needs `Bash` (helper and Git), `Write` and `Edit`, which eval runs grant only
through `--allow-tools`, and granted shell commands run in Claude Code's OS sandbox. Native
Windows has no sandbox backend, so run the suite from WSL2, Linux or macOS:

```sh
claude plugin eval . --scaffold --allow-tools Bash Write Edit --trust-plugin --no-publish
claude plugin eval . --case readme-typo-direct-low --runs 1 --ablation none --scaffold --allow-tools Bash Write Edit
```

Every run is a real model call on your account. `results/` is ignored by Git.

| Case | What it checks |
|---|---|
| `readme-typo-direct-low` | low risk, `direct-low`, `approve --authorized-by-request`, zero `Agent` and `AskUserQuestion` calls, typo fixed, verification recorded, local commit, Polish summary |
| `auth-change-high-risk` | `--risk high`, plan gate through `AskUserQuestion`; headless runs cannot answer it, so no `approve --confirmed-by-user`, no `Agent`, no edits to `src/orders.js` |
| `analyze-only-no-edits` | analysis request: no `Edit`/`Write` outside `.dev-workflow/`, no `approve`, no commit, concrete Polish explanation |
| `status-unknown-task` | `status foo` calls the helper, reports the unknown task honestly, does not `init` |

Graders of type `tool_used` with `tool: Skill` and graders marked `arm: both` follow the rules in
the Claude Code eval documentation for two-arm (with/without plugin) runs.
