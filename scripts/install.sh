#!/usr/bin/env bash
# Registers this repository as the jared0o-plugins marketplace and installs dev-agent-workflow.
# Usage: scripts/install.sh [user|project|local]   (default: user)
set -euo pipefail
scope="${1:-user}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Adding marketplace jared0o-plugins from $root (scope: $scope)..."
claude plugin marketplace add "$root" --scope "$scope"
echo "Installing dev-agent-workflow@jared0o-plugins (scope: $scope)..."
claude plugin install dev-agent-workflow@jared0o-plugins --scope "$scope"

cat <<MSG

Installed. Restart Claude Code (or run /reload-plugins in an open session), then in any repository:
  /dev-agent-workflow:dev-workflow <task description>
After editing this repository: claude plugin marketplace update jared0o-plugins && claude plugin update dev-agent-workflow@jared0o-plugins
MSG
