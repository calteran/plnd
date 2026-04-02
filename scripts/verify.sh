#!/usr/bin/env bash
# scripts/verify.sh — Parallel verification pipeline
#
# Execution model:
#   • Everything fires immediately in parallel.
#   • `cargo build` runs synchronously (critical path — gates e2e).
#   • After build: nextest → clippy run in background (don't gate e2e).
#   • E2E starts once build + services are healthy.
#   • Final gate collects all background job exit codes.
#
# Services: ephemeral docker containers (--rm, auto-removed on stop).
# Cleanup trap fires on EXIT, INT, and TERM.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

VERIFY_DB_PASS="plnd_verify_local"
VERIFY_DB_NAME="plnd-verify-db"
VERIFY_OAUTH_NAME="plnd-verify-oauth"
API_PID=""

declare -a JOB_PIDS=()
declare -a JOB_LABELS=()

# ── Cleanup ────────────────────────────────────────────────────────────────────
cleanup() {
    for pid in "${JOB_PIDS[@]+"${JOB_PIDS[@]}"}"; do
        kill "$pid" 2>/dev/null || true
    done
    if [[ -n "${API_PID:-}" ]]; then kill "$API_PID" 2>/dev/null || true; fi
    docker rm -f "$VERIFY_DB_NAME" "$VERIFY_OAUTH_NAME" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ── Prerequisite check ─────────────────────────────────────────────────────────
if ! command -v timeout &>/dev/null; then
    echo "✗ 'timeout' not found — install coreutils: brew install coreutils" >&2
    exit 1
fi
if ! command -v flock &>/dev/null; then
    echo "✗ 'flock' not found — install flock: brew install flock" >&2
    exit 1
fi

# ── Semaphore: serialize concurrent verify runs ────────────────────────────────
LOCK_FILE="/tmp/plnd-verify.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    echo "⏳ Another verify is running — waiting for lock..."
    flock 9
fi

# ── PID tracking ──────────────────────────────────────────────────────────────
# Usage: some_command & track $! "human-readable label"
track() {
    JOB_PIDS+=("$1")
    JOB_LABELS+=("$2")
}

# Wait for all tracked jobs; report failures; return non-zero if any failed.
# Each PID is waited exactly once, so call this only once per set of tracked jobs.
wait_all() {
    local status=0 i
    for i in "${!JOB_PIDS[@]}"; do
        if ! wait "${JOB_PIDS[$i]}" 2>/dev/null; then
            echo "  ✗ FAILED: ${JOB_LABELS[$i]}"
            status=1
        fi
    done
    JOB_PIDS=()
    JOB_LABELS=()
    return $status
}

echo "◆ Starting verification..."

# ── Fire everything immediately ───────────────────────────────────────────────
echo "→ Launching checks, services, and build in parallel..."

# Supporting services — ephemeral, auto-removed when stopped (--rm)
docker run --rm -d \
    --name "$VERIFY_DB_NAME" \
    -p 5432:5432 \
    -e POSTGRES_USER=plnd \
    -e POSTGRES_PASSWORD="$VERIFY_DB_PASS" \
    -e POSTGRES_DB=plnd_dev \
    postgres:15 > /dev/null

docker run --rm -d \
    --name "$VERIFY_OAUTH_NAME" \
    -p 8080:8080 \
    -e ISSUER_ID=plnd-dev \
    -e INTERACTIVE_LOGIN=true \
    -e JSON_CONFIG=true \
    -v "$PROJECT_ROOT/config/mock-oauth:/config" \
    ghcr.io/navikt/mock-oauth2-server:3.0.1 > /dev/null

# Rust read-only checks — no target/ lock, safe to parallelize with anything
(cd "$PROJECT_ROOT" && cargo fmt --check) &
track $! "cargo fmt"

(cd "$PROJECT_ROOT" && cargo deny check) &
track $! "cargo deny"

(cd "$PROJECT_ROOT" && cargo machete) &
track $! "cargo machete"

# TypeScript checks
(cd "$PROJECT_ROOT/plnd_client" && npx eslint "src/**/*.ts" "e2e/**/*.ts") &
track $! "eslint"

(cd "$PROJECT_ROOT/plnd_client" && \
    npm run check-dependencies && \
    npm run check-licenses && \
    npm run check-circular) &
track $! "ts-deps"

# Angular unit tests — fully independent of Rust
(cd "$PROJECT_ROOT/plnd_client" && \
    npx ng test --browsers=ChromeHeadless --watch=false --code-coverage) &
track $! "ng test"

# ── Cargo build (critical path — gates e2e) ────────────────────────────────────
# Runs synchronously. set -e will abort immediately if this fails.
echo "→ Building API binary (critical path)..."
cd "$PROJECT_ROOT"
cargo build --workspace

# After build: start nextest → clippy in background.
# Both share target/ so they must be sequential with each other,
# but neither gates the e2e phase below.
(
    cd "$PROJECT_ROOT"
    status=0
    cargo nextest run --workspace \
        || { echo "  ✗ cargo nextest failed"; status=1; }
    cargo clippy --workspace --all-targets --all-features -- -D warnings \
        || { echo "  ✗ cargo clippy failed"; status=1; }
    exit $status
) &
track $! "nextest → clippy"

# ── E2E gate ──────────────────────────────────────────────────────────────────
echo "→ Waiting for services to be healthy..."

timeout 30s bash -c \
    "until docker exec $VERIFY_DB_NAME pg_isready -U plnd 2>/dev/null; do sleep 1; done"

timeout 30s bash -c \
    'until curl -sf http://localhost:8080/plnd-dev/.well-known/openid-configuration \
     > /dev/null 2>&1; do sleep 1; done'

echo "→ Starting API natively..."
cd "$PROJECT_ROOT/plnd_api"
# doppler provides JWT_SECRET and other real credentials;
# override Docker-specific hostnames with localhost equivalents.
doppler run -- sh -c \
    "APP_DATABASE__URL='postgres://plnd:${VERIFY_DB_PASS}@localhost:5432/plnd_dev' \
     APP_AUTH__OIDC_INTERNAL_ISSUER_URL='http://localhost:8080/plnd-dev' \
     APP_AUTH__FRONTEND_ORIGIN='http://localhost:4200' \
     ../target/debug/plnd_api" &
API_PID=$!

timeout 30s bash -c \
    'until curl -sf http://localhost:3000/health > /dev/null 2>&1; do sleep 1; done'

echo "→ Running e2e tests..."
cd "$PROJECT_ROOT/plnd_client"
# CI=true enables retries and disables interactive reporter.
# Playwright starts ng serve itself via the webServer config.
CI=true npm run e2e:ci

# ── Final gate: collect all background jobs ────────────────────────────────────
echo "→ Collecting background job results..."
wait_all

echo "✅ All verifications passed"
