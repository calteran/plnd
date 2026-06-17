#!/usr/bin/env bash
# scripts/verify.sh — Parallel, ISOLATED verification pipeline (no semaphore).
#
# Usage: verify.sh [SUBSET]      SUBSET ∈ {all,quick,rust,ts,e2e}  (default: all)
#
# Isolation model:
#   • Shared infra (db, mock-oauth) lives in the pinned Compose project `plnd`,
#     brought up once per session via `just persist`. This script REQUIRES that
#     infra to already be running and never calls `docker compose up` itself —
#     `persist` (and `just dev`) are the sole writers of infra state, so a
#     concurrent verify can never recreate a peer's live containers.
#   • Each run gets its own application DB `plnd_verify_<runid>` on the shared
#     Postgres and ephemeral ports for the API and ng serve — so concurrent runs
#     across worktrees never collide. No flock.
#   • Run id (branch slug + short random) names the per-run DB and the OTEL
#     verify.run_id tag, so logs/traces/DB correlate.

set -euo pipefail

SUBSET="${1:-all}"
case "$SUBSET" in all|quick|rust|ts|e2e) ;; *)
    echo "✗ Unknown subset '$SUBSET' (expected: all|quick|rust|ts|e2e)" >&2; exit 2 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Which legs does this subset need?
need() { case ",$1," in *",$SUBSET,"*) return 0;; esac; case "$SUBSET" in all) return 0;; esac; return 1; }
NEED_INFRA=false; NEED_E2E=false
need "rust,e2e" && NEED_INFRA=true        # nextest or e2e need the shared Postgres
need "e2e"      && { NEED_E2E=true; NEED_INFRA=true; }

RUN_ID=""; RUN_DB=""; RUN_DB_CREATED=false
API_PID=""; API_LOG=""; READER_PID=""; FIFO=""
declare -a JOB_PIDS=(); declare -a JOB_TMPFILES=()

