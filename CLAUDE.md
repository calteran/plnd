# CLAUDE.md

Claude Code configuration for the PLND project. See AGENTS.md for full agent directives and PLANNING.md for the development roadmap.

## Project Overview

PLND ("planned") is a neurodivergent-focused planner/assistant for managing nutrition, exercise, and daily planning. It consists of a Rust/Axum backend (`plnd_api`) and an Angular frontend (`plnd_client`).

- **Current Phase**: Phase 2 — Core Features (in progress)
- **Phase 1**: Foundation — COMPLETED (auth, database, basic API, Angular shell)

## Critical Rules

### Testing
- **NEVER run `just test`** — it launches interactive processes that do not terminate
- **ALWAYS use `just test-ci`** for all testing (runs nextest + headless Angular)
- Angular-only: `just test-ng-headless`

### Server Processes
- **NEVER run `cargo run` directly**
- Use `just verify-build` to check compilation
- Use `just test-run-server` to test startup (auto-kills after 15s)

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

## Architecture

### Backend: `plnd_api/` (Rust + Axum)

```
src/
├── main.rs              # Entry point, router setup, server bind
├── lib.rs               # Library root
├── config/              # Settings loading, config errors
├── auth/                # JWT, middleware, session, OAuth
│   └── oauth/           # Provider trait, models, mock provider
└── db/                  # Connection pooling, DB errors, models
```

Key routes: `/health`, `/ready`, `/auth/oauth/mock/authorize`, `/auth/oauth/mock/callback`

- Use `thiserror` for domain errors, `anyhow` for application errors
- SQLx macros for type-safe queries with migrations
- Provider-agnostic OAuth via traits

### Frontend: `plnd_client/` (Angular 21 + NgRx)

```
src/app/
├── app.ts / app.config.ts / app.routes.ts
└── core/
    ├── services/         # ConfigService (reactive, validated)
    └── models/           # TypeScript interfaces
```

- Strict TypeScript typing required
- NgRx for state management
- Angular signals for component state

### Infrastructure

- PostgreSQL 15 (port 5432)
- API on port 3000
- Mock OAuth2 server on port 8080 (navikt/mock-oauth2-server)
- Angular dev server on port 4200
- Nginx reverse proxy (production)

Docker Compose handles the full development stack.

## Development Standards

- Always use latest stable versions of Rust and Node.js dependencies
- Health data is sensitive — strict access controls required
- Neurodivergent support principles: gradual exposure, sensory-friendly, customizable

## Decision Making

**Handle independently**: routine coding, bug fixes, tests, documentation, minor refactoring, dependency updates, README changes.

**Escalate to human**: major architecture decisions, core data model changes, security decisions, significant scope changes.

## Environment Variables

See `.env.example`:

```
APP_API__BASE_URL=0.0.0.0:3000
APP_DATABASE__URL=postgres://plnd:plnd_dev@localhost/plnd_dev
APP_DATABASE__MAX_CONNECTIONS=10
APP_LOGGING__LEVEL=info
```

## Phase 2 Work

Five parallel feature tracks (see `PHASE_TWO.md`):
- **Team A**: Core infrastructure, routing, layouts, theming
- **Team B**: Authentication UI, user profile management
- **Team C**: Meal planning CRUD and UI
- **Team D**: Exercise planning CRUD and UI
- **Team E**: LLM integration and family support
