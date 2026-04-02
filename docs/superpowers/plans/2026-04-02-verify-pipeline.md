# Verify Pipeline Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sequential `just verify` with a parallel `scripts/verify.sh` that runs all checks concurrently for sub-2-minute wall time on warm cache, then add a flock-based semaphore and `just init` for multi-agent environments.

**Architecture:** `scripts/verify.sh` owns all orchestration. Everything fires immediately in parallel; `cargo build` blocks the critical e2e path while everything else races. Services use ephemeral `docker run --rm` containers (no compose build step). `just verify` becomes a one-liner that delegates to the script.

**Tech Stack:** bash, Docker (postgres:15 + mock-oauth2-server:3.0.1), doppler, cargo (build/nextest/clippy/fmt/deny/machete), Angular CLI (ng test), Playwright

---

### Task 1: Create `scripts/verify.sh`

**Files:**
- Create: `scripts/verify.sh`

- [ ] **Step 1: Create the scripts directory**

```bash
mkdir -p scripts
```

- [ ] **Step 2: Write `scripts/verify.sh`**

```bash
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
    [[ -n "${API_PID:-}" ]] && kill "$API_PID" 2>/dev/null || true
    docker rm -f "$VERIFY_DB_NAME" "$VERIFY_OAUTH_NAME" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

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
    'until docker exec plnd-verify-db pg_isready -U plnd 2>/dev/null; do sleep 1; done'

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
```

- [ ] **Step 3: Make the script executable**

```bash
chmod +x scripts/verify.sh
```

- [ ] **Step 4: Check the script for syntax errors**

```bash
bash -n scripts/verify.sh
```

Expected: no output (syntax valid)

---

### Task 2: Update Justfile

**Files:**
- Modify: `Justfile`

- [ ] **Step 1: Replace the `verify` recipe**

Find and replace the full `verify` recipe (lines 112–121 in the current file):

```justfile
# Full verification — parallel pipeline (see scripts/verify.sh)
verify:
    @bash scripts/verify.sh
```

- [ ] **Step 2: Add `test-e2e-native` after the existing `test-e2e` recipe**

Add after the `test-e2e` recipe:

```justfile
# Run Playwright e2e tests against a natively-running API (no Docker build)
# Requires: postgres on 5432, mock-oauth on 8080, and API binary running on 3000
test-e2e-native:
    @echo "Running Playwright e2e tests (native API)..."
    cd plnd_client && CI=true npm run e2e:ci
```

- [ ] **Step 3: Verify Justfile parses correctly**

```bash
just --list
```

Expected: `verify` and `test-e2e-native` appear; no parse errors

- [ ] **Step 4: Commit**

```bash
git checkout -b feat/parallel-verify
git add scripts/verify.sh Justfile
git commit -m "feat: replace sequential verify with parallel scripts/verify.sh"
```

---

### Task 3: Smoke Test

No code changes — manual verification of the new pipeline.

- [ ] **Step 1: Run verify on a clean working tree**

```bash
just verify
```

Expected: exits 0; all phases print their status; no containers remain after:

```bash
docker ps --filter name=plnd-verify
```

Expected: empty table (containers auto-removed)

- [ ] **Step 2: Test cleanup on interrupt**

Start verify, wait for "Starting API natively..." to print, then Ctrl-C:

```bash
just verify
# Ctrl-C after API starts
docker ps --filter name=plnd-verify
```

Expected: no `plnd-verify-db` or `plnd-verify-oauth` containers running

- [ ] **Step 3: Test lint failure detection**

```bash
echo "let x = ;" >> plnd_api/src/main.rs
just verify || echo "exit code: $?"
git checkout plnd_api/src/main.rs
```

Expected: exits non-zero; failure reported in output (fmt or compilation error)

- [ ] **Step 4: Verify standalone recipes are unchanged**

```bash
just clippy
just fmt
just ts-lint
```

Expected: all work independently

- [ ] **Step 5: Time warm-cache runs**

