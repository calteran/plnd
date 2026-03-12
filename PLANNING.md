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

### Current Status: ✅ Phase 1 COMPLETED | 🚧 Phase 2 IN PROGRESS

### Phase 1: Foundation (Core Infrastructure) ✅ COMPLETED
**Goal**: Set up development environment and implement basic authentication

**Tasks:**
1. **Project Setup** ✅
   - Initialize Rust backend with Axum
   - Set up Angular frontend with NgRx
   - Configure Docker Compose development environment
   - Create basic project structure and build scripts

2. **Database Foundation** ✅
   - Set up PostgreSQL with SQLx
   - Implement database connection pooling
   - Create initial migration system
   - Design core database schemas (users, auth)

3. **Authentication System** ✅
   - ✅ **Provider-Agnostic OAuth Architecture**: Trait-based design for multiple providers
   - ✅ **Mock OAuth Provider**: navikt/mock-oauth2-server integration for development
   - ✅ **JWT-Based Authentication**: Secure token generation and validation
   - ✅ **Configuration-Driven**: TOML-based provider configuration
   - ✅ **Rust Implementation**: Full Axum integration with async support
   - ✅ **Docker Integration**: Mock OAuth server in development environment
   - ✅ **API Endpoints**: OAuth authorization and callback routes
   - ✅ **Middleware**: JWT validation for protected routes

4. **Basic API Structure** ✅
   - Set up Axum router and middleware
   - Create error handling framework
   - Implement request validation
   - Add API documentation (OpenAPI/Swagger)

**Deliverables:** ✅
- Working development environment
- Functional authentication system with mock OAuth provider
- Basic API skeleton with protected routes
- Dockerized services including mock OAuth server
- All quality checks passing (fmt, clippy, deny, machete)

### Phase 2: Core Features (MVP Functionality) 🚧 IN PROGRESS
**Goal**: Implement the minimum viable planning features

> **Data Model Reference**: See [`DOMAIN_MODEL.md`](./DOMAIN_MODEL.md) for the authoritative domain and scheduling model — entity hierarchy, catalog layer, schedule template/instance pattern, dynamic adjustment, and family coordination. All Phase 2 meal, exercise, and scheduling work should be grounded in that document.

**Tasks:**
0. **Secrets Management (Doppler)** ✅
   - ✅ All sensitive credentials stored in Doppler (`plnd/dev`): `APP_AUTH__JWT_SECRET`, `APP_DATABASE__URL`, `DB_PASSWORD`, `APP_EXTERNAL__USDA_FDC_API_KEY`, `APP_EXTERNAL__THEMEALDB_API_KEY`
   - ✅ `config/api/default.toml` sanitized: `jwt_secret` blanked out; non-sensitive values remain in TOML
   - ✅ `docker-compose.yml` uses `${DB_PASSWORD}` interpolation; credentials injected via `doppler run --`
   - ✅ `justfile` wraps `api`, `api-watch`, `dev`, and `test-run-server` with `doppler run --`
   - ✅ `load_config_with_path()` gains env var overrides for `APP_AUTH__JWT_SECRET` and `APP_EXTERNAL__THEMEALDB_API_KEY`

1. **Authentication UI & App Shell** ✅
   - ✅ Login page with Mock OAuth sign-in button
   - ✅ OAuth callback handler (extracts JWT, stores in localStorage)
   - ✅ Angular auth guard (functional guard, protects authenticated routes)
   - ✅ Main layout shell (sidebar + top navbar structure)
   - ✅ NavbarAvatar component (initials fallback, image support, dropdown menu)
   - ✅ AuthService, UserService, PreferencesService (signals-based state)

1. **User Management** 🚧
   - ✅ User profile CRUD operations (display_name, avatar_url)
   - ✅ Preferences and settings management (theme: system/light/dark)
   - ✅ Dietary restrictions CRUD (allergy/intolerance/preference types, name, notes — backend + Angular UI with signals)
   - ✅ Basic user onboarding flow (4-step wizard: Welcome → Profile → Theme → Dietary Restrictions; all steps skippable; `onboarding_completed` persisted in DB)

