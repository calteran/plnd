# Junie Guidelines for PLND

## Project Overview
**Project**: PLND - Neurodivergent Planner/Assistant for managing nutrition, exercise, and daily planning.
**Current Phase**: Phase 2 — Core Features (User management, basic planning, routing, layouts).
**Primary Reference**: `PLANNING.md`.
**Architecture**: 
- **Backend**: Rust/Axum (`plnd_api`) with PostgreSQL/SQLx.
- **Frontend**: Angular 21/NgRx (`plnd_client`).
- **Infrastructure**: Docker Compose, PostgreSQL 15, Mock OAuth2 server.

## Core Directives

### 1. Follow Project Roadmap
- ✅ Foundation Phase: Rust backend, authentication, database - COMPLETED
- 🚧 Core Features Phase: User management, meal/exercise planning - IN PROGRESS
- Next: AI Enhancements Phase (agentic architecture, LLM integration)

### 2. Quality & Development Standards
- **MANDATORY**: Run `just verify` before every commit. All quality checks must pass.
- **Code Quality**:
    - Rust: Use `thiserror` for domain errors, `anyhow` for application errors. Use SQLx macros for type-safe queries.
    - Angular: Strict TypeScript typing, NgRx for state management, signals for component state.
    - Coverage: Target 100% test coverage for business logic.
- **Dependency Management**: Use latest stable versions (Rust 1.93.1+, Node 20.x+). Use `just deny` and `just machete` for audits.

### 3. Server & Testing Rules
- **DO NOT** run `cargo run` directly.
- **DO NOT** run `just test` (interactive processes do not terminate).
- **Server Startup**: Use `just test-run-server` (auto-kills after 15s) or `just verify-build`.
- **Testing**: Use `just test-ci` for full suite or `just test-ng-headless` for Angular only.

### 4. Domain-Specific Rules
- **Neurodivergent Support**: Implement gradual exposure, sensory-friendly interfaces, and extensive customization.
- **Data Security**: Treat health data as sensitive. Encrypt health data and follow OWASP Top 10.
- **Nutrition/Exercise**: Use scientifically validated data and strict allergen enforcement.

## Common Commands Reference

```bash
# Development
just dev              # Start full Docker stack
just api              # Run API only
just client           # Run Angular dev server

# Quality & Verification
just fmt              # Rust formatting
just clippy           # Rust linting
just ts-lint          # TypeScript/Angular ESLint
just verify-build     # Compile check only (safe)
just test-run-server  # Server startup test (15s timeout)
just verify           # Full quality + build + tests (MUST PASS)

# Testing (CI-safe)
just test-ci          # All tests (nextest + headless Angular)
just test-ng-headless # Angular unit tests (headless)
```

## Environment & Infrastructure
- **API**: `0.0.0.0:3000`
- **Database**: `postgres://plnd:plnd_dev@localhost/plnd_dev` (Port 5432)
- **Auth**: Mock OAuth2 server on port 8080.
- **Frontend**: Port 4200.
- **Secrets**: Managed via Doppler (`plnd/dev`). Run `just api` / `just dev` — they already wrap commands with `doppler run --`. Do not hardcode secrets in TOML or compose files.

## Decision Making
- **Independent**: Routine coding, bug fixes, tests, documentation, minor refactoring, dependency updates.
- **Escalate**: Major architectural changes, core data model modifications, security decisions, significant scope changes.

## Version History
**1.5** - Added Doppler secrets management; removed stale PHASE_TWO.md reference.
**Last Updated**: 2026-03-12
