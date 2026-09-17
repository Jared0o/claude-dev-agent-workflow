<#
.SYNOPSIS
  Starts Claude Code with this repository loaded live as a plugin (no copy to the cache; edits apply after /reload-plugins).
.EXAMPLE
  pwsh .\scripts\dev.ps1
  pwsh .\scripts\dev.ps1 --permission-mode auto
.NOTES
  Do not combine with a marketplace install of the same plugin in the same session (duplicate components).
  Uninstall first: claude plugin uninstall dev-agent-workflow@jared0o-plugins
#>
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Rest
)
$Root = Split-Path -Parent $PSScriptRoot
claude --plugin-dir "$Root" @Rest
