# Verify Pipeline Redesign

**Date:** 2026-04-02
**Status:** Approved

## Context

`just verify` is the full-project quality gate run before every commit. It currently runs all checks sequentially, including a Docker build of the Angular client image, resulting in wall times of 5–15+ minutes. Two problems prompted this redesign:

1. **Speed:** Sequential execution and unnecessary Docker image builds are the primary bottlenecks. With parallelization and native service execution, sub-2-minute runs are achievable on warm incremental caches.
2. **Concurrency (Phase 2):** Multiple AI agents working in separate worktrees on the same machine conflict on ports 3000, 4200, 5432, and 8080. A semaphore system will serialize verify runs without requiring port remapping.

This design covers **Phase 1 (speed)** only. Phase 2 is designed here for reference but deferred.

## Design Philosophy

CI optimizes for unhappy-path speed: lints run before the build so cheap checks catch failures early. Local verify optimizes for happy-path speed: the developer believes the work is done and wants the green light as fast as possible. This means the e2e path — the final gate — is the scheduling priority.

## Phase 1: Parallelized Verify Pipeline

### Architecture

`just verify` delegates entirely to `scripts/verify.sh`. The Justfile recipes (`just clippy`, `just fmt`, etc.) remain unchanged and individually usable. The script owns all orchestration.

The existing `services-up` recipe (which builds a client Docker image) is replaced. A new `test-e2e-native` recipe handles the non-Docker e2e path for manual use. The old Docker-based recipes are retained for debugging.

### Execution Model

Everything fires immediately. The only sequencing constraints are within the cargo track (which holds `target/` file locks) and the e2e gate (which needs the binary and healthy services).

```
Fire immediately (all parallel):
  ├── cargo fmt --check
  ├── cargo deny
  ├── cargo machete
  ├── eslint
  ├── ts-deps (check-dependencies, check-licenses, check-circular)
  ├── ng test --headless (Angular unit tests with coverage)
  ├── docker run plnd-verify-db     (postgres:15, --rm, fresh each run)
  ├── docker run plnd-verify-oauth  (mock-oauth2-server, --rm)
  └── cargo build --workspace       ← critical path; gates e2e

After cargo build:
  └── cargo nextest --workspace → cargo clippy   (sequential; background; don't gate e2e)

E2E gate (cargo build done AND services healthy):
  ├── health-check: postgres + mock-oauth
  ├── doppler run -- API binary (localhost URL overrides)
  ├── health-check: API /health
  └── playwright e2e:ci  (playwright starts ng serve itself via webServer config)

Final gate: collect exit codes from all background jobs; fail if any non-zero
```

### Service Management

Supporting services run as isolated Docker containers, not via docker compose:

```bash
docker run --rm -d --name plnd-verify-db \
  -p 5432:5432 \
  -e POSTGRES_USER=plnd \
  -e POSTGRES_PASSWORD="$VERIFY_DB_PASS" \
  -e POSTGRES_DB=plnd_dev \
  postgres:15

docker run --rm -d --name plnd-verify-oauth \
  -p 8080:8080 \
  -e ISSUER_ID=plnd-dev \
  -e INTERACTIVE_LOGIN=true \
  -e JSON_CONFIG=true \
  -v "$PROJECT_ROOT/config/mock-oauth:/config" \
  ghcr.io/navikt/mock-oauth2-server:3.0.1
```

`VERIFY_DB_PASS` is a hardcoded ephemeral password (`plnd_verify_local`) used only for these short-lived containers. No Doppler secret is needed for postgres itself; Doppler still provides JWT secrets and other real credentials to the API.

The `--rm` flag auto-removes containers on stop — a safety net independent of the cleanup trap.

### Native API Invocation

The API binary is run natively with two env var overrides vs. the Doppler-managed Docker config:

