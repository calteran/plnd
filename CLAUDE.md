# CLAUDE.md

Claude Code configuration for the PLND project. See AGENTS.md for full agent directives and PLANNING.md for the development roadmap.

## Project Overview

PLND ("planned") is a neurodivergent-focused planner/assistant for managing nutrition, exercise, and daily planning. It consists of a Rust/Axum backend (`plnd_api`) and an Angular frontend (`plnd_client`).

- **Current Phase**: Phase 2.5 — Remaining Planning UI (in progress)
- **Phase 1**: Foundation — COMPLETED (auth, database, basic API, Angular shell)
- **Phase 2**: Core Features — COMPLETED (domain model, catalog/library API, external providers)

> See [DOMAIN_MODEL.md](DOMAIN_MODEL.md) for domain architecture.

## Critical Rules

### Testing
- **NEVER run `just test`** — it launches interactive processes that do not terminate
- **ALWAYS use `just test-ci`** for all testing (runs nextest + headless Angular)
- Angular-only: `just test-ng-headless`

### Server Processes
- **NEVER run `cargo run` directly**
- Use `just verify-build` to check compilation
- Use `just test-run-server` to test startup (auto-kills after 15s)

### Branch Discipline
- **NEVER commit directly to `main`** — always work on a feature or fix branch and open a PR

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

# Testing (CI-safe)
just test-ci          # All tests: nextest + headless Angular
just test-ng-headless # Angular unit tests (headless Chrome)

# Utilities
just build            # Build all services
just clean            # Clean build artifacts
just stop             # Stop running services
just logs             # View service logs
```

## Development Standards

- Always use latest stable versions of Rust and Node.js dependencies
- Health data is sensitive — strict access controls required
- Neurodivergent support principles: gradual exposure, sensory-friendly, customizable

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
