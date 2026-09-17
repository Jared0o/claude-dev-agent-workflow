#!/usr/bin/env bash
# Seeds an empty Git repository without any dev-workflow task. Runs only with --scaffold.
set -euo pipefail
git init -q -b main
git config user.name "Eval fixture"
git config user.email "eval@example.invalid"
git config commit.gpgsign false
printf '# Empty project\n' > README.md
git add README.md
git commit -qm "Initial commit"
