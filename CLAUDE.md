# CLAUDE.md

Claude Code configuration for the PLND project. See [docs/architecture.md](docs/architecture.md) for the design reference (vision, domain model, scheduling, agent architecture, roadmap).

## Project Overview

PLND ("planned") is a neurodivergent-focused planner/assistant for managing nutrition, exercise, and daily planning. It consists of a Rust/Axum backend (`plnd_api`) and an Angular frontend (`plnd_client`).

- **Current Phase**: Phase 3.3 — COMPLETED (AI-powered meal planning wizard shipped; Phase 3.5 Background Agent Jobs is next)

- **Repository**: https://github.com/calteran/plnd

> See [docs/architecture.md](docs/architecture.md) for the controlling design reference. Dated specs under `docs/superpowers/` are point-in-time artifacts, not authoritative.

## Critical Rules

### Testing
- **NEVER run `just test` or `just test-ci`** — both have been removed from the justfile
- **ALWAYS use `just verify`** for pre-commit validation (parallel pipeline: quality + build + tests + e2e)
  - Exception: documentation-only changes (`.md` files, `docs/`) do not require `just verify`
  - **Run `just fmt` (Rust) and let lint autofix run before `just verify`** — `verify` includes `cargo fmt --check`, which fails on any unformatted Rust and aborts the whole (slow) pipeline. Formatting first — especially after AI-generated edits, which frequently aren't pre-formatted — avoids burning a full verify run on a formatting-only failure.
- **`just verify` is ISOLATED, not serialized — there is no flock semaphore.** Each run uses a per-run database (`plnd_verify_<runid>`) on the shared Postgres plus ephemeral ports for the API/`ng serve`/Karma, so multiple agents can `just verify` in parallel across worktrees with no conflict. Do not look for or wait on a lock; do not kill a PID on `:3000` for verify's sake (verify never uses `:3000`).
- **Run `just persist` once per work session** to bring up the shared infra (db + mock-oauth + observability). `just verify` auto-ensures db+oauth if missing but never tears infra down; the observability stack (for per-run telemetry in Grafana) only comes up via `just persist`.
- **Subsets for fast, still-isolated checks:** `just verify {quick,rust,ts,e2e}` (default `all`). `quick` needs no infra; `rust`/`e2e` use the shared Postgres; `e2e` adds an isolated API + `ng serve`.
- **`just stop` / `just clean` are HUMAN-ONLY** — they run `docker compose down -v`, wiping shared infra used by every running verify. Agents must never invoke them; the interactive confirmation prompt aborts non-interactive (agent) callers by design.
- Unit tests only: `just test-ng-headless` (Angular)
- **All tests must pass before committing** — a failing test is never acceptable, regardless of whether you introduced it. There is no such thing as a "pre-existing" failure that can be ignored or dismissed. Fix every failing test before opening a PR.
- **E2E tests perform the full real auth flow** via `mintTestToken()` in `plnd_client/e2e/helpers/auth.ts`: mint an OIDC token from `mock-oauth-server`, exchange it at `${API_BASE}/auth/token` for a backend HS256 JWT, store that. The e2e endpoints are env-configurable (`API_BASE`, `NG_PORT`) and default to `:3000`/`:4200`: under `just verify` the API and `ng serve` run on per-run **ephemeral** ports (verify sets `API_BASE`/`NG_PORT` accordingly), while mock-oauth stays shared at `:8080`. For a standalone `npx playwright test`, the API must already be running on `:3000` (`just api` / `just dev`) — Playwright's `globalSetup` is skipped under `CI` (which `just verify` sets) and otherwise brings up `db` + `mock-oauth-server` and probes the API at `API_BASE`. New tests should call `seedAuth(page)`, `seedOnboarding(page)`, or `injectAuthToken(page)` — never hardcode a synthetic token string.
- **`/briefing/*` and catalog/search endpoints are served by the real backend in e2e**, not by `page.route()` mocks. `just verify` sets `APP_EXTERNAL__FIXTURE_PATH=plnd_data/fixtures` so weather, news, nutrition (USDA + Open Food Facts), and recipes (TheMealDB) all come from captured upstream responses (file-backed providers gated by `#[cfg(debug_assertions)]`). The same gate also routes the startup catalog seeder through fixtures so `catalog_ingredients` / `catalog_dishes` populate without live API calls. Run `just refresh-fixtures` to re-capture from Open-Meteo, the configured RSS feeds, USDA FDC, Open Food Facts, and TheMealDB when responses drift — requires `APP_EXTERNAL__USDA_FDC_API_KEY` via Doppler.
- **E2E mock policy** — only LLM/agent endpoints and genuinely external services may be mocked. User data, configuration, and schedule state flow through the real backend. Tests achieve isolation via per-test user accounts, not by DB-level partitioning. Seed data via real API helpers (e.g. `seedScheduleEntries` in `plnd_client/e2e/helpers/seed-data.ts`) rather than extending `/test/seed`. See `docs/architecture.md` §9.7 for the controlling policy.