# ── Cleanup ────────────────────────────────────────────────────────────────────
cleanup() {
    exec 3>&- 2>/dev/null || true   # close FIFO write-end → reader gets EOF
    for pid in "${JOB_PIDS[@]+"${JOB_PIDS[@]}"}"; do kill "$pid" 2>/dev/null || true; done
    [[ -n "${API_PID:-}" ]] && kill "$API_PID" 2>/dev/null || true
    [[ -n "${READER_PID:-}" ]] && wait "$READER_PID" 2>/dev/null || true
    for f in "${JOB_TMPFILES[@]+"${JOB_TMPFILES[@]}"}"; do rm -f "$f" 2>/dev/null || true; done
    # Drop ONLY this run's DB. Never touch shared infra.
    if [[ "$RUN_DB_CREATED" == true ]]; then
        (cd "$PROJECT_ROOT" && docker compose exec -T db \
            psql -U plnd -d postgres -c "DROP DATABASE IF EXISTS \"$RUN_DB\" WITH (FORCE);") \
            >/dev/null 2>&1 || true
    fi
    [[ -n "${FIFO:-}" ]] && rm -f "$FIFO" 2>/dev/null || true
    [[ -n "${API_LOG:-}" ]] && rm -f "$API_LOG" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ── Prerequisite checks ─────────────────────────────────────────────────────────
for tool in timeout doppler node openssl git curl cargo npm npx; do
    command -v "$tool" &>/dev/null || { echo "✗ '$tool' not found" >&2; exit 1; }
done
# Docker is only needed by subsets that touch infra (rust/e2e/all); quick/ts are
# pure static/unit checks and run without it.
if [[ "$NEED_INFRA" == true ]]; then
    docker info &>/dev/null || { echo "✗ Docker is not running — start Docker Desktop" >&2; exit 1; }
fi

# ── FIFO completion bus (real-time ✓/✗) ─────────────────────────────────────────
FIFO=$(mktemp -u /tmp/plnd-verify-bus-XXXXXX); mkfifo "$FIFO"
{
    while IFS='|' read -r status label tmpfile; do
        if [[ "$status" == "0" ]]; then echo "  ✓ $label"; else
            echo "  ✗ FAILED: $label"
            [[ -f "$tmpfile" && -s "$tmpfile" ]] && sed 's/^/    /' "$tmpfile"
        fi
        rm -f "$tmpfile" 2>/dev/null || true
    done
} < "$FIFO" &
READER_PID=$!
exec 3>"$FIFO"

run_job() {  # run_job label workdir cmd [args...]  — background, reports via FIFO
    local label="$1" workdir="$2"; shift 2
    local tmpfile; tmpfile=$(mktemp /tmp/plnd-verify-XXXXXX); JOB_TMPFILES+=("$tmpfile")
    (
        local status=0
        { (cd "$workdir" && "$@") 3>&-; } > "$tmpfile" 2>&1 || status=$?
        printf '%s|%s|%s\n' "$status" "$label" "$tmpfile" >&3
        exit $status
    ) &
    JOB_PIDS+=($!)
}

run_sync() {  # run_sync label workdir cmd [args...] — synchronous; exit on failure
    local label="$1" workdir="$2"; shift 2
    local tmpfile status=0; tmpfile=$(mktemp /tmp/plnd-verify-XXXXXX); JOB_TMPFILES+=("$tmpfile")
    { (cd "$workdir" && "$@") > "$tmpfile" 2>&1; } || status=$?
    printf '%s|%s|%s\n' "$status" "$label" "$tmpfile" >&3
    [[ $status -ne 0 ]] && exit 1 || true
}

wait_all() {
    local overall=0 pid
    for pid in "${JOB_PIDS[@]+"${JOB_PIDS[@]}"}"; do wait "$pid" 2>/dev/null || overall=1; done
    JOB_PIDS=(); return $overall
}

# Probe Alloy's OTLP port on a PRIVATE fd inside a subshell — never fd 3, which is
# the FIFO completion-bus write-end held by the main shell. The subshell auto-closes
# the probe fd on exit; its exit status IS the reachability result.
alloy_reachable() { (exec 9<>/dev/tcp/127.0.0.1/4317) 2>/dev/null; }

# ── Run id — branch slug + short random; names the per-run DB and OTEL tag ───────
BRANCH_SLUG="$(git -C "$PROJECT_ROOT" branch --show-current 2>/dev/null \
    | tr 'A-Z' 'a-z' | tr -cs 'a-z0-9' '-' | sed 's/^-//;s/-$//')"
RUN_ID="${BRANCH_SLUG:-detached}-$(openssl rand -hex 2)"
RUN_DB="plnd_verify_$(printf '%s' "$RUN_ID" | tr -c 'a-z0-9' '_')"

echo "◆ Starting verification (subset: $SUBSET, run: $RUN_ID)..."

# ── Require shared infra — never bring it up (persist/dev own that) ──────────────
# A concurrent `docker compose up` on the pinned `plnd` project can recreate a
# peer verify's live containers (config-hash convergence + racing invocations),
# so verify only ever READS infra state. Missing infra is a fast, clear failure.
infra_running() {  # infra_running <service> — true iff its container exists and is running
    local cid
    cid="$(cd "$PROJECT_ROOT" && docker compose ps -q "$1" 2>/dev/null)"
    [[ -n "$cid" ]] && [[ "$(docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null)" == "true" ]]
}
if [[ "$NEED_INFRA" == true ]]; then
    declare -a MISSING=()
    infra_running db               || MISSING+=(db)
    infra_running mock-oauth-server || MISSING+=(mock-oauth-server)
    if (( ${#MISSING[@]} )); then
        echo "✗ Shared infra not running: ${MISSING[*]}" >&2
        echo "  Shared infra is HUMAN-ONLY: the user starts it with 'just persist'." >&2
        echo "  Agents: do not run persist. Notify the user that infra needs starting, then wait." >&2
        exit 1
    fi
fi

# ── Rust read-only (no infra) ───────────────────────────────────────────────────
if need "quick,rust"; then
    run_job "cargo fmt"     "$PROJECT_ROOT" cargo fmt --check
    run_job "cargo deny"    "$PROJECT_ROOT" cargo deny check
    run_job "cargo machete" "$PROJECT_ROOT" cargo machete
    run_job "tracing-skip"  "$PROJECT_ROOT" just check-tracing-skip
fi

# ── TypeScript ──────────────────────────────────────────────────────────────────
if need "quick,ts,e2e"; then
    run_sync "npm ci" "$PROJECT_ROOT/plnd_client" npm ci
fi
if need "quick,ts"; then
    run_job "eslint"  "$PROJECT_ROOT/plnd_client" npx eslint "src/**/*.ts" "e2e/**/*.ts"
    run_job "ts-deps" "$PROJECT_ROOT/plnd_client" bash -c \
        "npm run check-dependencies && npm run check-licenses && npm run check-circular"
fi
if need "ts"; then
    KARMA_PORT="$("$SCRIPT_DIR/free-port.sh")"
    run_job "ng test" "$PROJECT_ROOT/plnd_client" \
        env KARMA_PORT="$KARMA_PORT" npx ng test --browsers=ChromeHeadless --watch=false --code-coverage
fi

# ── Cargo build (gates nextest/clippy/e2e) ──────────────────────────────────────
if need "rust,e2e"; then
    run_sync "cargo build" "$PROJECT_ROOT" cargo build --workspace
fi

# ── nextest → clippy (shared Postgres; sqlx::test isolates its own test DBs) ─────
if need "rust"; then
    run_job "nextest → clippy" "$PROJECT_ROOT" doppler run -- bash -c \
        'export DATABASE_URL="$APP_DATABASE__URL"; cargo nextest run --workspace && cargo clippy --workspace --all-targets --all-features -- -D warnings'
fi

# ── E2E (per-run DB + ephemeral API + ephemeral ng serve) ───────────────────────
if [[ "$NEED_E2E" == true ]]; then
    # Per-run application DB on the shared Postgres (container-local trust auth).
    (cd "$PROJECT_ROOT" && docker compose exec -T db \
        psql -U plnd -d postgres -c "CREATE DATABASE \"$RUN_DB\";") >/dev/null
    RUN_DB_CREATED=true

    # Derive the per-run DB URL by swapping the db-name segment. Assumes the
    # password (if any) has no unencoded '/'; Doppler-managed connection strings
    # percent-encode such characters, so this holds.
    APP_DB_BASE="$(doppler run -- bash -c 'printf %s "$APP_DATABASE__URL"')"; APP_DB_BASE="${APP_DB_BASE%/*}"
    RUN_DB_URL="$APP_DB_BASE/$RUN_DB"
    API_PORT="$("$SCRIPT_DIR/free-port.sh")"
    NG_PORT="$("$SCRIPT_DIR/free-port.sh")"

    # OTEL tagging only when Alloy (observability) is actually up.
    declare -a API_ENV=(
        APP_DATABASE__URL="$RUN_DB_URL"
        APP_API__BASE_URL="0.0.0.0:$API_PORT"
        APP_AUTH__FRONTEND_ORIGIN="http://localhost:$NG_PORT"
        APP_EXTERNAL__FIXTURE_PATH="$PROJECT_ROOT/plnd_data/fixtures"
        APP_USDA_CORPUS_PATH="$PROJECT_ROOT/plnd_data/corpus/usda_canonical.test.jsonl.gz"
    )
    if alloy_reachable; then
        API_ENV+=( APP_OTEL__ENDPOINT="http://127.0.0.1:4317" VERIFY_RUN_ID="$RUN_ID" )
        echo "  ◆ telemetry → Alloy (verify.run_id=$RUN_ID)"
    fi

    API_LOG=$(mktemp /tmp/plnd-verify-api-XXXXXX)
    # Background the API DIRECTLY — no wrapper subshell. `3>&-` closes the FIFO
    # completion-bus write-end for doppler and its plnd_api child so the reader
    # can reach EOF; API_PID is the doppler pid so cleanup's kill reaches the
    # server. A wrapper subshell would keep fd 3 open for the server's whole life
    # (→ `wait READER_PID` hangs) and make API_PID the subshell, orphaning plnd_api.
    cd "$PROJECT_ROOT/plnd_api"
    doppler run -- env "${API_ENV[@]}" ../target/debug/plnd_api > "$API_LOG" 2>&1 3>&- &
    API_PID=$!
    cd "$PROJECT_ROOT"

    wait_for_api() {
        if ! timeout 30s bash -c \
            "until curl -sf http://localhost:$API_PORT/health > /dev/null 2>&1; do sleep 1; done"; then
            echo "API failed to become healthy within 30s on :$API_PORT. API log:"; cat "$API_LOG"; return 1
        fi
        if ! kill -0 "$API_PID" 2>/dev/null; then
            echo "plnd_api (PID $API_PID) exited before serving :$API_PORT. API log:"; cat "$API_LOG"; return 1
        fi
    }
    run_sync "api healthy" "$PROJECT_ROOT" wait_for_api

    run_sync "e2e tests" "$PROJECT_ROOT/plnd_client" \
        env API_BASE="http://localhost:$API_PORT" NG_PORT="$NG_PORT" \
        bash -c "PLAYWRIGHT_STRICT=true npm run e2e:ci"
fi

# ── Collect parallel results ────────────────────────────────────────────────────
wait_all
exec 3>&-
wait "$READER_PID"; READER_PID=""

echo "✅ All verifications passed (subset: $SUBSET, run: $RUN_ID)"
