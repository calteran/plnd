#!/usr/bin/env bash
# scripts/verify.sh — Parallel verification pipeline
#
# Execution model:
#   • All jobs fire immediately, in parallel where safe.
#   • Output for every job is captured; terminal shows only ✓/✗ lines.
#   • On failure the full captured log is dumped under the ✗ line.
#   • Completions appear in real-time via a named FIFO + reader process.
#
# Services: docker-compose `db` and `mock-oauth-server` (same services as `just
# dev`), with secrets/config injected via `doppler run`. Cleanup trap calls
# `docker compose down --volumes` on EXIT/INT/TERM — matching `just stop`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

API_PID=""
API_LOG=""
READER_PID=""
FIFO=""

declare -a JOB_PIDS=()
declare -a JOB_TMPFILES=()

# ── Cleanup ────────────────────────────────────────────────────────────────────
cleanup() {
    exec 3>&- 2>/dev/null || true   # close FIFO write-end → reader gets EOF
    for pid in "${JOB_PIDS[@]+"${JOB_PIDS[@]}"}"; do
        kill "$pid" 2>/dev/null || true
    done
    if [[ -n "${API_PID:-}" ]]; then kill "$API_PID" 2>/dev/null || true; fi
    if [[ -n "${READER_PID:-}" ]]; then wait "$READER_PID" 2>/dev/null || true; fi
    for f in "${JOB_TMPFILES[@]+"${JOB_TMPFILES[@]}"}"; do
        rm -f "$f" 2>/dev/null || true
    done
    (cd "$PROJECT_ROOT" && doppler run -- docker compose down --volumes) 2>/dev/null || true
    # Release the flock only AFTER teardown completes. The lock must cover the
    # whole run lifecycle — including `docker compose down --volumes`. The `db`,
    # `mock-oauth-server`, and `plnd_api` all bind fixed host ports (5432/8080/
    # 3000) within one Compose project, so concurrent verify runs cannot
    # parallelize and must serialize through this lock. Releasing it before the
    # volume teardown lets a queued run bring the shared DB up, then this run's
    # deferred `down --volumes` wipes it out from under the new run's live e2e
    # suite — minted sessions vanish (auth/token 500s, /test/seed + authed
    # endpoints 401s), clustering failures in whatever specs are mid-flight (#875).
    exec 9>&- 2>/dev/null || true   # release flock
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
if ! command -v doppler &>/dev/null; then
    echo "✗ 'doppler' not found — install: brew install dopplerhq/cli/doppler" >&2
    exit 1
fi

# ── Semaphore: serialize concurrent verify runs ────────────────────────────────
# Held for the ENTIRE run, including the cleanup trap's `docker compose down
# --volumes` (see cleanup() — fd 9 is closed only after teardown). The lock must
# span teardown so a queued run never brings the shared DB up while this run is
# still tearing it down. Do not release fd 9 earlier (#875).
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

# ── Bring up supporting services (idempotent; same compose services as `just dev`) ─
# `--wait` blocks until each service is healthy per its compose healthcheck.
(cd "$PROJECT_ROOT" && doppler run -- docker compose down --volumes) 2>/dev/null || true
(cd "$PROJECT_ROOT" && doppler run -- docker compose up -d --wait db mock-oauth-server)

# ── Rust read-only checks — no target/ lock, safe to parallelize ───────────────
run_job "cargo fmt"     "$PROJECT_ROOT" cargo fmt --check
run_job "cargo deny"    "$PROJECT_ROOT" cargo deny check
run_job "cargo machete" "$PROJECT_ROOT" cargo machete
run_job "tracing-skip"  "$PROJECT_ROOT" just check-tracing-skip

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

# ── Post-build: nextest → clippy (sequential within, parallel with e2e) ────────
# sqlx::test uses DATABASE_URL to create isolated per-test databases. We derive
# it from Doppler's APP_DATABASE__URL (`export` so it propagates to both `cargo`
# invocations, and quoting is safe against any value Doppler may return).
run_job "nextest → clippy" "$PROJECT_ROOT" \
    doppler run -- bash -c 'export DATABASE_URL="$APP_DATABASE__URL"; cargo nextest run --workspace && cargo clippy --workspace --all-targets --all-features -- -D warnings'

# ── E2E gate: start API, run e2e (compose services healthy via `--wait` above) ─

API_LOG=$(mktemp /tmp/plnd-verify-api-XXXXXX)
cd "$PROJECT_ROOT/plnd_api"
# Close fd 3 (FIFO write-end) in the API subprocess so the reader can see
# EOF once the main script closes fd 3.  Without this, the API process keeps
# the write-end open and `wait "$READER_PID"` hangs indefinitely.
# Close fd 9 (the flock) so an interrupted verify can't leave the api holding
# the lock — every subsequent verify run would block on `flock` until the
# zombied api process is killed manually.
# APP_DATABASE__URL, APP_AUTH__OIDC_INTERNAL_ISSUER_URL, APP_AUTH__FRONTEND_ORIGIN
# all come from Doppler — no inline overrides needed.
# APP_EXTERNAL__FIXTURE_PATH switches the briefing providers to file-backed
# stubs so e2e never hits Open-Meteo or live RSS feeds. The flag is honored
# only in debug builds (#[cfg(debug_assertions)]); release binaries ignore it.
# APP_USDA_CORPUS_PATH points the startup catalog seed at the small test subset
# (~dozens of rows) instead of the full ~8k-row corpus, so the background bulk
# insert doesn't contend with e2e's parallel auth handshakes at boot.
APP_EXTERNAL__FIXTURE_PATH="$PROJECT_ROOT/plnd_data/fixtures" \
APP_USDA_CORPUS_PATH="$PROJECT_ROOT/plnd_data/corpus/usda_canonical.test.jsonl.gz" \
    doppler run -- ../target/debug/plnd_api > "$API_LOG" 2>&1 3>&- 9>&- &
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
    # Verify the freshly-built binary is the process serving :3000.
    # A stale plnd_api from a prior session could hold the port; in that case
    # the new binary crashes with AddrInUse, the health probe passes against the
    # stale process, and e2e tests run against the wrong binary (issue #780).
    if ! kill -0 "$API_PID" 2>/dev/null; then
        local stale_pid
        stale_pid=$(lsof -i TCP:3000 -sTCP:LISTEN -t 2>/dev/null | head -1 || true)
        echo "plnd_api (PID $API_PID) exited — port 3000 is likely held by a stale process."
        if [[ -n "$stale_pid" ]]; then
            echo "Stale process on port 3000: PID $stale_pid. Run: kill $stale_pid"
        fi
        echo "API log:"
        cat "$API_LOG"
        return 1
    fi
}
run_sync "api healthy" "$PROJECT_ROOT" wait_for_api

run_sync "e2e tests" "$PROJECT_ROOT/plnd_client" bash -c "PLAYWRIGHT_STRICT=true npm run e2e:ci"

# ── Final gate: collect all background job results ─────────────────────────────
wait_all

# Close FIFO write-end; let reader drain any buffered records, then exit.
exec 3>&-
wait "$READER_PID"
READER_PID=""

echo "✅ All verifications passed"