### Shell Commands
- **Never chain `cd` with `&&`** — run `cd <dir>` as a standalone command first, then follow with subsequent commands separately; this avoids triggering a permission prompt on every compound command
- **For git commands in worktrees, prefer `git -C <path>`** — e.g. `git -C /path/to/worktree add ...` rather than `cd /path && git add ...`; the `-C` flag passes the working tree directly without a shell directory change, avoiding the untrusted-hooks security prompt entirely

### Pointing the User at Documents to Review
- **Always cite review documents by their path relative to the repository root, not relative to the worktree** — when you surface a spec, plan, or any file for the user to read (e.g. when the brainstorming workflow pauses for review), include the worktree prefix: `.worktrees/<branch>/docs/plan.md`, never the worktree-relative `docs/plan.md`. The user runs several agents in separate worktrees concurrently, and only the full root-relative path tells them *which* worktree's document to open.

### Server Processes
- **NEVER run `cargo run` directly**
- Use `just verify-build` to check compilation
- Use `just test-run-server` to test startup (auto-kills after 15s; binds an ephemeral port, never `:3000`)

### Branch Discipline
- **NEVER commit directly to `main`** — always work on a feature or fix branch and open a PR
- **ALWAYS branch from `main`** — never base a branch on another feature branch; this avoids merge conflicts and spurious commits when the parent branch merges
- **ALWAYS rebase onto `origin/main` before every push** — both the initial push that opens a PR and any subsequent push (e.g. after applying reviewer fixes): `git fetch origin && git rebase origin/main`, then `git push --force-with-lease`. This keeps PR history linear and avoids merge commits.

### PR Lifecycle
- **After opening a PR**: invoke the `monitor-pr` skill to watch CI and address any review comments
- **After a PR merges**: `git checkout main && git pull`, remove the worktree if one was used (the native worktree tool places them under `.claude/worktrees/`; clean up with `ExitWorktree` or `git worktree remove`), then delete the local branch (`git branch -d <branch>`)

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
just persist          # Bring up shared infra once per session (db + mock-oauth + observability)
just dev              # Start full Docker stack
just api              # Run API only (cargo, :3000)
just client           # Run Angular dev server (:4200)

# Quality (run individually or all at once)
just fmt              # Rust formatting
just clippy           # Rust linting
just deny             # Dependency security/license check
just machete          # Unused dependency detection
just msrv             # MSRV declaration check — run after bumping deps or using new Rust features
just ts-lint          # TypeScript/Angular ESLint
just ts-deps          # TypeScript dependency health

# Verification
just verify-build     # Compile check only (safe, no server)
just test-run-server  # Server startup test (15s timeout, auto-kills)
just verify           # Full quality + build + tests (run before every commit); isolated, no semaphore
just verify quick     # Subset: read-only checks, no infra (also: rust | ts | e2e)

# Testing (unit tests only — use verify for full pre-commit validation)
just test-ng-headless # Angular unit tests (headless Chrome)

# Utilities
just install-deps     # Install Angular deps in the current worktree (run after the native worktree tool; prevents LSP false positives)
```

## Development Standards

- Always use latest stable versions of Rust and Node.js dependencies
- **Use current Rust idioms freely** — do not avoid modern language features (e.g., `impl Trait` in return position, `let`-chains, async closures) to artificially preserve a low MSRV. When adopting a feature that requires a newer compiler, update the affected crate's `rust-version` field in its `Cargo.toml` and run `just msrv` to confirm the declaration is accurate. Advancing the MSRV is normal maintenance, not a breaking change.
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
