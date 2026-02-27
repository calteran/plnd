# Contributing to PLND

## Code Quality Standards

### Required Tools

**Rust:**
- `cargo-deny` - Dependency license and security checking
- `cargo-machete` - Unused dependency detection

**TypeScript:**
- `dependency-cruiser` - Circular dependency detection
- `npm-check-updates` - Dependency version checking
- `license-checker` - License compliance checking

### Running Quality Checks Locally

```bash
# Install required tools
cargo install cargo-deny cargo-machete
cd plnd_client && npm install

# Run all quality checks
just check

# Individual checks
just fmt       # Rust formatting verification
just clippy    # Rust linting
just deny      # Dependency license/security analysis
just machete   # Unused dependency detection
just ts-lint   # TypeScript linting
just ts-deps   # TypeScript dependency health checks
```

## Development Workflow

1. **Before committing:** Run `just verify` to ensure all quality standards are met
2. **Before pushing:** Run `just test` to ensure all tests pass
3. **For pull requests:** All quality checks must pass in CI

## Verification Commands

### Available Commands:

1. **`just verify-build`**
   - Verifies code compiles correctly
   - Does NOT start any servers
   - Fastest option for build verification

2. **`just test-run-server`**
   - Tests that server starts correctly
   - Automatically kills after 15 seconds
   - Use only when you need runtime verification

3. **`just verify`**
   - Runs all quality checks
   - Verifies build
   - Does NOT start servers
   - Use before committing

## Pull Request Requirements

All PRs must pass the quality checks defined in `.github/workflows/quality.yml`:
- Rust formatting (rustfmt)
- Rust linting (clippy)
- Dependency license/security checks (cargo-deny)
- Unused dependency detection (cargo-machete)
- TypeScript linting (ESLint)
- TypeScript dependency health checks

## Code Style Guidelines

### Rust
- Follow standard Rust formatting (rustfmt)
- Address all clippy warnings
- Keep dependencies minimal and up-to-date

### TypeScript/Angular
- Follow Angular style guide
- Use ESLint for code quality
- Keep dependencies updated regularly
- Avoid circular dependencies