# PLND - Planning Document

## Overview
PLND (pronounced "planned") is a planner/assistant designed for neurodivergent individuals who are picky eaters or struggle with nutrition and exercise. The goal is to provide a structured yet flexible tool to help users plan meals, track nutrition, and manage exercise routines in a way that accommodates their unique needs.

## Core Features

### Authentication & User Management
- Secure authentication (email/password, OAuth) with persistent sessions
- User profiles for preferences, dietary restrictions, and exercise routines
- Optional multi-factor authentication

### Planning & Scheduling
- Weekly planning view with recurring plan options
- Easy day-by-day adjustments and overrides
- Drag-and-drop functionality for rearranging plans
- Notifications and reminders for upcoming plans

### Meal Planning
- Support for recurring meals (e.g., daily breakfast)
- Encourage variety in other meals for balanced nutrition
- Configurable preferences for trying new meals
- Gentle expansion of food choices through similar meal suggestions
- Rating scale (1-5 stars) for meals and ingredients
- Allergen marking with strict enforcement
- Priority scheduling for ingredients marked "use soon"
- Expiration reminders for perishable items

### Exercise Planning
- Set and track fitness goals (weight loss, muscle gain, endurance)
- Personalized exercise plans based on goals and preferences
- Integration with daily schedules considering preferred times
- Progress tracking and plan adjustments
- Reminders and motivational support

### Health Integration
- Medication schedule tracking with effect management
- Adjust meal timing/portions based on medication effects
- Avoid intense exercise during medication-sensitive periods
- Sleep schedule recommendations with alarm reminders
- Integration of sleep patterns with meal/exercise plans

### Integrations
- Sync with popular calendar services (Google, Apple, Outlook)
- Display calendar events within the app
- Link meal/exercise plans to existing calendar events
- Current weather display and forecasts
- Weather-appropriate activity recommendations
- Indoor alternatives for unfavorable weather
- Weather-based reminders (e.g., umbrella alerts)

### Nutrition Information
- Barcode scanning for packaged foods with external database integration
- Photo recognition for food items and nutrition labels
- Manual entry for custom foods and recipes
- Comprehensive nutrition tracking and analysis
- Allergen detection and dietary restriction compliance
- Plan vs. actual nutrition intake comparison

### Grocery & Shopping
- Automatic grocery list generation from meal plans
- Smart shopping list organization by store section
- Inventory tracking for pantry/fridge items
- Expiration date tracking with usage reminders
- Local grocery store integration and deals
- Barcode scanning for inventory management

### Personalization & Learning
- Track food preferences, likes, and dislikes
- Analyze eating habits and patterns
- Adapt suggestions based on feedback and behavior
- Incorporate dietary restrictions and allergies
- Seasonal and local produce awareness
- Location-aware meal recommendations

### Progress Tracking
- Log completed tasks and consumed meals
- Track progress toward daily/weekly goals
- Plan vs. actual comparison for nutrition, exercise, and tasks
- Automatic adjustments to future plans based on progress
- Performance feedback and improvement suggestions
- Manual data input and correction capabilities
- Comprehensive analytics and trend analysis
- Visual progress charts and reports
- Exportable progress data for healthcare providers

### User Experience
- Daily briefing with schedule summary
- Weather forecast overview
- Important reminders (medications, deadlines)
- Customizable briefing content
- Context-aware task sequencing
- Location-aware task prioritization

### Family & Caregiver Support
- Multi-user family accounts with shared planning
- Caregiver access with oversight permissions
- Individual profiles within family accounts
- Shared grocery lists and meal planning
- Family nutrition tracking and aggregation
- Caregiver notifications and alerts
- Emergency contact integration
- Progress sharing with healthcare providers

## Technical Considerations

### Agentic AI Architecture
To handle "squishy" user input and provide adaptive, personalized planning, PLND should be built on an agentic AI architecture:

- **Natural Language Understanding**: Process unstructured user input (e.g., "I'm feeling tired today" or "I want something comforting but healthy")
- **Contextual Awareness**: Maintain user context across sessions (mood, energy levels, recent preferences)
- **Adaptive Decision Making**: Dynamically adjust recommendations based on real-time feedback and changing circumstances
- **Multi-Modal Interaction**: Support text, voice, and potentially image input for meal logging
- **Explainable AI**: Provide transparent reasoning for suggestions ("Recommending this meal because you rated similar dishes highly and have these ingredients available")

