#!/usr/bin/env bash
# scripts/verify.sh — Parallel verification pipeline
#
# Execution model:
#   • All jobs fire immediately, in parallel where safe.
#   • Output for every job is captured; terminal shows only ✓/✗ lines.
#   • On failure the full captured log is dumped under the ✗ line.
#   • Completions appear in real-time via a named FIFO + reader process.
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
API_LOG=""
READER_PID=""
FIFO=""

declare -a JOB_PIDS=()
declare -a JOB_TMPFILES=()

# ── Cleanup ────────────────────────────────────────────────────────────────────
cleanup() {
    exec 3>&- 2>/dev/null || true   # close FIFO write-end → reader gets EOF
    exec 9>&- 2>/dev/null || true   # release flock
    for pid in "${JOB_PIDS[@]+"${JOB_PIDS[@]}"}"; do
        kill "$pid" 2>/dev/null || true
    done
    if [[ -n "${API_PID:-}" ]]; then kill "$API_PID" 2>/dev/null || true; fi
    if [[ -n "${READER_PID:-}" ]]; then wait "$READER_PID" 2>/dev/null || true; fi
    for f in "${JOB_TMPFILES[@]+"${JOB_TMPFILES[@]}"}"; do
        rm -f "$f" 2>/dev/null || true
    done
    docker rm -f "$VERIFY_DB_NAME" "$VERIFY_OAUTH_NAME" 2>/dev/null || true
    [[ -n "${FIFO:-}" ]] && rm -f "$FIFO" 2>/dev/null || true
    [[ -n "${API_LOG:-}" ]] && rm -f "$API_LOG" 2>/dev/null || true
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
if ! docker info &>/dev/null; then
    echo "✗ Docker is not running — start Docker Desktop and retry" >&2
    exit 1
fi

# ── Semaphore: serialize concurrent verify runs ────────────────────────────────
LOCK_FILE="/tmp/plnd-verify.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    echo "⏳ Another verify is running — waiting for lock..."
    flock 9
fi

# ── FIFO completion bus ────────────────────────────────────────────────────────
# Each job writes one record: EXIT_CODE|LABEL|TMPFILE
# Reader prints ✓/✗ in real-time; exits on EOF (all writers closed).
FIFO=$(mktemp -u /tmp/plnd-verify-bus-XXXXXX)
mkfifo "$FIFO"

{
    while IFS='|' read -r status label tmpfile; do
        if [[ "$status" == "0" ]]; then
            echo "  ✓ $label"
        else
            echo "  ✗ FAILED: $label"
            if [[ -f "$tmpfile" && -s "$tmpfile" ]]; then
                sed 's/^/    /' "$tmpfile"
            fi
        fi
        rm -f "$tmpfile" 2>/dev/null || true
    done
} < "$FIFO" &
READER_PID=$!
exec 3>"$FIFO"   # keep main write-end open until we explicitly close it

# ── Helpers ───────────────────────────────────────────────────────────────────

# NOTE: label must not contain '|' — it is the FIFO record field delimiter.

# run_job label workdir cmd [args...]
# Runs cmd in the background. Captures stdout+stderr to a tmpfile.
# Reports exit status + log path via FIFO when complete.
run_job() {
    local label="$1" workdir="$2"; shift 2
    local tmpfile
    tmpfile=$(mktemp /tmp/plnd-verify-XXXXXX)
    JOB_TMPFILES+=("$tmpfile")
    (
        exec 9>&-           # release lock fd in this subshell (main process keeps it)
        local status=0
        { (cd "$workdir" && "$@") 3>&-; } > "$tmpfile" 2>&1 || status=$?
        printf '%s|%s|%s\n' "$status" "$label" "$tmpfile" >&3
        exit $status
    ) &
    JOB_PIDS+=($!)
}

# run_sync label workdir cmd [args...]
# Runs cmd synchronously. Captures stdout+stderr to a tmpfile.
# Reports via FIFO when complete. On failure, exits the script (triggers cleanup).
run_sync() {
    local label="$1" workdir="$2"; shift 2
    local tmpfile status=0
    tmpfile=$(mktemp /tmp/plnd-verify-XXXXXX)
    JOB_TMPFILES+=("$tmpfile")
    { (cd "$workdir" && "$@") > "$tmpfile" 2>&1; } || status=$?
    printf '%s|%s|%s\n' "$status" "$label" "$tmpfile" >&3
    if [[ $status -ne 0 ]]; then
        exit 1
    fi
}

# wait_all — waits for all tracked background jobs; returns non-zero if any failed.
# Printing is handled by the reader as each job completes.
wait_all() {
    local overall=0 pid
    for pid in "${JOB_PIDS[@]+"${JOB_PIDS[@]}"}"; do
        wait "$pid" 2>/dev/null || overall=1
    done
    JOB_PIDS=()
    return $overall
}

echo "◆ Starting verification..."

# ── Kill any leftover containers from a previous run ──────────────────────────
docker rm -f "$VERIFY_DB_NAME" "$VERIFY_OAUTH_NAME" 2>/dev/null || true

# ── Launch supporting services ─────────────────────────────────────────────────
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
    ghcr.io/navikt/mock-oauth2-server:3.0.3 > /dev/null

# ── Rust read-only checks — no target/ lock, safe to parallelize ───────────────
run_job "cargo fmt"     "$PROJECT_ROOT" cargo fmt --check
run_job "cargo deny"    "$PROJECT_ROOT" cargo deny check
run_job "cargo machete" "$PROJECT_ROOT" cargo machete

# ── TypeScript setup — install deps synchronously so all TS jobs can fork cleanly
run_sync "npm ci" "$PROJECT_ROOT/plnd_client" npm ci

# ── TypeScript checks (parallel, gated on npm ci) ─────────────────────────────
run_job "eslint"  "$PROJECT_ROOT/plnd_client" \
    npx eslint "src/**/*.ts" "e2e/**/*.ts"

run_job "ts-deps" "$PROJECT_ROOT/plnd_client" bash -c \
    "npm run check-dependencies && npm run check-licenses && npm run check-circular"

run_job "ng test" "$PROJECT_ROOT/plnd_client" \
    npx ng test --browsers=ChromeHeadless --watch=false --code-coverage

# ── Cargo build (critical path — gates nextest, clippy, and e2e) ───────────────
run_sync "cargo build" "$PROJECT_ROOT" cargo build --workspace

# ── Services must be healthy before nextest — sqlx::test creates per-test DBs ──
wait_for_services() {
    timeout 30s bash -c \
        "until docker exec $VERIFY_DB_NAME pg_isready -U plnd 2>/dev/null; do sleep 1; done"
    timeout 30s bash -c \
        'until curl -sf http://localhost:8080/plnd-dev/.well-known/openid-configuration \
         > /dev/null 2>&1; do sleep 1; done'
}
run_sync "services healthy" "$PROJECT_ROOT" wait_for_services

# ── Post-build: nextest → clippy (sequential within, parallel with e2e) ────────
# DATABASE_URL is required by sqlx::test to create isolated per-test databases.
run_job "nextest → clippy" "$PROJECT_ROOT" bash -c \
    "DATABASE_URL='postgres://plnd:${VERIFY_DB_PASS}@localhost:5432/plnd_dev' \
     cargo nextest run --workspace && \
     cargo clippy --workspace --all-targets --all-features -- -D warnings"

# ── E2E gate: start API, run e2e (services already verified healthy above) ─────

API_LOG=$(mktemp /tmp/plnd-verify-api-XXXXXX)
cd "$PROJECT_ROOT/plnd_api"
# Close fd 3 (FIFO write-end) in the API subprocess so the reader can see
# EOF once the main script closes fd 3.  Without this, the API process keeps
# the write-end open and `wait "$READER_PID"` hangs indefinitely.
doppler run -- sh -c \
    "APP_DATABASE__URL='postgres://plnd:${VERIFY_DB_PASS}@localhost:5432/plnd_dev' \
     APP_AUTH__OIDC_INTERNAL_ISSUER_URL='http://localhost:8080/plnd-dev' \
     APP_AUTH__FRONTEND_ORIGIN='http://localhost:4200' \
     exec ../target/debug/plnd_api" \
    > "$API_LOG" 2>&1 3>&- &
API_PID=$!
cd "$PROJECT_ROOT"

wait_for_api() {
    if ! timeout 30s bash -c \
        'until curl -sf http://localhost:3000/health > /dev/null 2>&1; do sleep 1; done'
    then
        echo "API failed to become healthy within 30s. API log:"
        cat "$API_LOG"
        return 1
    fi
}
run_sync "api healthy" "$PROJECT_ROOT" wait_for_api

run_sync "e2e tests" "$PROJECT_ROOT/plnd_client" bash -c "CI=true npm run e2e:ci"

# ── Final gate: collect all background job results ─────────────────────────────
wait_all

# Close FIFO write-end; let reader drain any buffered records, then exit.
exec 3>&-
wait "$READER_PID"
READER_PID=""

echo "✅ All verifications passed"