2. **Domain Model Database Schema** ✅
   - ✅ Implement ingredient catalog: `catalog_ingredients` (atomic food items with nutrition JSONB, allergens, external DB hooks)
   - ✅ Implement dish catalog: `catalog_dishes`, `catalog_dish_ingredients` (recipes composed of ingredients; `occasion_tags TEXT[]` replaces `meal_type` enum)
   - ✅ Implement meal catalog: `catalog_meals` (revised), `catalog_meal_dishes` (eating occasion templates composed of dishes)
   - ✅ Implement exercise catalog: `catalog_exercises`
   - ✅ Implement personal dish library: `user_dishes`, `user_dish_ingredients`
   - ✅ Implement personal meal library: `user_meals` (revised), `user_meal_dishes` (mix of catalog and personal dishes)
   - ✅ Implement personal exercise library: `user_exercises`
   - ✅ Implement family model: `families`, `family_members`, `family_meals`
   - ✅ Implement task model: `tasks`, `meal_tasks` (with `occasion_label TEXT`, `user_dish_id` for single-dish scheduling), `exercise_tasks`, `work_tasks`, `generic_tasks`
   - ✅ Implement scheduling model: `schedule_templates`, `schedule_entries`
   - ✅ Note: nutrition and allergens can be entered at any layer (ingredient / dish / meal) with `_overridden` flags to distinguish manual vs. computed values

3. **Catalog Population Infrastructure**
   - **Dev/Staging Seed Fixtures**: Static SQL seed script (~20–30 common meals/exercises); idempotent (`INSERT ... ON CONFLICT DO NOTHING`)
   - ✅ **External Client Traits** (`src/clients/`): `NutritionProvider` + `RecipeProvider` async traits; `search_*` + `get_*_by_id` methods; `ExternalClientError`; `NutritionFacts` typed struct serializes to canonical `nutrition JSONB` shape; `source_name() -> &str` drives `external_source` tagging
   - ✅ **Exercise Provider Trait** (`src/clients/exercise.rs`): `ExerciseProvider` async trait; `search_exercises` + `get_exercise_by_id`; `ExternalExercise` DTO with `muscle_groups`, `equipment`, `intensity`; concrete `WgerClient` comes in next task and tags `external_source = 'wger'`
   - ✅ **USDA FoodData Central Client** (`src/clients/usda_fdc.rs`): `UsdaFdcClient` implementing `NutritionProvider`; free API key required (env: `APP_EXTERNAL__USDA_FDC_API_KEY`); 14-nutrient ID→field mapping via `apply_nutrient()`; `serving_size_g` from `foodPortions[0]`; returns `ConfigurationError` early if key empty; tags `external_source = 'usda_fdc'`
   - ✅ **Open Food Facts Client** (`src/clients/open_food_facts.rs`): `OpenFoodFactsClient` implementing `NutritionProvider`; no auth required; all nutrients per-100g with g→mg conversion for minerals; client-side allergen filtering; strips `"en:"` prefix from allergen tags; tags `external_source = 'openfoodfacts'`
   - ✅ **TheMealDB Recipe Client** (`src/clients/themealdb.rs`): `TheMealDbClient` implementing `RecipeProvider`; free-tier key `"1"` baked in by default; `#[serde(flatten)]` captures strIngredient1–20/strMeasure1–20 dynamically; `parse_measure()` handles fractions ("1/2 cup"), attached units ("250g"), and fallback ("to taste" → ONE serving); category → `occasion_tags` mapping; tags `external_source = 'themealdb'`
   - ✅ **Config wiring**: `ExternalProvidersConfig` in `settings.rs`; `[external_providers]` section in `config/api/default.toml`; clients constructed at startup in `main.rs` with diagnostic prints
   - **Search-Through Pattern**: Local catalog first; fan out on cache miss; deduplicate by `(external_source, external_id)` before upsert
   - **Admin Seed Command**: `just seed-catalog`; safe to re-run (idempotent)
   - *(Future — Phase 3)*: AI-guided catalog curation deferred to LLM integration phase

