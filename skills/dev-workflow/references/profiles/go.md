# Go

Load for a task that changes Go code or its public interfaces.

## Discover before planning

- Read the target repository's `CLAUDE.md`, `.claude/rules/*.md` and `AGENTS.md` first; they
  override this profile's defaults.
- Read `go.mod`, any `go.work`, CI configuration and repository task scripts (Makefile, Taskfile,
  scripts). Record the declared toolchain, relevant modules and the actual build/test commands as
  exact strings in `tasks.json` `checks`. Preserve the existing framework and module layout.
- Identify the affected package and its callers, existing test helpers, and how local services or
  test databases are started. Do not assume that running from the repository root covers every
  module.
- For a new service, agree on the transport and required dependencies during analysis; do not
  introduce a framework merely to match this profile.

## Implementation and contracts

- Follow the project's handling of context cancellation, timeouts, errors, configuration and
  dependency injection. Keep shared module and dependency-file changes (`go.mod`, `go.sum`) under
  one owner's control.
- For an affected REST boundary, use the repository's OpenAPI source and generation process; for
  gRPC, use its `.proto` source and generators. Establish request, response, error and
  compatibility expectations before parallel client/server work. Preserve another established
  contract approach when present.
- Review authorization at the resource boundary, input and payload limits, unsafe query
  construction, secret handling and cancellation around external calls where relevant.

## Verification

- Prefer the existing commands. Without wrappers, consider scoped `go test ./pkg/...`, `go vet
  ./...` and a formatting check for changed packages; select flags using the installed toolchain
  and repository conventions.
- Add behavior-focused tests for acceptance criteria and affected error paths. Use `-race` when
  concurrent behavior changes and the environment supports it. Run integration tests when the
  changed behavior depends on a service, database or generated contract.
- Reuse configured vulnerability checks (`govulncheck` when present). Report missing tooling or
  unavailable services as `not-run` with the affected claim; do not install a new toolchain or
  audit tool silently.
- Commands run in Git Bash on Windows too; write `checks` in POSIX form (`cd cmd/api && go test ./...`).