```bash
time just verify
time just verify
```

Target: under 2 minutes on the second run (incremental build cache warm)

---

## Phase 2 (Deferred)

### Task 4: Add Semaphore to `scripts/verify.sh`

**Prerequisite:** `just init` (Task 5) must have run first to install `flock` via `util-linux`.

**Files:**
- Modify: `scripts/verify.sh`

- [ ] **Step 1: Confirm `flock` is available**

```bash
which flock
flock --version
```

Expected: `/opt/homebrew/bin/flock` (or similar); version string printed. If missing, run `just init` first.

- [ ] **Step 2: Add flock guard to `scripts/verify.sh` immediately after the `trap` line**

Find:
```bash
trap cleanup EXIT INT TERM
```

Add immediately after:
```bash
# ── Semaphore: serialize concurrent verify runs ────────────────────────────────
LOCK_FILE="/tmp/plnd-verify.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    echo "⏳ Another verify is running — waiting for lock..."
    flock 9
fi
```

- [ ] **Step 3: Test semaphore behaviour**

In terminal 1:
```bash
just verify &
```

Immediately in terminal 2:
```bash
just verify
```

Expected: terminal 2 prints "Another verify is running — waiting for lock..." and waits; once terminal 1 finishes, terminal 2 proceeds.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify.sh
git commit -m "feat: add flock semaphore to verify.sh for multi-agent concurrency"
```

---

### Task 5: Add `just init`

**Files:**
- Modify: `Justfile`

- [ ] **Step 1: Add `init` recipe to Justfile, near the top after the `build` recipe**

```justfile
# Set up local development environment — run once after cloning
init:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "→ Installing Homebrew packages..."
    brew install util-linux libpq doppler/cli/doppler

    echo "→ Installing Rust tools..."
    cargo install cargo-nextest --locked
    cargo install cargo-deny --locked
    cargo install cargo-machete

    echo "→ Installing Angular/Node dependencies..."
    cd plnd_client && npm ci

    echo "→ Installing Playwright browser..."
    cd plnd_client && npx playwright install chromium

    echo "✅ Dev environment ready. Run 'doppler login' if you haven't already."
```

- [ ] **Step 2: Run `just init` and verify it completes**

```bash
just init
```

Expected: exits 0; all tools installed (brew prints "already installed" for existing formulae — that is not an error)

- [ ] **Step 3: Confirm `flock` and `pg_isready` are now on PATH**

```bash
which flock && flock --version
which pg_isready && pg_isready --version
```

Expected: both resolve to Homebrew paths

- [ ] **Step 4: Commit**

```bash
git add Justfile
git commit -m "feat: add just init for one-command dev environment setup"
```

---

### Task 6: Open PR

- [ ] **Step 1: Push and open PR**

```bash
git push -u origin feat/parallel-verify
gh pr create \
  --title "feat: parallel verify pipeline with semaphore and init" \
  --body "$(cat <<'EOF'
## Summary
- Replaces sequential `just verify` with `scripts/verify.sh` — parallel pipeline targeting <2 min on warm cache
- All checks, services, and cargo build fire immediately; nextest+clippy run after build without blocking e2e
- Ephemeral `docker run --rm` containers replace the full compose stack (no client image build)
- API runs natively via doppler with localhost URL overrides; Playwright manages `ng serve` itself
- Phase 2: flock semaphore serializes concurrent agent runs; `just init` installs all tooling in one command

## Test plan
- [ ] `just verify` exits 0 on a clean working tree
- [ ] Ctrl-C during verify leaves no containers running (`docker ps --filter name=plnd-verify` is empty)
- [ ] Introducing a lint error causes non-zero exit with failure reported
- [ ] `just clippy`, `just fmt`, `just ts-lint` still work independently
- [ ] Two consecutive warm-cache runs complete under 2 minutes
- [ ] `just init` completes without errors; `flock` and `pg_isready` resolve on PATH

Closes #<issue-number>
EOF
)"
```
