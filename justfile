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
    cargo install cargo-msrv --locked

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
# LLM requests go to the Anthropic API (key injected via Doppler).
# Requires: mprocs (brew install mprocs), doppler
dev:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "→ Starting infrastructure (db, mock-oauth-server)..."
    doppler run -- docker compose up -d --wait --wait-timeout 120
    echo "→ Infrastructure healthy."
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

# Stop all containers and remove volumes (next `just dev` starts with a clean DB)
stop:
    docker compose down -v

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

# Verify MSRV declarations in all workspace crates — call after bumping deps or adopting new Rust features
msrv:
    #!/usr/bin/env bash
    set -euo pipefail
    for manifest in plnd_agent/Cargo.toml plnd_api/Cargo.toml plnd_data/Cargo.toml plnd_seed/Cargo.toml; do
        cargo msrv --manifest-path "$manifest" verify
    done

# TypeScript quality commands
ts-lint:
    cd plnd_client && npx eslint "src/**/*.ts" "e2e/**/*.ts"

ts-deps:
    cd plnd_client && npm run check-dependencies
    cd plnd_client && npm run check-licenses
    cd plnd_client && npm run check-circular

# Verify no handler in plnd_api/src/routes/ uses tracing::instrument(skip(...))
# without skip_all — guards against PII leaking via the Extension<Claims> arg
# (see issue #803). All route handlers must use skip_all + explicit fields(...).
check-tracing-skip:
    @if grep -rEn 'tracing::instrument\([^)]*skip\(' plnd_api/src/routes/ ; then \
        echo "" ; \
        echo "✗ Found tracing::instrument(skip(...)) in plnd_api/src/routes/." ; \
        echo "  Use skip_all with explicit fields(...) to avoid leaking PII-bearing" ; \
        echo "  args like Extension<Claims> into tracing spans. See issue #803." ; \
        exit 1 ; \
    else \
        echo "✓ No unsafe skip() patterns in plnd_api/src/routes/" ; \
    fi

# Combined quality check (all quality gates, no tests)
check:
    just fmt
    just clippy
    just deny
    just machete
    just check-tracing-skip
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

# Refresh captured upstream fixtures used by debug builds when
# APP_EXTERNAL__FIXTURE_PATH is set (e.g. the e2e leg of `just verify`).
# Run this when an upstream response shape changes or fixtures go stale.
# Briefing feed URLs must match config/api/default.toml news_feed_urls.
# Catalog refresh requires APP_EXTERNAL__USDA_FDC_API_KEY (via Doppler).
refresh-fixtures:
    @echo "→ Capturing real upstream responses into plnd_data/fixtures/ ..."
    @mkdir -p plnd_data/fixtures/open-meteo
    @rm -rf plnd_data/fixtures/rss && mkdir -p plnd_data/fixtures/rss
    curl -fsSL 'https://api.open-meteo.com/v1/forecast?latitude=51.5074&longitude=-0.1278&current=temperature_2m,precipitation,weather_code&daily=temperature_2m_max,temperature_2m_min&forecast_days=1' \
        -o plnd_data/fixtures/open-meteo/forecast.json
    curl -fsSL 'https://xkcd.com/rss.xml' -o plnd_data/fixtures/rss/xkcd.xml
    curl -fsSL 'https://news.ycombinator.com/rss' -o plnd_data/fixtures/rss/hn.xml
    curl -fsSL 'https://en.wikipedia.org/w/api.php?action=featuredfeed&feed=featured&feedformat=atom' \
        -o plnd_data/fixtures/rss/wikipedia.xml
    doppler run -- scripts/refresh-catalog-fixtures.sh
    @echo "✅ Done. Review the diff (git diff plnd_data/fixtures/) and commit if intentional."

# Clean build artifacts
clean:
    cargo clean
    cd plnd_client && rm -rf node_modules dist
    docker compose down -v
