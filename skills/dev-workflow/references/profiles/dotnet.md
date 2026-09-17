# C# / .NET

Load for a task that changes .NET code or its public interfaces.

## Discover before planning

- Read the target repository's `CLAUDE.md`, `.claude/rules/*.md` and `AGENTS.md` first; they
  override this profile's defaults.
- Inspect `global.json`, solution and project files, shared build properties
  (`Directory.Build.props`, `Directory.Packages.props`), package management, CI and repository
  scripts. Record SDK constraints, target frameworks, affected projects and the actual verification
  commands as exact strings in `tasks.json` `checks`.
- Identify the test runner and any required local services from the repository. Use project
  commands and installed SDK help to select supported options; do not assume one test runner or
  CLI flag set.
- Preserve the existing application architecture, web framework, persistence approach and
  dependency-management conventions. Choose these explicitly during analysis only when starting a
  new application.

## Implementation and contracts

- Follow established dependency lifetimes, asynchronous execution, cancellation, validation and
  error responses. Give shared package files, central package versions and schema migrations a
  single owner.
- For REST, locate the existing OpenAPI contract or generation source; for gRPC, locate `.proto`
  files and code generation. Agree on DTOs, errors, authorization expectations and compatibility
  before delegating dependent client/server work. Preserve another established contract approach
  when present.
- Review resource-level authorization, over-posting or unintended field binding, query
  construction, secret handling and sensitive logging where relevant. Consider migration
  compatibility when changing persistence.

## Verification

- Run the repository's build, test and analyzer commands for the affected projects
  (for example `dotnet build <project> --nologo`, `dotnet test <project> --no-build --nologo`),
  followed by the agreed integration checks. Discover formatting and dependency-audit commands
  from existing tooling and the installed SDK before selecting options.
- Test observable behavior, affected validation and authorization paths, and persistence or
  transport boundaries when changed. Reuse existing fixtures and service setup.
- State which frameworks and configurations were checked. Missing SDKs, restore access or
  integration dependencies are `not-run` blockers for those checks, not passing results. Do not
  upgrade the SDK or packages just to make verification run.
- Commands run in Git Bash on Windows: forward slashes, quote paths with spaces, expect the first
  build to restore packages.
