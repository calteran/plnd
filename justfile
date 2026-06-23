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
    brew install coreutils libpq dopplerhq/cli/doppler mprocs

    echo "→ Installing Rust tools..."
    cargo install cargo-nextest --locked
    cargo install cargo-deny --locked
    cargo install cargo-machete
    cargo install cargo-msrv --locked
    cargo install cargo-watch --locked

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

# Install Angular/Node deps in the current checkout so the LSP resolves types (run inside a fresh worktree)
install-deps:
    cd plnd_client && npm ci
    @echo "✅ Client dependencies installed"

# ── Daily Development ─────────────────────────────────────────────────────────

# Start infrastructure in Docker, then run API and client natively with split-pane logs.
# Press q or Ctrl-C to stop API and client — infra containers keep running.
# Use `just stop` to also bring down the infrastructure.
# LLM requests go to the Anthropic API (key injected via Doppler).
# Requires: mprocs (brew install mprocs), doppler
dev:
    #!/usr/bin/env bash
    set -euo pipefail
    if ! command -v cargo-watch >/dev/null 2>&1; then
        echo "→ Installing cargo-watch (API auto-reload)..."
        cargo install cargo-watch --locked
    fi
    echo "→ Starting infrastructure (db, mock-oauth-server)..."
    doppler run -- docker compose up -d --wait --wait-timeout 120
    echo "→ Infrastructure healthy."
    echo "→ Installing client dependencies (npm ci)..."
    just install-deps
    echo "→ Starting API and client (API auto-reloads on Rust changes)..."
    mprocs

# Run API service locally (requires PostgreSQL)
api:
    cd plnd_api && doppler run -- cargo run

# Run API service with auto-reload (installs cargo-watch if missing)
api-watch:
    @command -v cargo-watch >/dev/null 2>&1 || (echo "→ Installing cargo-watch..." && cargo install cargo-watch --locked)
    cd plnd_api && doppler run -- cargo watch --why -x run

# Run client locally
client:
    cd plnd_client && npx ng serve

# Bring up the shared, persistent infra (db + mock-oauth + observability) for a
# work session. Idempotent. HUMAN-ONLY: run once in your terminal before `just dev`
# and before setting agents loose. `just verify` REQUIRES this infra and never
# brings it up itself, and agents must never run `persist` either — it is a
# convergence writer (`docker compose up` can recreate a peer verify's live
# containers). Only the user configures the environment. This is also the only
# thing that starts the observability stack — so run it to capture per-run
# telemetry in Grafana.
persist:
    #!/usr/bin/env bash
    set -euo pipefail
    # HUMAN-ONLY hard guard: a non-interactive caller (no TTY on stdin — i.e. an
    # agent invoking via a tool) aborts here; a human terminal proceeds with no
    # prompt. Agents that find infra missing must notify the user and wait, never
    # bring infra up themselves.
    if [[ ! -t 0 ]]; then
        echo "✗ 'just persist' is HUMAN-ONLY — run it yourself from an interactive terminal." >&2
        echo "  Agents: do not run persist. Notify the user that shared infra needs starting, then wait." >&2
        exit 1
    fi
    doppler run -- docker compose up -d --wait
    # Reclaim any plnd_verify_* DBs orphaned by force-killed / OOM'd verify runs
    # (their EXIT trap never fired). Non-fatal: a failed sweep must not block infra.
    bash scripts/clean-verify-dbs.sh || true

# Drop orphaned per-run `plnd_verify_*` databases left behind when a verify run is
# force-killed (SIGKILL/OOM) before its EXIT trap can drop its DB. Safe anytime:
# only drops DBs with NO active connection AND older than MIN_AGE (default "1 hour";
# pass "0" to drop every unconnected orphan). Also runs at `just persist`. Scope is
# limited to the `plnd_verify_` prefix — never touches plnd_dev or _sqlx_test_* DBs.
clean-verify-dbs MIN_AGE="1 hour":
    @bash scripts/clean-verify-dbs.sh "{{ MIN_AGE }}"

# Stop ALL shared infra and remove volumes. HUMAN-ONLY: this wipes the database
# used by every running verify. The confirmation prompt aborts on EOF, so agents
# (non-interactive) can never trigger it.
stop:
    #!/usr/bin/env bash
    set -euo pipefail
    read -rp "⚠️  Wipes shared infra + volumes used by ALL running verifies. Continue? [y/N] " ans || ans=""
    [[ "$ans" == [yY] ]] || { echo "Aborted."; exit 1; }
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

# Enforce the colour-token policy: no hard-coded colour literals outside
# src/styles/_tokens.scss (the usual cause of dark-mode contrast regressions).
check-color-tokens:
    cd plnd_client && npm run check-color-tokens

# Combined quality check (all quality gates, no tests)
check:
    just fmt
    just clippy
    just deny
    just machete
    just check-tracing-skip
    just ts-lint
    just ts-deps
    just check-color-tokens

# Full verification — parallel, ISOLATED pipeline (see scripts/verify.sh).
# No semaphore: runs are isolated by per-run DB + ephemeral ports.
# SUBSET ∈ {all,quick,rust,ts,e2e}. Default `all`. Examples:
#   just verify           # everything
#   just verify quick     # read-only checks, no infra (fastest)
#   just verify e2e       # build + isolated API/ng + Playwright
verify SUBSET="all":
    @bash scripts/verify.sh {{ SUBSET }}

# ── Compilation & Server Validation ──────────────────────────────────────────

# Verify compilation only (no server startup)
verify-build:
    @echo "🔨 Verifying build..."
    cargo build --workspace && \
    echo "✅ Build successful"

# Test server startup (15 second timeout - will auto-kill, ephemeral port)
test-run-server:
    #!/usr/bin/env bash
    set -euo pipefail
    PORT=$(bash scripts/free-port.sh)
    echo "🚀 Testing server startup on :$PORT (15s timeout - will auto-kill)..."
    cd plnd_api
    timeout 15s doppler run -- env APP_API__BASE_URL="0.0.0.0:$PORT" cargo run || exit_code=$?
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
# Catalog fixtures now cover only Open Food Facts + TheMealDB (no API key needed);
# USDA canonical data comes from the vendored corpus — see `just refresh-usda-corpus`.
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

# Regenerate the vendored USDA canonical corpus (plnd_data/corpus/). Auto-discovers
# the latest Foundation + SR Legacy releases. Public-domain data; no key needed.
# Run twice a year when USDA publishes a new Foundation release.
refresh-usda-corpus:
    scripts/refresh-usda-corpus.sh

# Derive the small e2e/test corpus subset from the full vendored corpus.
# Run after refresh-usda-corpus. Used by the e2e leg of `just verify` so the
# startup seed stays cheap (see scripts/verify.sh APP_USDA_CORPUS_PATH).
refresh-usda-test-corpus:
    scripts/build-usda-test-corpus.sh

# Clean build artifacts + shared infra. HUMAN-ONLY (same EOF-abort guard as stop).
clean:
    #!/usr/bin/env bash
    set -euo pipefail
    read -rp "⚠️  Removes node_modules/dist/target AND wipes shared infra. Continue? [y/N] " ans || ans=""
    [[ "$ans" == [yY] ]] || { echo "Aborted."; exit 1; }
    cargo clean
    cd plnd_client && rm -rf node_modules dist
    cd "$(git rev-parse --show-toplevel)" && docker compose down -v