### Key AI Components:
1. **Intent Recognition**: Classify user requests (meal planning, exercise adjustment, preference update)
2. **Preference Modeling**: Maintain and update user preference profiles over time
3. **Constraint Satisfaction**: Balance multiple factors (nutrition, preferences, ingredients, time) in real-time
4. **Conversational Memory**: Remember past interactions and references within conversations
5. **Proactive Suggestions**: Anticipate needs based on patterns and context

### Implementation Approach:
- Use a modular agent system where different agents handle specific domains (nutrition, exercise, scheduling)
- Implement a coordinator agent to mediate between domain-specific agents and present unified recommendations
- Build on foundation models with fine-tuning for health/nutrition domains
- Include feedback loops for continuous learning and improvement

## Development Roadmap

### Current Status: Phase 1 COMPLETED | Phase 2 COMPLETED | Phase 2.5 COMPLETED | Phase 3.0 COMPLETED

### Phase 1: Foundation (Core Infrastructure) — COMPLETED
**Goal**: Set up development environment and implement basic authentication

**Tasks:**
- [x] **Project Setup**
  - [x] Initialize Rust backend with Axum
  - [x] Set up Angular frontend with NgRx
  - [x] Configure Docker Compose development environment
  - [x] Create basic project structure and build scripts

- [x] **Database Foundation**
  - [x] Set up PostgreSQL with SQLx
  - [x] Implement database connection pooling
  - [x] Create initial migration system
  - [x] Design core database schemas (users, auth)

- [x] **Authentication System**
  - [x] **Provider-Agnostic OAuth Architecture**: Trait-based design for multiple providers
  - [x] **Mock OAuth Provider**: navikt/mock-oauth2-server integration for development
  - [x] **JWT-Based Authentication**: Secure token generation and validation
  - [x] **Configuration-Driven**: TOML-based provider configuration
  - [x] **Rust Implementation**: Full Axum integration with async support
  - [x] **Docker Integration**: Mock OAuth server in development environment
  - [x] **API Endpoints**: OAuth authorization and callback routes
  - [x] **Middleware**: JWT validation for protected routes

- [x] **Basic API Structure**
  - [x] Set up Axum router and middleware
  - [x] Create error handling framework
  - [x] Implement request validation
  - [x] Add API documentation (OpenAPI/Swagger)

**Deliverables:**
- [x] Working development environment
- [x] Functional authentication system with mock OAuth provider
- [x] Basic API skeleton with protected routes
- [x] Dockerized services including mock OAuth server
- [x] All quality checks passing (fmt, clippy, deny, machete)

### Phase 2: Core Features — Backend & Infrastructure — COMPLETED
**Goal**: Implement the minimum viable planning features (backend, data model, and infrastructure). UI features moved to Phase 2.5 pending overall UI design.

> **Data Model Reference**: See [`DOMAIN_MODEL.md`](./DOMAIN_MODEL.md) for the authoritative domain and scheduling model — entity hierarchy, catalog layer, schedule template/instance pattern, dynamic adjustment, and family coordination. All Phase 2 meal, exercise, and scheduling work should be grounded in that document.

**Tasks:**
- [x] **Secrets Management (Doppler)**
  - [x] All sensitive credentials stored in Doppler (`plnd/dev`); `justfile` wraps relevant commands with `doppler run --`; `docker-compose.yml` uses env var interpolation; non-sensitive config remains in TOML

- [x] **Authentication UI & App Shell**
  - [x] Login page, OAuth callback handler, Angular auth guard, main layout shell (sidebar + navbar), NavbarAvatar component, and signals-based AuthService/UserService/PreferencesService

- [x] **User Management**
  - [x] User profile CRUD (`display_name`, `avatar_url`), theme preferences, dietary restrictions CRUD (backend + Angular UI), and 4-step onboarding wizard (all steps skippable, `onboarding_completed` persisted in DB)

