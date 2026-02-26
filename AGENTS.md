# Mistral Vibe Agent Configuration for PLND

## Quick Reference

**Project**: PLND - Neurodivergent Planner/Assistant
**Current Phase**: Foundation (Core infrastructure setup)
**Primary Reference**: PLANNING.md

## Core Directives

### 1. Follow PLANNING.md
- Current focus: Foundation Phase (Rust backend, authentication, database)
- Next: Core Features Phase (user management, basic planning)
- Then: AI Enhancements Phase (agentic architecture, LLM integration)

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

**Escalate to Human**:
- Major architectural decisions
- Core data model changes
- Security-related decisions
- Significant scope changes
- Complex domain logic questions

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

**1.0** - Foundation Phase Configuration
**Last Updated**: 2023-11-15
**Status**: Active