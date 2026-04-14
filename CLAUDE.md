# CLAUDE.md

Claude Code configuration for the PLND project. See AGENTS.md for full agent directives and PLANNING.md for the development roadmap.

## Project Overview

PLND ("planned") is a neurodivergent-focused planner/assistant for managing nutrition, exercise, and daily planning. It consists of a Rust/Axum backend (`plnd_api`) and an Angular frontend (`plnd_client`).

- **Current Phase**: Phase 3.2 — COMPLETED (intent-driven task entry shipped; Phase 3.3 Meal Planning Wizard is next)
- **Phase 1**: Foundation — COMPLETED (auth, database, basic API, Angular shell)
- **Phase 2**: Core Features — COMPLETED (domain model, catalog/library API, external providers)

- **Repository**: https://github.com/calteran/plnd

> See [DOMAIN_MODEL.md](DOMAIN_MODEL.md) for domain architecture.

## Critical Rules

### Testing
- **NEVER run `just test` or `just test-ci`** — both have been removed from the justfile
- **ALWAYS use `just verify`** for pre-commit validation (parallel pipeline: quality + build + tests + e2e)
- Unit tests only: `just test-ng-headless` (Angular) or `cargo nextest run --workspace` (Rust)

### Server Processes
- **NEVER run `cargo run` directly**
- Use `just verify-build` to check compilation
- Use `just test-run-server` to test startup (auto-kills after 15s)

### Branch Discipline
- **NEVER commit directly to `main`** — always work on a feature or fix branch and open a PR
- **ALWAYS branch from `main`** — never base a branch on another feature branch; this avoids merge conflicts and spurious commits when the parent branch merges

### Before Every Commit
Run `just verify` — this executes the full quality suite and must pass cleanly.

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
just build            # Build all services
just clean            # Clean build artifacts
just stop             # Stop running services
just logs             # View service logs
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