- [x] **Domain Model Database Schema**
  - [x] 3-layer catalog hierarchy: `catalog_ingredients` → `catalog_dishes` → `catalog_meals`; personal libraries (`user_dishes`, `user_meals`, `user_exercises`); family model; task model (`meal_tasks`, `exercise_tasks`, `work_tasks`, `generic_tasks`); scheduling model (`schedule_templates`, `schedule_entries`); nutrition/allergens enterable at any layer with `_overridden` flags

- [x] **Catalog Population Infrastructure**
  - [x] Trait-based external clients: `NutritionProvider` (USDA FDC, Open Food Facts), `RecipeProvider` (TheMealDB), `ExerciseProvider`; all config-driven and offline-testable
  - [x] `ProviderSearchService`: concurrent fan-out via `tokio::spawn`, TTL cache (moka, 36h), local PostgreSQL FTS first then external providers; `GET /search/{ingredients,dishes,exercises}` protected routes
  - [x] `plnd_data` library crate (Axum/SQLx-free); `plnd_seed` crate with idempotent catalog seeding, background startup task, and `just seed` operator command; 124 tests passing
  - *(Future — Phase 3)*: AI-guided catalog curation deferred to LLM integration phase

- [x] **Catalog & Library API** *(Ingredient → Dish → Meal)*
  - [x] `user_dish_prefs`/`user_meal_prefs`/`user_ingredient_prefs` tables; catalog detail + ingest endpoints; unified `/my/{dishes,meals}` library with transparent copy-on-write fork; ingredient pref blocking respected in search; Angular signals-based service layer

**Deliverables:**
- [x] Secrets management via Doppler
- [x] Authentication UI and app shell
- [x] User profile, preferences, dietary restrictions, and onboarding wizard
- [x] Domain model database schema (3-layer catalog hierarchy, personal libraries, family model, task and scheduling models)
- [x] External provider clients (USDA FDC, Open Food Facts, TheMealDB) with search infrastructure and `plnd_data`/`plnd_seed` workspace crates
- [x] Catalog & library API with transparent copy-on-write fork and Angular service layer

### Phase 2.5: UI/UX Design & Remaining Planning UI — COMPLETED
**Goal**: Complete the meal planning UI and morning briefing using the design language established during day-view development. Exercise planning and family support are indefinitely deferred.

**Tasks:**

- [x] **Day View & Schedule UI**
  - [x] `DayViewComponent` — daily schedule view; serves as the primary planning surface
  - [x] Schedule sub-components: `AddEntryComponent`, `DayHeaderComponent`, `MealRowComponent`, `TaskRowComponent`
  - [x] Route aliases `/today`, `/yesterday`, `/tomorrow` → `/day/:date` with date-validation guard
  - [x] `ScheduleService` — signals-based daily schedule state (meals, tasks, exercises)

- [x] **Meal Planning UI**
  - [x] Build meal planning UI (list, add/edit/delete dishes and meals)
  - [x] Schedule meals onto the weekly plan view
  - [x] Support recurring meal templates

- [ ] **Exercise Planning Core** *(indefinitely deferred)*
  - [ ] Implement exercise CRUD API endpoints
  - [ ] Build workout planning UI (list, add/edit/delete)
  - [ ] Schedule workouts onto the weekly plan view
  - [ ] Support recurring exercise templates

- [ ] **Family Support Foundation** *(indefinitely deferred)*
  - [ ] Create family account schema and API
  - [ ] Build family profile management UI
  - [ ] Enable shared meal planning for family members
  - [ ] Implement caregiver access roles and permissions

- [x] **Morning Briefing** — *See `docs/superpowers/specs/2026-03-23-morning-briefing-design.md`*
  - [x] Briefing data model (`wake_time` on user_preferences)
  - [x] Briefing backend routes (`/briefing/weather`, `/briefing/news`, `/briefing/yesterday`)
  - [x] BriefingService (Angular)
  - [x] BriefingHeaderComponent (weather + news cards)
  - [x] YesterdaySnapshotComponent (light recap strip)
  - [x] DayViewComponent `isToday` wiring

**Deliverables:**
- [x] Day view with daily schedule (meals, tasks, exercises) and `/today`/`/yesterday`/`/tomorrow` route aliases
- [x] Meal planning UI
- [x] Morning briefing
- [ ] *(deferred)* Exercise planning UI
- [ ] *(deferred)* Family profile management

