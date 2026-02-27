# PLND - Neurodivergent Planner/Assistant

A structured yet flexible planner/assistant designed for neurodivergent individuals to manage nutrition, exercise, and daily planning.

PLND (pronounced "planned") provides structured planning with extensive customization options, gradual exposure features, and sensory-friendly interfaces to help neurodivergent individuals who are picky eaters or struggle with nutrition and exercise.

## Development Status

### Current Phase: Foundation
**Status**: In Progress ✅
**Focus**: Core infrastructure setup (Rust backend, authentication, database)

#### Project Setup (Completed)
- ✅ Initialize Rust backend with Axum
- ✅ Set up Angular frontend with NgRx
- ✅ Configure Docker Compose development environment
- ✅ Create basic project structure and build scripts

#### Next in Foundation Phase:
- [ ] Database Foundation (PostgreSQL + SQLx setup)
- [ ] Authentication System (email/OAuth, JWT)
- [ ] Basic API Structure (Axum router, error handling)

### Next Phase: Core Features
- User Management CRUD operations
- Basic meal/exercise planning interfaces
- LLM integration foundation

## Available Commands

```bash
# Build all services (API + Client)
just build

# Start full development environment
just dev

# Run API service locally
just api

# Run client development server
just client

# Run all quality checks + build
just verify

# Run all tests
just test

# Clean all build artifacts
just clean
```

## Documentation

- [PLANNING.md](PLANNING.md) - Architecture and development roadmap
- [AGENTS.md](AGENTS.md) - Agent configuration and maintenance directives

## License

This is a proprietary project and is not licensed for use by anyone except the creator.