4. **Meal Planning Core**
   - Implement meal CRUD API endpoints
   - Build meal planning UI (list, add/edit/delete)
   - Schedule meals onto the weekly plan view
   - Support recurring meal templates

5. **Exercise Planning Core**
   - Implement exercise CRUD API endpoints
   - Build workout planning UI (list, add/edit/delete)
   - Schedule workouts onto the weekly plan view
   - Support recurring exercise templates

6. **Family Support Foundation**
   - Create family account schema and API
   - Build family profile management UI
   - Enable shared meal planning for family members
   - Implement caregiver access roles and permissions

7. **Basic LLM Integration**
   - Set up Mistral API client
   - Implement basic prompt templates
   - Create simple meal suggestion tool (requires meal catalog data)
   - Add basic conversation context

**Deliverables:**
- ✅ Secrets management via Doppler (all sensitive values out of TOML/docker-compose)
- ✅ Functional authentication UI and app shell
- ✅ User profile and preferences management
- ✅ Dietary restrictions management (full CRUD, backend + Angular UI)
- ✅ User onboarding wizard (multi-step, skip-friendly, DB-persisted completion)
- ✅ Domain model database schema (3-layer Ingredient → Dish → Meal hierarchy; 6 migrations; 20 Rust model structs)
- ✅ External provider clients: USDA FDC + Open Food Facts (`NutritionProvider`) + TheMealDB (`RecipeProvider`); trait-based, offline-testable, config-driven
- Catalog population infrastructure (dev seed fixtures + search-through pattern + `just seed-catalog` command)
- Functional meal and exercise planning
- Family profile management
- Basic LLM-powered suggestions (dependent on meal/exercise data being in place)
- Core planning interfaces

### Phase 3: AI Enhancements (Intelligent Features)
**Goal**: Implement advanced LLM-powered planning capabilities

**Tasks:**
1. **Advanced LLM Tools**
   - Build LLM nutrition analysis tool
   - Build LLM schedule optimization tool
   - Build LLM preference-update tool
   - Implement context-aware suggestion engine

2. **Prompt Engineering**
   - Write domain-specific prompt templates
   - Add few-shot examples to prompt templates
   - Enforce structured output in LLM responses
   - Add LLM error handling and retry logic

3. **Conversational Interface**
   - Process natural language user input
   - Classify user request intent
   - Persist conversation context across sessions
   - Support multi-turn conversation flows

4. **Proactive Suggestions**
   - Detect patterns from user behavior history
   - Generate personalized meal/exercise recommendations
   - Auto-adjust plans based on user feedback
   - Feed user ratings back into the suggestion model

**Deliverables:**
- Intelligent planning assistant
- Context-aware suggestions
- Natural language interface
- Personalized recommendations

### Phase 4: Integration Features
**Goal**: Connect with external services and enhance functionality

**Tasks:**
1. **Calendar Integration**
   - Google Calendar API integration
   - Apple Calendar API integration
   - Event synchronization
   - Conflict detection

2. **Weather Integration**
   - Weather API client
   - Suggest weather-appropriate activities
   - Switch between indoor/outdoor recommendations based on forecast
   - Weather-based reminders

3. **Nutrition Features**
   - Integrate USDA FoodData Central API for nutrition data
   - Barcode scanner implementation with camera access
   - Add photo OCR for nutrition label scanning
   - Manual nutrition entry forms with validation
   - Create product database for saved foods
   - Parse and store nutrition data from all input sources

4. **Grocery & Shopping Features**
   - Grocery list generation from meal plans
   - Smart list organization by store sections
   - Track pantry/fridge inventory
   - Expiration date monitoring with alerts
   - Barcode scanning for inventory management

5. **Advanced Analytics**
   - Track plan vs. actual for nutrition, exercise, and tasks
   - Trend analysis and progress visualization
   - Exportable reports for healthcare providers
   - Performance metrics and insights