### Phase 3: Agentic AI
**Goal**: Platform-independent agentic AI layer with local LLM support; intent-driven task entry and AI-powered weekly meal planning

> See [`docs/superpowers/specs/2026-04-01-phase3-ai-design.md`](./docs/superpowers/specs/2026-04-01-phase3-ai-design.md) for full design.

**Tasks:**

- [x] **Prerequisite: DB Layer Migration** *(Issue [#158](https://github.com/calteran/plnd/issues/158) — completed in [#174](https://github.com/calteran/plnd/pull/174), [#177](https://github.com/calteran/plnd/pull/177))*
  - [x] Move DB layer from `plnd_api/src/db/` into `plnd_data`
  - [x] Establish clean dependency graph: `plnd_api` → `plnd_agent` → `plnd_data`

- [x] **Phase 3.0 — `plnd_agent` Foundation**
  - [x] New `plnd_agent` workspace crate (no Axum dependency)
  - [x] `LlmProvider` trait with OpenAI-compatible and Anthropic implementations
  - [x] Mock provider for CI testing
  - [x] Tiered provider registry (Fast / Capable)
  - [x] `Tool` trait, `ToolRegistry`, and `AgentLoop` with parallel tool execution
  - [x] `UseCase` enum with prompt library and provider tier mapping
  - [x] LLM config section

- [x] **Phase 3.1 — Memory System**
  - [x] `user_memories` DB migration
  - [x] Memory CRUD in `plnd_data`
  - [x] Memory injection into agent context filtered by use case
  - [x] Memory tools: get, save, update, forget

- [ ] **Phase 3.2 — Task Entry**
  - [x] DB: `schedule_entries.scheduled_start` nullable; `ScheduleStore`; `create_user_task` accepts date + bucket; `find_free_slot` removed (#332: #359, #360)
  - [x] Agent tools: `GetDayScheduleTool` (replaces `FindScheduleSlotTool`); `CreateTaskTool` accepts `date` + `after_milepost` (#332: #361)
  - [x] API: `TaskEntryRequest.date`, `ActionTaken` bucket fields, schema validator updated (#332: #362)
  - [x] `task_entry.md` prompt rewritten for bucket-based reasoning (#332: #363)
  - [x] Angular: viewed date passed to task entry API; schedule reloads after creation (#332: #364)
  - [ ] *(remaining Phase 3.2 work tracked in #289)*

- [ ] **Phase 3.3 — Meal Planning Wizard**
  - [ ] Meal planning tools: preferences, catalog search, nutrition, schedule, propose plan
  - [ ] `meal_planning.md` and `meal_rebalance.md` prompts
  - [ ] `/agent/meal-plan` route
  - [ ] Angular: planning wizard with locked-slot model for user-pinned meals

**Deliverables:**
- [x] Platform-independent LLM abstraction (`plnd_agent` crate)
- [ ] Intent-driven task entry with autonomous scheduling and UI signals
- [ ] AI-powered weekly meal planning with iterative rebalancing
- [x] User memory system

### Phase 3.5: Background Agent Jobs *(deferred)*
**Goal**: Autonomous background agents for memory improvement and proactive insights; deployable as independent binaries separate from `plnd_api`

**Tasks:**
- [ ] Memory coalescing (merge duplicates, retire stale entries)
- [ ] Pattern detection from task and schedule history
- [ ] Nutritional drift detection
- [ ] `plnd_worker` standalone binary

**Deliverables:**
- [ ] Autonomous memory improvement
- [ ] Proactive pattern and habit detection
- [ ] Independent worker binary

### Phase 4: Integration Features
**Goal**: Connect with external services and enhance functionality

**Tasks:**
- [ ] **Calendar Integration**
  - [ ] Google Calendar API integration
  - [ ] Apple Calendar API integration
  - [ ] Event synchronization
  - [ ] Conflict detection

- [ ] **Weather Integration**
  - [ ] Weather API client
  - [ ] Suggest weather-appropriate activities
  - [ ] Switch between indoor/outdoor recommendations based on forecast
  - [ ] Weather-based reminders

- [ ] **Nutrition Features**
  - [ ] Barcode scanner implementation with camera access
  - [ ] Add photo OCR for nutrition label scanning
  - [ ] Manual nutrition entry forms with validation
  - [ ] Create product database for saved foods
  - [ ] Parse and store nutrition data from all input sources

- [ ] **Grocery & Shopping Features**
  - [ ] Grocery list generation from meal plans
  - [ ] Smart list organization by store sections
  - [ ] Track pantry/fridge inventory
  - [ ] Expiration date monitoring with alerts
  - [ ] Barcode scanning for inventory management

- [ ] **Advanced Analytics**
  - [ ] Track plan vs. actual for nutrition, exercise, and tasks
  - [ ] Trend analysis and progress visualization
  - [ ] Exportable reports for healthcare providers
  - [ ] Performance metrics and insights

- [ ] **Advanced Planning**
  - [ ] Drag-and-drop interface
  - [ ] Build recurring plan template system
  - [ ] Allow per-day plan overrides
  - [ ] Support bulk editing of scheduled items

**Deliverables:**
- [ ] External service integrations
- [ ] Enhanced planning features
- [ ] Weather and calendar awareness
- [ ] Advanced nutrition tracking
- [ ] Grocery and shopping functionality
- [ ] Comprehensive analytics and reporting

### Phase 5: Mobile Implementation
**Goal**: Develop and polish the iOS application

**Tasks:**
- [ ] **Set up Capacitor for iOS**
  - [ ] Configure Capacitor for iOS
  - [ ] Set up native project structure
  - [ ] Configure iOS build pipeline
  - [ ] Add required Capacitor plugins

- [ ] **Mobile UI/UX**
  - [ ] Make all views responsive for mobile
  - [ ] Optimize UI interactions for touch
  - [ ] Implement offline capability
  - [ ] Implement native-like page transitions

- [ ] **Mobile-Specific Features**
  - [ ] Push notification setup
  - [ ] Background sync
  - [ ] Cache schedule data locally for offline use
  - [ ] Prepare App Store metadata and screenshots

- [ ] **Testing and Polish**
  - [ ] Device-specific testing
  - [ ] Performance optimization
  - [ ] App store screenshots and metadata
  - [ ] Beta testing setup

**Deliverables:**
- [ ] Functional iOS application
- [ ] App store-ready build
- [ ] Offline-capable mobile experience
- [ ] Polished mobile UI/UX

### Phase 6: Deployment and Operations
**Goal**: Prepare for production deployment and ongoing operations

**Tasks:**
- [ ] **Production Infrastructure**
  - [ ] Kubernetes cluster setup
  - [ ] CI/CD pipeline configuration
  - [ ] Set up monitoring and log aggregation
  - [ ] Implement automated backup and recovery

- [ ] **Security Hardening**
  - [ ] Security audit
  - [ ] Penetration testing
  - [ ] Data protection measures
  - [ ] Compliance checks

- [ ] **Performance Optimization**
  - [ ] Database optimization
  - [ ] Caching strategy implementation
  - [ ] Load testing
  - [ ] Performance monitoring

- [ ] **Deployment Process**
  - [ ] Staging environment setup
  - [ ] Rollback procedures
  - [ ] Zero-downtime deployment
  - [ ] Feature flag system

**Deliverables:**
- [ ] Production-ready infrastructure
- [ ] Secure and optimized application
- [ ] Automated deployment pipeline
- [ ] Monitoring and alerting system

### Phase 7: Polish and Launch
**Goal**: Final touches and official launch

**Tasks:**
- [ ] **Final Testing**
  - [ ] End-to-end testing
  - [ ] User acceptance testing
  - [ ] Performance benchmarking
  - [ ] Security validation

- [ ] **Documentation**
  - [ ] User documentation
  - [ ] API documentation
  - [ ] Developer documentation
  - [ ] Support materials

- [ ] **Marketing Preparation**
  - [ ] Landing page
  - [ ] App store listings
  - [ ] Create social media presence for launch
  - [ ] Launch materials

- [ ] **Launch Execution**
  - [ ] Coordinated release
  - [ ] Monitoring during launch
  - [ ] User support setup
  - [ ] Integrate user feedback collection

**Deliverables:**
- [ ] Fully tested application
- [ ] Complete documentation
- [ ] Successful launch
- [ ] User feedback mechanisms
