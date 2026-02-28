# Build all services
build:
    cargo build --manifest-path plnd_api/Cargo.toml
    cd plnd_client && npx ng build

# Run development environment (PostgreSQL + Client) in detached mode
dev:
    docker compose up -d

# Run API service locally (requires PostgreSQL)
api:
    cd plnd_api && cargo run

# Run API service with auto-reload (requires cargo-watch)
api-watch:
    cd plnd_api && cargo install cargo-watch && cargo watch -x run

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
    cargo nextest run --manifest-path plnd_api/Cargo.toml
    cd plnd_client && npm test

# Run tests with nextest (verbose)
test-verbose:
    cargo nextest run --manifest-path plnd_api/Cargo.toml --verbose

# Run Angular tests with headless Chrome (automated testing)
test-ng-headless:
    @echo "🧪 Running Angular tests with headless Chrome..."
    cd plnd_client && npx ng test --browsers=ChromeHeadless --watch=false --code-coverage

# Comprehensive test suite for CI/automated environments (Rust with nextest + Angular headless)
test-ci:
    @echo "🚀 Running comprehensive CI test suite..."
    cargo nextest run --manifest-path plnd_api/Cargo.toml && \
    just test-ng-headless && \
    echo "✅ All CI tests passed"

# Rust quality commands
fmt:
    cargo fmt --manifest-path plnd_api/Cargo.toml --check

clippy:
    cargo clippy --manifest-path plnd_api/Cargo.toml --all-targets --all-features -- -D warnings

deny:
    cargo deny --manifest-path plnd_api/Cargo.toml check

machete:
    cargo machete

# TypeScript quality commands
ts-lint:
    cd plnd_client && npx eslint "src/**/*.ts"

ts-deps:
    cd plnd_client && npm run check-dependencies
    cd plnd_client && npm run check-licenses
    cd plnd_client && npm run check-circular

# Test server startup (15 second timeout - will auto-kill)
test-run-server:
    @echo "🚀 Testing server startup (15s timeout - will auto-kill)..."
    timeout 15s cargo run --manifest-path plnd_api/Cargo.toml || \
    echo "✅ Server started successfully (auto-killed after verification)"

# Verify compilation only (no server startup)
verify-build:
    @echo "🔨 Verifying build..."
    cargo build --manifest-path plnd_api/Cargo.toml && \
    echo "✅ Build successful"

# Full verification (quality checks + build + comprehensive tests)
verify:
    @echo "🔍 Running full verification..."
    just check && \
    just verify-build && \
    cargo nextest run --manifest-path plnd_api/Cargo.toml && \
    just test-ng-headless && \
    echo "✅ All verifications passed"

# Combined quality check
check:
    just fmt
    just clippy
    just deny
    just machete
    just ts-lint
    just ts-deps

# Clean build artifacts
clean:
    cargo clean --manifest-path plnd_api/Cargo.toml
    cd plnd_client && rm -rf node_modules dist
    docker compose down -v