6. **Advanced Planning**
   - Drag-and-drop interface
   - Build recurring plan template system
   - Allow per-day plan overrides
   - Support bulk editing of scheduled items

**Deliverables:**
- External service integrations
- Enhanced planning features
- Weather and calendar awareness
- Advanced nutrition tracking
- Grocery and shopping functionality
- Comprehensive analytics and reporting

### Phase 5: Mobile Implementation
**Goal**: Develop and polish the iOS application

**Tasks:**
1. **Set up Capacitor for iOS**
   - Configure Capacitor for iOS
   - Set up native project structure
   - Configure iOS build pipeline
   - Add required Capacitor plugins

2. **Mobile UI/UX**
   - Make all views responsive for mobile
   - Optimize UI interactions for touch
   - Implement offline capability
   - Implement native-like page transitions

3. **Mobile-Specific Features**
   - Push notification setup
   - Background sync
   - Cache schedule data locally for offline use
   - Prepare App Store metadata and screenshots

4. **Testing and Polish**
   - Device-specific testing
   - Performance optimization
   - App store screenshots and metadata
   - Beta testing setup

**Deliverables:**
- Functional iOS application
- App store-ready build
- Offline-capable mobile experience
- Polished mobile UI/UX

### Phase 6: Deployment and Operations
**Goal**: Prepare for production deployment and ongoing operations

**Tasks:**
1. **Production Infrastructure**
   - Kubernetes cluster setup
   - CI/CD pipeline configuration
   - Set up monitoring and log aggregation
   - Implement automated backup and recovery

2. **Security Hardening**
   - Security audit
   - Penetration testing
   - Data protection measures
   - Compliance checks

3. **Performance Optimization**
   - Database optimization
   - Caching strategy implementation
   - Load testing
   - Performance monitoring

4. **Deployment Process**
   - Staging environment setup
   - Rollback procedures
   - Zero-downtime deployment
   - Feature flag system

**Deliverables:**
- Production-ready infrastructure
- Secure and optimized application
- Automated deployment pipeline
- Monitoring and alerting system

### Phase 7: Polish and Launch
**Goal**: Final touches and official launch

**Tasks:**
1. **Final Testing**
   - End-to-end testing
   - User acceptance testing
   - Performance benchmarking
   - Security validation

2. **Documentation**
   - User documentation
   - API documentation
   - Developer documentation
   - Support materials

3. **Marketing Preparation**
   - Landing page
   - App store listings
   - Create social media presence for launch
   - Launch materials

4. **Launch Execution**
   - Coordinated release
   - Monitoring during launch
   - User support setup
   - Integrate user feedback collection

**Deliverables:**
- Fully tested application
- Complete documentation
- Successful launch
- User feedback mechanisms

## Development Sequence Recommendations

### Recommended Order:
1. **Foundation Phase** (Blocked by nothing)
2. **Core Features Phase** (Depends on Foundation)
3. **AI Enhancements Phase** (Depends on Core Features + LLM setup)
4. **Integration Features** (Can start after Core Features)
5. **Mobile Implementation** (Can start after Core Features, parallel with Integration)
6. **Deployment and Operations** (Start after Core Features, continue throughout)
7. **Polish and Launch** (Final phase)

### Parallel Development Opportunities:
- **Frontend/Backend**: Can develop APIs and UI in parallel after contract is defined
- **Mobile/Web**: Mobile development can start after web core is stable
- **Integrations**: Calendar/weather integrations can be developed independently
- **AI Tools**: Different LLM tools can be developed in parallel

### Risk Mitigation Strategy:
1. **Start with Core**: Ensure basic planning works before AI enhancements
2. **Validate LLM Early**: Test Mistral integration with simple use cases first
3. **Mobile Last**: Focus on web first, then adapt to mobile
4. **Incremental Deployment**: Deploy basic features first, add enhancements later
5. **Feature Flags**: Allow gradual rollout of new features