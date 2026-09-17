<#
.SYNOPSIS
  Registers this repository as a local Claude Code marketplace (jared0o-plugins) and installs the dev-agent-workflow plugin.
.PARAMETER Scope
  user (default) = available in every project on this machine; project / local = only for the current repository.
.NOTES
  Plugins installed from a marketplace are COPIED into ~/.claude/plugins/cache. After editing this repo run scripts/update.ps1.
  For live development without copying use scripts/dev.ps1 (claude --plugin-dir).
#>
param(
  [ValidateSet('user', 'project', 'local')]
  [string]$Scope = 'user'
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot

Write-Host "Adding marketplace jared0o-plugins from $Root (scope: $Scope)..."
claude plugin marketplace add "$Root" --scope $Scope
if ($LASTEXITCODE -ne 0) { throw "claude plugin marketplace add failed (exit $LASTEXITCODE)" }

Write-Host "Installing dev-agent-workflow@jared0o-plugins (scope: $Scope)..."
claude plugin install dev-agent-workflow@jared0o-plugins --scope $Scope
if ($LASTEXITCODE -ne 0) { throw "claude plugin install failed (exit $LASTEXITCODE)" }

Write-Host ""
Write-Host "Installed. Restart Claude Code (or run /reload-plugins in an open session), then in any repository:"
Write-Host "  /dev-agent-workflow:dev-workflow <task description>"
Write-Host "After editing this repository, apply the changes with: pwsh $PSScriptRoot\update.ps1"
