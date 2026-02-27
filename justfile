# Build all services
build:
    cargo build --manifest-path plnd_api/Cargo.toml
    cd plnd_client && npm run build

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

# Run PostgreSQL only in detached mode
postgres:
    docker compose up -d postgres

# Stop all containers
stop:
    docker compose down

# View logs
logs:
    docker compose logs -f

# Run tests
test:
    cargo test --manifest-path plnd_api/Cargo.toml
    cd plnd_client && npm test

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