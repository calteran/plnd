# Build all services
build:
    cargo build --workspace
    cd plnd_client && npx ng build

# Set up local development environment — run once after cloning
init:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "→ Installing Homebrew packages..."
    brew install flock coreutils libpq doppler/cli/doppler

    echo "→ Installing Rust tools..."
    cargo install cargo-nextest --locked
    cargo install cargo-deny --locked
    cargo install cargo-machete

    echo "→ Installing Angular/Node dependencies..."
    cd plnd_client && npm ci

    echo "→ Installing Playwright browser..."
    npx playwright install chromium

    echo "✅ Dev environment ready. Run 'doppler login' if you haven't already."

# Run development environment (PostgreSQL + Client) in detached mode
dev:
    doppler run -- docker compose build --no-cache && doppler run -- docker compose up -d --force-recreate

# Run full dev stack including local Ollama LLM (opt-in, pulls model on first start)
# Requires Docker with sufficient RAM for the model (phi3 ~2 GB, llama3.2 ~2 GB).
# Override models via OLLAMA_FAST_MODEL / OLLAMA_CAPABLE_MODEL env vars.
dev-llm:
    doppler run -- docker compose -f docker-compose.yml -f docker-compose.local-llm.yml build --no-cache && \
    doppler run -- docker compose -f docker-compose.yml -f docker-compose.local-llm.yml --profile local-llm up -d --force-recreate

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

# View logs
logs:
    docker compose logs -f

# Run tests with nextest
test:
    cargo nextest run --workspace
    cd plnd_client && npm test

# Run tests with nextest (verbose)
test-verbose:
    cargo nextest run --workspace --verbose

# Run Angular tests with headless Chrome (automated testing)
test-ng-headless:
    @echo "🧪 Running Angular tests with headless Chrome..."
    cd plnd_client && npx ng test --browsers=ChromeHeadless --watch=false --code-coverage

# Comprehensive test suite for CI/automated environments (Rust with nextest + Angular headless)
test-ci:
    @echo "🚀 Running comprehensive CI test suite..."
    cargo nextest run --workspace && \
    just test-ng-headless && \
    just services-up && \
    just test-e2e && \
    echo "✅ All CI tests passed"

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

# Verify compilation only (no server startup)
verify-build:
    @echo "🔨 Verifying build..."
    cargo build --workspace && \
    echo "✅ Build successful"

# Ensure Docker stack is running and all services are healthy (idempotent)
# --build client: rebuilds the Angular image so e2e tests always run against
# the latest compiled code (avoids stale-cache failures).
# Trade-off: adds a Docker build step on every `just verify` run, even for
# backend-only changes. If this becomes a bottleneck, move --build to a
# dedicated e2e recipe and keep services-up as a plain `up -d --wait`.
services-up:
    @echo "🐳 Ensuring Docker stack is up and healthy..."
    doppler run -- docker compose up -d --build client --wait
    @echo "✅ Services ready"

# Full verification — parallel pipeline (see scripts/verify.sh)
verify:
    @bash scripts/verify.sh

# Combined quality check
check:
    just fmt
    just clippy
    just deny
    just machete
    just ts-lint
    just ts-deps

# Install Playwright browser binaries (run once after npm install)
playwright-install:
    cd plnd_client && npx playwright install chromium

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

# Seed catalog data from external providers (requires running DB)
seed:
    doppler run -- cargo run -p plnd_seed

# Create a worktree and install Angular deps so the LSP resolves types immediately
worktree-new branch:
    git worktree add .worktrees/{{branch}} -b {{branch}}
    cd .worktrees/{{branch}}/plnd_client && npm ci
    @echo "✅ Worktree ready at .worktrees/{{branch}}"

# Clean build artifacts
clean:
    cargo clean
    cd plnd_client && rm -rf node_modules dist
    docker compose down -v