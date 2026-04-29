# PLND - Neurodivergent Planner/Assistant

A structured yet flexible planner/assistant designed for neurodivergent individuals to manage nutrition, exercise, and daily planning.

PLND (pronounced "planned") provides structured planning with extensive customization options, gradual exposure features, and sensory-friendly interfaces to help neurodivergent individuals who are picky eaters or struggle with nutrition and exercise.

## Development Status

Phase 3.3 — meal planning wizard — is complete. Phase 3.5 (background agent jobs) is the next planned increment.

See [docs/architecture.md](docs/architecture.md) for the design reference and current roadmap.

## Tech Stack

- **Backend**: Rust + Axum, PostgreSQL 15, SQLx (port 3000)
- **Frontend**: Angular 21 + NgRx, signals-based state (port 4200)
- **Auth**: OIDC via navikt/mock-oauth2-server (port 8080), angular-oauth2-oidc (PKCE)
- **Infrastructure**: Docker Compose, Nginx reverse proxy
- **Secrets**: Doppler (`plnd/dev`)

## Available Commands

```bash
# Development
just dev              # Start full Docker stack
just api              # Run API only
just client           # Run Angular dev server

# Quality checks
just fmt              # Rust formatting
just clippy           # Rust linting
just deny             # Dependency security/license check
just machete          # Unused dependency detection
just ts-lint          # TypeScript/Angular ESLint
just ts-deps          # TypeScript dependency health

# Verification
just verify           # Full quality + build + tests (run before every commit)
just verify-build     # Compile check only (safe, no server)
just test-run-server  # Server startup test (15s timeout, auto-kills)

# Utilities
just build            # Build all services
just clean            # Clean build artifacts
just stop             # Stop running services
just logs             # View service logs
```

## Documentation

- [docs/architecture.md](docs/architecture.md) — Living architecture reference: vision, domain model, scheduling, agent design, frontend, roadmap
- [CLAUDE.md](CLAUDE.md) — Agent configuration and project conventions
- [AGENTS.md](AGENTS.md) — Agent maintenance directives
- [CONTRIBUTING.md](CONTRIBUTING.md) — Contribution guidelines

Dated specs and implementation plans under `docs/superpowers/specs/` and `docs/superpowers/plans/` are point-in-time artifacts; see the README in each directory.

## License

This is a proprietary project and is not licensed for use by anyone except the creator.
