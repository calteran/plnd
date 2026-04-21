# CLAUDE.md

Claude Code configuration for the PLND project. See PLANNING.md for the development roadmap.

## Project Overview

PLND ("planned") is a neurodivergent-focused planner/assistant for managing nutrition, exercise, and daily planning. It consists of a Rust/Axum backend (`plnd_api`) and an Angular frontend (`plnd_client`).

- **Current Phase**: Phase 3.3 — COMPLETED (AI-powered meal planning wizard shipped; Phase 3.5 Background Agent Jobs is next)

- **Repository**: https://github.com/calteran/plnd

> See [DOMAIN_MODEL.md](DOMAIN_MODEL.md) for domain architecture.

## Critical Rules

### Testing
- **NEVER run `just test` or `just test-ci`** — both have been removed from the justfile
- **ALWAYS use `just verify`** for pre-commit validation (parallel pipeline: quality + build + tests + e2e)
- Unit tests only: `just test-ng-headless` (Angular)

### Shell Commands
- **Never chain `cd` with `&&`** — run `cd <dir>` as a standalone command first, then follow with subsequent commands separately; this avoids triggering a permission prompt on every compound command

### Server Processes
- **NEVER run `cargo run` directly**
- Use `just verify-build` to check compilation
- Use `just test-run-server` to test startup (auto-kills after 15s)

### Branch Discipline
- **NEVER commit directly to `main`** — always work on a feature or fix branch and open a PR
- **ALWAYS branch from `main`** — never base a branch on another feature branch; this avoids merge conflicts and spurious commits when the parent branch merges

### PR Lifecycle
- **After opening a PR**: invoke the `monitor-pr` skill to watch CI and address any review comments
- **After a PR merges**: `git checkout main && git pull`, remove the worktree if one was used (`just worktree-new` creates them under `.worktrees/<branch>`), then delete the local branch (`git branch -d <branch>`)

### Storage Layer Isolation
- No production crate other than `plnd_data` may depend on `sqlx`, import `PgPool`, or
  execute database queries. `plnd_api` and `plnd_agent` interact with storage only through
  trait-based repositories defined in `plnd_data::repository`.
- `plnd_data` MUST NOT re-export `sqlx` types publicly. Domain types (`DatabaseError`,
  model structs, query response types) are public; connection/query primitives are private.
- New storage-backed functionality adds a method to an existing repository trait (or a new
  trait) in `plnd_data`, never a direct query in a consuming crate.
- Workspace exception: `plnd_seed` (non-production tooling) may use `sqlx` directly.

## Common Commands

```bash
# Development
just dev              # Start full Docker stack
just api              # Run API only (cargo)
just client           # Run Angular dev server

# Quality (run individually or all at once)
just fmt              # Rust formatting
just clippy           # Rust linting
just deny             # Dependency security/license check
just machete          # Unused dependency detection
just ts-lint          # TypeScript/Angular ESLint
just ts-deps          # TypeScript dependency health

# Verification
just verify-build     # Compile check only (safe, no server)
just test-run-server  # Server startup test (15s timeout, auto-kills)
just verify           # Full quality + build + tests (run before every commit)

# Testing (unit tests only — use verify for full pre-commit validation)
just test-ng-headless # Angular unit tests (headless Chrome)

# Utilities
just worktree-new     # Create a worktree with Angular deps installed (prevents LSP false positives)
```

## Development Standards

- Always use latest stable versions of Rust and Node.js dependencies
- Health data is sensitive — strict access controls required
- Neurodivergent support principles: gradual exposure, sensory-friendly, customizable
- **Never leave a known issue in code without a tracking GitHub issue** — if a bug, limitation, or tech debt is identified and not fixed immediately, open an issue before moving on

## Decision Making

**Handle independently**: routine coding, bug fixes, tests, documentation, minor refactoring, dependency updates, README changes.

**Escalate to human**: major architecture decisions, core data model changes, security decisions, significant scope changes.

## GitHub Actions (Issue Fixes)

When invoked via GitHub Actions to fix an issue:
1. Fix the issue on a new branch
2. Run `just verify` to confirm quality passes
3. **Always open a PR** using `gh pr create` — do not just push and stop
4. Reference the issue with "Closes #N" in the PR description

## Environment Variables

See `.env.example` for local development defaults. Secrets are managed via Doppler (`plnd/dev`) — do not hardcode credentials in TOML or compose files.
