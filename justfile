# ── Setup / One-time ─────────────────────────────────────────────────────────

# Build all services
build:
    cargo build --workspace
    cd plnd_client && npx ng build

# Set up local development environment — run once after cloning
init:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "→ Installing Homebrew packages..."
    brew install flock coreutils libpq dopplerhq/cli/doppler mprocs

    echo "→ Installing Rust tools..."
    cargo install cargo-nextest --locked
    cargo install cargo-deny --locked
    cargo install cargo-machete

    echo "→ Installing Angular/Node dependencies..."
    cd plnd_client && npm ci

    echo "→ Installing Playwright browser..."
    npx playwright install chromium

    echo "✅ Dev environment ready. Run 'doppler login' if you haven't already."

# Install Playwright browser binaries (run once after npm install)
playwright-install:
    cd plnd_client && npx playwright install chromium

# Provision an OrbStack Linux VM as a GitHub Actions self-hosted runner
# Token is auto-fetched via gh CLI. Pass name to pin a specific VM name.
setup-runner name="":
    @bash scripts/setup-runner.sh {{ if name != "" { "--name " + name } else { "" } }}

# Deregister all runners for this machine from GitHub and delete their VMs
teardown-runners:
    @bash scripts/teardown-runners.sh

# Stream live runner service logs (Ctrl-C to stop); pass slot number for a specific runner
watch-runner slot="1":
    #!/usr/bin/env bash
    machine=$(hostname -s | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/-*$//')
    exec orb run -m "plnd-${machine}-{{slot}}" sudo journalctl -fu "actions.runner.*"

# Create a worktree and install Angular deps so the LSP resolves types immediately
worktree-new branch:
    git worktree add .worktrees/{{branch}} -b {{branch}}
    cd .worktrees/{{branch}}/plnd_client && npm ci
    @echo "✅ Worktree ready at .worktrees/{{branch}}"

# ── Daily Development ─────────────────────────────────────────────────────────

# Start infrastructure in Docker, then run API and client natively with split-pane logs.
# Press q or Ctrl-C to stop API and client — infra containers keep running.
# Use `just stop` to also bring down the infrastructure.
# LLM is served by LM Studio natively (localhost:1234). Override model via LM_STUDIO_MODEL env var.
# Requires: mprocs (brew install mprocs), doppler, LM Studio running locally
dev:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "→ Starting infrastructure (db, mock-oauth-server)..."
    doppler run -- docker compose up -d --wait --wait-timeout 120
    echo "→ Infrastructure healthy."
    LM_MODEL="${LM_STUDIO_MODEL:-google/gemma-4-26b-a4b}"
    echo "→ Ensuring LM Studio model is loaded: $LM_MODEL"
    load_response=$(curl -s -w "\n%{http_code}" -X POST http://localhost:1234/api/v1/models/load \
      -H "Content-Type: application/json" \
      -d "{\"model\": \"$LM_MODEL\"}" 2>/dev/null || true)
    http_code=$(echo "$load_response" | tail -1)
    if [ "$http_code" = "200" ]; then
      echo "  ✓ Model loaded"
    elif echo "$load_response" | grep -q "insufficient system resources"; then
      echo "  ✓ Model already resident in memory"
    else
      echo "  ⚠  LM Studio not reachable — model will load on first inference request"
    fi
    echo "→ Starting API and client..."
    mprocs

# Run API service locally (requires PostgreSQL)
api:
    cd plnd_api && doppler run -- cargo run

# Run API service with auto-reload (requires cargo-watch)
api-watch:
    cd plnd_api && cargo install cargo-watch && doppler run -- cargo watch -x run

# Run client locally
client:
    cd plnd_client && npx ng serve

# Run database only in detached mode
db:
    docker compose up -d db

# Stop all containers
stop:
    docker compose down

alias down := stop

# View infra container logs (db, mock-oauth-server).
# API and client logs appear in the mprocs TUI when using `just dev`.
logs:
    docker compose logs -f

# ── Quality ───────────────────────────────────────────────────────────────────

# Rust quality commands
fmt:
    cargo fmt --check

clippy:
    cargo clippy --workspace --all-targets --all-features -- -D warnings

deny:
    cargo deny check

machete:
    cargo machete

# TypeScript quality commands
ts-lint:
    cd plnd_client && npx eslint "src/**/*.ts" "e2e/**/*.ts"

ts-deps:
    cd plnd_client && npm run check-dependencies
    cd plnd_client && npm run check-licenses
    cd plnd_client && npm run check-circular

# Combined quality check (all quality gates, no tests)
check:
    just fmt
    just clippy
    just deny
    just machete
    just ts-lint
    just ts-deps

# Full verification — parallel pipeline (see scripts/verify.sh)
# Runs quality checks + build + unit tests + e2e. Use before every commit.
verify:
    @bash scripts/verify.sh

# ── Compilation & Server Validation ──────────────────────────────────────────

# Verify compilation only (no server startup)
verify-build:
    @echo "🔨 Verifying build..."
    cargo build --workspace && \
    echo "✅ Build successful"

# Test server startup (15 second timeout - will auto-kill)
# timeout exits 124 when it kills the process (success); any other code means the server crashed.
test-run-server:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "🚀 Testing server startup (15s timeout - will auto-kill)..."
    cd plnd_api
    timeout 15s doppler run -- cargo run || exit_code=$?
    exit_code=${exit_code:-0}
    if [ "$exit_code" -eq 124 ]; then
        echo "✅ Server started successfully (auto-killed after 15s)"
    else
        echo "❌ Server failed to start (exit code: $exit_code)"
        exit 1
    fi

# ── Testing ───────────────────────────────────────────────────────────────────

# For unit tests: use test-ng-headless (Angular) or `cargo nextest run --workspace` (Rust)
# For full pre-commit validation: use `verify` — it is parallel, faster, and more comprehensive
# Note: `just test` and `just test-ci` have been removed; use `verify` instead

# Run Angular tests with headless Chrome
test-ng-headless:
    @echo "🧪 Running Angular tests with headless Chrome..."
    cd plnd_client && npx ng test --browsers=ChromeHeadless --watch=false --code-coverage

# Ensure infrastructure containers are running and healthy (convenience helper — not used by verify).
# verify.sh manages its own ephemeral containers independently.
services-up:
    @echo "🐳 Ensuring infrastructure is up and healthy..."
    doppler run -- docker compose up -d --wait
    @echo "✅ Infrastructure ready"

# Run Playwright e2e tests (CI-safe, requires Docker stack + Angular)
test-e2e:
    @echo "Running Playwright e2e tests..."
    cd plnd_client && npm run e2e:ci

# Run Playwright e2e tests against a natively-running API (no Docker build)
# Requires: postgres on 5432, mock-oauth on 8080, and API binary running on 3000
test-e2e-native:
    @echo "Running Playwright e2e tests (native API)..."
    cd plnd_client && CI=true npm run e2e:ci

# Run Playwright e2e tests in dev mode (reuses existing ng serve if running)
test-e2e-dev:
    @echo "Running Playwright e2e tests (dev mode)..."
    cd plnd_client && npm run e2e

# Open Playwright HTML report from last run
test-e2e-report:
    cd plnd_client && npm run e2e:report

# ── Utilities ─────────────────────────────────────────────────────────────────

# Seed catalog data from external providers (requires running DB)
seed:
    doppler run -- cargo run -p plnd_seed

# Clean build artifacts
clean:
    cargo clean
    cd plnd_client && rm -rf node_modules dist
    docker compose down -v
