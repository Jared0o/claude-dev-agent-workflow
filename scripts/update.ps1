<#
.SYNOPSIS
  Re-reads this repository as the jared0o-plugins marketplace and updates the installed dev-agent-workflow plugin copy.
.PARAMETER Scope
  Scope the plugin was installed with (default: user).
.NOTES
  Bump "version" in .claude-plugin/plugin.json and package.json first; the cache is keyed by version.
#>
param(
  [ValidateSet('user', 'project', 'local')]
  [string]$Scope = 'user'
)
$ErrorActionPreference = 'Stop'

Write-Host "Refreshing marketplace jared0o-plugins..."
claude plugin marketplace update jared0o-plugins
if ($LASTEXITCODE -ne 0) { throw "claude plugin marketplace update failed (exit $LASTEXITCODE)" }

Write-Host "Updating dev-agent-workflow@jared0o-plugins (scope: $Scope)..."
claude plugin update dev-agent-workflow@jared0o-plugins --scope $Scope
if ($LASTEXITCODE -ne 0) { throw "claude plugin update failed (exit $LASTEXITCODE)" }

Write-Host ""
Write-Host "Updated. Plugins are copied into ~/.claude/plugins/cache -- restart Claude Code (or /reload-plugins) to apply."
