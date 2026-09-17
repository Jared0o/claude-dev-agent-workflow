# Delivery

Default completion (`delivery: local`) is a commit on the task branch in the existing
repository. No push, no pull request, no merge, no deployment; the user decides what happens
next. `delivery: draft-pr` (project config) additionally pushes and opens a draft pull request
with `gh` when available.

## Before implementation

Inspect the remote and base branch (`git remote -v`, `git rev-parse --abbrev-ref HEAD`,
`git status`) and record base and destination in `spec.md`. Create the task branch
(`feature/<task-id>` unless `CLAUDE.md` or repository conventions dictate another scheme) from
the agreed base before any agent writes. If unrelated uncommitted changes exist, work in a
separate worktree from the agreed base or preserve them with an explicit file ownership list;
never auto-stash or reset them. Never change an existing repository's visibility. A new
repository is created private only when the user asked for a repository.

## Commit (local, default)

The orchestrator owns Git. After `record` passes and `advance` reached `delivery`:

1. Stage only the reviewed task files: `git add -- <paths>`; never `.dev-workflow/`, secrets or
   logs. Inspect `git diff --cached --stat` and untracked files (`git status --porcelain`).
2. Commit on the task branch with a message that leads with the concrete problem and result,
   then validation and limitations. Follow the repository's commit conventions.
3. `workflow deliver --task <id> --commit $(git rev-parse HEAD) --branch <task-branch> --base <base>`,
   then `workflow advance --task <id>` to reach `done`. Do this immediately after the commit and
   before any further edit; the delivery record must match `HEAD` and the current fingerprint.

## Draft pull request (`delivery: draft-pr`, optional)

Requires `gh` installed and `gh auth status` succeeding. Push the task branch normally (never
force), check whether a pull request for this head and base already exists and reuse it on
resume, otherwise `gh pr create --draft --base <base> --head <branch> --body-file <temp file>`;
never interpolate multiline model text into shell commands. The body leads with the problem and
result, then validation and limitations. Do not add reviewers or send messages unless asked.
Record `--pr-url` in `deliver`. If `gh` is missing, unauthenticated or the network fails, keep
the local commit, leave the task in `delivery` and report the compare URL derived from
`git remote get-url origin` (`https://github.com/<owner>/<repo>/compare/<base>...<branch>?expand=1`)
so the user can open the pull request manually; resuming later reuses the branch. Never fall
back to a public repository or to a force push.

## Final reply (Polish)

Outcome, key changes, tests actually run (commands and results), limitations, branch name and
the next command for the user (for `local`: `git push -u origin <branch>` and where to open the
pull request; for `draft-pr`: the PR link), and observed helper models when known. A stopped or
blocked task reports the blocker and `/dev-agent-workflow:dev-workflow resume <id>` without
claiming completion.