```bash
doppler run -- sh -c '
  APP_DATABASE__URL="postgres://plnd:'"$VERIFY_DB_PASS"'@localhost:5432/plnd_dev" \
  APP_AUTH__OIDC_INTERNAL_ISSUER_URL="http://localhost:8080/plnd-dev" \
  APP_AUTH__FRONTEND_ORIGIN="http://localhost:4200" \
  ./target/debug/plnd_api
' &
API_PID=$!
```

The Angular `environment.ts` already uses `localhost:3000` and `localhost:8080` — no changes needed to client configuration.

### Error Handling and Cleanup

```bash
cleanup() {
    [[ -n "${API_PID:-}" ]] && kill "$API_PID" 2>/dev/null || true
    docker rm -f plnd-verify-db plnd-verify-oauth 2>/dev/null || true
}
trap cleanup EXIT INT TERM
```

Parallel job exit codes are collected via PID tracking:

```bash
wait_all() {
    local status=0
    for pid in "$@"; do
        wait "$pid" || status=$?
    done
    return $status
}
```

All jobs run to completion (no fast-fail on first lint error). All failures are reported before the script exits non-zero. This is intentional — wasted compute is acceptable; incomplete feedback is not.

### Health Checks

```bash
# Postgres
timeout 30s bash -c 'until pg_isready -h localhost -U plnd 2>/dev/null; do sleep 1; done'

# Mock OAuth
timeout 30s bash -c 'until curl -sf http://localhost:8080/plnd-dev/.well-known/openid-configuration >/dev/null; do sleep 1; done'

# API
timeout 30s bash -c 'until curl -sf http://localhost:3000/health >/dev/null; do sleep 1; done'
```

### Files Changed

| File | Change |
|------|--------|
| `scripts/verify.sh` | New — orchestration script |
| `Justfile` | `verify` delegates to script; add `test-e2e-native`; keep old recipes |

> `pg_isready` (used in the postgres health check) comes from `libpq` — installed by `just init` in Phase 2. The fallback until then is `docker exec plnd-verify-db pg_isready -U plnd`.

## Phase 2: Semaphore + `just init` (Deferred)

### Semaphore

When multiple agents run concurrently on the same machine, a single flock guard at the top of `verify.sh` serializes runs without requiring port remapping:

```bash
exec 9>/tmp/plnd-verify.lock
if ! flock -n 9; then
    echo "⏳ Another verify is running — waiting for lock..."
    flock 9
fi
```

`flock` is a Linux utility — not available on macOS by default. `just init` installs it via `brew install util-linux`. The lock releases automatically on script exit (any cause). No additional cleanup needed.

### `just init`

A new `just init` recipe sets up all local dev tooling in a single command. Intended for new developers and AI agents starting fresh on the repo.

```
just init installs:
  brew:
    util-linux        ← flock (semaphore, Phase 2)
    libpq             ← pg_isready (health check in verify.sh)
    doppler           ← secrets CLI (if not present)
  cargo:
    cargo-nextest     ← fast test runner
    cargo-deny        ← license + advisory checks
    cargo-machete     ← unused dependency detection
  npm (plnd_client):
    npm ci            ← install dependencies
    playwright install chromium  ← e2e browser
```

The recipe is idempotent — safe to re-run. Brew installs skip if already present (`brew install` is a no-op when the formula is up to date).

### Additional Files Changed

| File | Change |
|------|--------|
| `Justfile` | Add `init` recipe |

## Verification

End-to-end test of the new pipeline:

1. Run `just verify` from a clean worktree — confirm all phases complete and exit 0
2. Introduce a lint error (e.g., unused import) — confirm verify exits non-zero and reports the failure
3. Introduce a test failure — confirm verify exits non-zero
4. Introduce an e2e failure — confirm verify exits non-zero
5. Kill a mid-run verify with Ctrl-C — confirm containers are removed (`docker ps` shows no plnd-verify-* containers)
6. Run `just clippy` standalone — confirm it still works independently
7. Time three consecutive runs on warm cache — target under 2 minutes
