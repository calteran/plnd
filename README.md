# PLND - Neurodivergent Planner/Assistant

A structured yet flexible planner/assistant designed for neurodivergent individuals to manage nutrition, exercise, and daily planning.

PLND (pronounced "planned") provides structured planning with extensive customization options, gradual exposure features, and sensory-friendly interfaces to help neurodivergent individuals who are picky eaters or struggle with nutrition and exercise.

## Development Status

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Foundation — Rust/Axum backend, Angular frontend, Docker stack, auth | ✅ Complete |
| Phase 2 | Core Features — domain model schema, catalog/library API, external providers, secrets management | ✅ Complete |
| Phase 2.5 | Remaining Planning UI — meal planning, exercise planning, family support | 🔄 In Progress |
| Phase 3+ | AI enhancements, integrations, mobile, deployment | Planned |

See [PLANNING.md](PLANNING.md) for the full roadmap.

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

# Testing
just test-ci          # All tests: Rust nextest + headless Angular

# Utilities
just build            # Build all services
just clean            # Clean build artifacts
just stop             # Stop running services
just logs             # View service logs
```

> **Note**: Never run `just test` directly — it launches interactive processes that do not terminate. Always use `just test-ci`.

## Documentation

- [PLANNING.md](PLANNING.md) — Architecture and development roadmap
- [DOMAIN_MODEL.md](DOMAIN_MODEL.md) — Authoritative domain and scheduling model (meal/exercise hierarchy, catalog layer, schedule templates)
- [CLAUDE.md](CLAUDE.md) — Agent configuration and project conventions
- [AGENTS.md](AGENTS.md) — Agent maintenance directives

## License

This is a proprietary project and is not licensed for use by anyone except the creator.
