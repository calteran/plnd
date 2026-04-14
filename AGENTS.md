# Agent Guidelines for PLND

See [PLANNING.md](PLANNING.md) for the current roadmap and [CLAUDE.md](CLAUDE.md) for commands and critical rules.

## Quality & Development Standards

- **MANDATORY**: Run `just verify` before every commit. All quality checks must pass.
- **Rust**: Use `thiserror` for domain errors, `anyhow` for application errors. Use SQLx for type-safe queries.
- **Angular**: Strict TypeScript typing, NgRx for state management, signals for component state. Use `inject()` (not constructor injection).
- **Dependencies**: Use latest stable versions. Run `just deny` and `just machete` for audits.

## Server & Testing Rules

- **DO NOT** run `cargo run` directly.
- **DO NOT** run `just test` (interactive processes do not terminate).
- **DO NOT** commit directly to `main` — always work on a feature or fix branch and open a PR.
- **Server Startup**: Use `just test-run-server` (auto-kills after 15s) or `just verify-build`.
- **Testing**: Use `just verify` for full suite or `just test-ng-headless` for Angular only.

## Domain-Specific Rules

- **Neurodivergent Support**: Implement gradual exposure, sensory-friendly interfaces, and extensive customization options.
- **Data Security**: Treat all health data as sensitive. Enforce strict access controls and follow OWASP Top 10.
- **Secrets**: Managed via Doppler (`plnd/dev`). Do not hardcode credentials anywhere.

## Decision Making

- **Independent**: Routine coding, bug fixes, tests, documentation, minor refactoring, dependency updates.
- **Escalate**: Major architectural changes, core data model modifications, security decisions, significant scope changes.
