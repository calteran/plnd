# Mistral Vibe Agent Configuration for PLND

## Quick Reference

**Project**: PLND - Neurodivergent Planner/Assistant
**Current Phase**: Core Features (User management and basic planning)
**Primary Reference**: PLANNING.md

## Core Directives

### 1. Follow PLANNING.md
- ✅ Current focus: Foundation Phase (Rust backend, authentication, database) - COMPLETED
- 🚧 Current focus: Core Features Phase (user management, basic planning) - IN PROGRESS
- Next: AI Enhancements Phase (agentic architecture, LLM integration)

### 2. Dependency Management
- Always use the latest stable versions of all dependencies
- Regularly update Rust, Node.js, and other core tools
- Verify compatibility before major version updates
- Document version requirements clearly

### 2. Development Standards

**Backend (Rust/Axum)**:
- Use `thiserror` for domain errors, `anyhow` for application errors
- Implement comprehensive error handling at all levels
- Follow RESTful API design principles
- 100% test coverage for business logic

**Frontend (Angular/NgRx)**:
- Strict TypeScript typing everywhere
- Use NgRx for state management
- Implement lazy loading for routes
- Ensure mobile compatibility (Capacitor) from start

**Database (PostgreSQL/SQLx)**:
- Use SQLx macros for type-safe queries
- Implement proper migrations
- Create appropriate indexes for performance

### 3. Quality Requirements

**Code Quality Checks (MANDATORY)**:
- All quality checks must pass before any code is committed
- Run `just verify` before every commit and push
- Quality checks include:
  - Rust formatting (`just fmt`)
  - Rust linting (`just clippy`)
  - Dependency license/security checks (`just deny`)
  - Unused dependency detection (`just machete`)
  - TypeScript linting (`just ts-lint`)
  - TypeScript dependency health (`just ts-deps`)

**Quality Check Failure Handling**:
- If any quality check fails, the agent MUST either:
  1. Fix the issue immediately, OR
  2. Ask explicit permission to ignore the specific failure with justification
- Never commit code with failing quality checks without permission
- Document any approved exceptions in the commit message

### Server Process Management

**MANDATORY RULES**:
1. Never run `cargo run` directly - always use `just` commands
2. Maximum 15-second timeout for any server process
3. Prefer `just verify-build` over runtime verification when possible

**Safe Commands**:
- `just verify-build` - Verify compilation (no server startup)
- `just test-run-server` - Test server startup (WILL auto-kill after 15s)
- `just verify` - Full quality + build verification

**Command Behavior**:
- `test-run-server`: Starts server, verifies it runs, **auto-kills after 15s**
- `verify-build`: Only compiles, no server processes started
- `verify`: Runs all quality checks + build verification

### Testing Rules for Agents

**MANDATORY RULES**:
1. **NEVER use `just test`** - This runs interactive tests that don't terminate
2. **ALWAYS use `just test-ci`** for comprehensive automated testing
3. Use `just test-ng-headless` for Angular-only headless testing
4. All tests must pass before committing code

**Safe Testing Commands**:
- `just test-ci` - Comprehensive CI test suite (Rust + Angular headless)
- `just test-ng-headless` - Angular tests with headless Chrome
- `just verify` - Full verification including all tests

**Command Behavior**:
- `test-ci`: Runs Rust tests + Angular headless tests, **terminates automatically**
- `test-ng-headless`: Runs Angular tests with ChromeHeadless, **terminates automatically**
- `verify`: Runs quality checks + build + comprehensive tests

**Testing**:
- Unit tests: 100% coverage for business logic
- Integration tests: All API endpoints
- E2E tests: Critical user flows

**Security**:
- Encrypt all health data
- Validate/sanitize all user input
- Follow OWASP Top 10
- Never expose sensitive data in errors

**Documentation**:
- Document all public APIs
- Explain complex algorithms
- Keep documentation current

### 4. Domain-Specific Rules

**Neurodivergent Support**:
- Implement gradual exposure features
- Provide extensive customization options
- Design sensory-friendly interfaces
- Allow multiple input methods

**Health Data**:
- Treat all health data as sensitive
- Implement strict access controls
- Provide clear privacy information to users

**Nutrition/Exercise**:
- Use scientifically validated data
- Allow full user customization
- Handle allergens with strict enforcement

### 5. Decision Making

**Agent Can Handle Independently**:
- Routine coding tasks
- Test implementation
- Bug fixes within existing architecture
- Documentation updates
- Minor refactoring
- Dependency updates to latest stable versions
- README.md maintenance and updates based on project progress
- Automatic task status updates in development dashboard
- Phase progression tracking and documentation

**Escalate to Human**:
- Major architectural decisions
- Core data model changes
- Security-related decisions
- Significant scope changes
- Complex domain logic questions
- Major version updates that may break compatibility

## Current Phase Focus: Foundation

**Priorities**:
1. Rust backend setup with Axum
2. Authentication system (email + OAuth)
3. PostgreSQL database foundation
4. Basic API structure
5. Docker Compose development environment

**Technologies**: Rust, Axum, PostgreSQL, SQLx, Docker

## Next Phase: Core Features

**Preparation**:
- Design user management system
- Plan basic meal/exercise CRUD operations
- Consider mobile compatibility requirements
- Prepare for basic LLM integration

## Communication Protocol

- **Clarity**: Clear, concise responses
- **Transparency**: Explain reasoning
- **Constraints**: Follow explicit instructions
- **Progress**: Regular updates
- **Errors**: Clear communication with solutions

## Version

**1.4** - Added CI-ready testing commands and agent testing restrictions
- Added `just test-ci` for comprehensive automated testing
- Added `just test-ng-headless` for Angular headless testing
- **BANNED `just test` for agents** - use `test-ci` instead
- Updated `verify` command to include comprehensive testing
- Added Testing Rules for Agents section
- Removed all unused dependencies
- Added mandatory quality check requirements
- Updated AGENTS.md to enforce quality standards
**Last Updated**: 2026-02-27
**Status**: Active

## Dependency Version Requirements

- **Rust**: Latest stable version (currently 1.93.1+) with 2024 edition
- **Node.js**: Latest LTS version (currently 20.x+)
- **Angular**: Latest stable version
- **All npm/Rust dependencies**: Latest stable versions
- **Docker**: Latest stable version