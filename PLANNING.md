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

**Tasks:**
1. **User Management**
   - User profile CRUD operations
   - Preferences and settings management
   - Dietary restrictions and allergy tracking
   - Basic user onboarding flow

2. **Meal Planning Core**
   - Meal CRUD operations
   - Basic meal planning interface
   - Simple scheduling functionality
   - Recurring meal patterns

3. **Exercise Planning Core**
   - Exercise CRUD operations
   - Basic workout planning
   - Simple scheduling interface
   - Recurring exercise patterns

4. **Basic LLM Integration**
   - Set up Mistral API client
   - Implement basic prompt templates
   - Create simple meal suggestion tool
   - Add basic conversation context

5. **Family Support Foundation**
   - Multi-user account structure
   - Basic family profile management
   - Shared meal planning capabilities
   - Caregiver access permissions

**Deliverables:**
- Functional meal and exercise planning
- Basic LLM-powered suggestions
- User and family profile management
- Core planning interfaces

### Phase 3: AI Enhancements (Intelligent Features)
**Goal**: Implement advanced LLM-powered planning capabilities

**Tasks:**
1. **Advanced LLM Tools**
   - Nutrition analysis tool
   - Schedule optimization tool
   - Preference update tool
   - Context-aware suggestion engine

2. **Prompt Engineering**
   - Domain-specific prompt templates
   - Few-shot learning examples
   - Structured output requirements
   - Error handling and retries

3. **Conversational Interface**
   - Natural language input processing
   - Intent recognition
   - Context management across sessions
   - Multi-turn conversation support

4. **Proactive Suggestions**
   - Pattern detection from user behavior
   - Personalized recommendations
   - Adaptive planning adjustments
   - Feedback loop integration

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
   - Weather-aware activity suggestions
   - Outdoor/indoor activity switching
   - Weather-based reminders

3. **Nutrition Features**
   - USDA FoodData Central API integration for barcode scanning
   - Barcode scanner implementation with camera access
   - Photo recognition with OCR for nutrition labels
   - Manual nutrition entry forms with validation
   - Product database for saved food items
   - Nutrition data parsing and storage

4. **Grocery & Shopping Features**
   - Grocery list generation from meal plans
   - Smart list organization by store sections
   - Pantry inventory tracking system
   - Expiration date monitoring with alerts
   - Barcode scanning for inventory management

5. **Advanced Analytics**
   - Plan vs. actual tracking for nutrition/exercise/tasks
   - Trend analysis and progress visualization
   - Exportable reports for healthcare providers
   - Performance metrics and insights

6. **Advanced Planning**
   - Drag-and-drop interface
   - Recurring plan templates
   - Plan override functionality
   - Bulk editing capabilities

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
1. **Capacitor Setup**
   - Configure Capacitor for iOS
   - Set up native project structure
   - Configure build pipelines
   - Add necessary plugins

2. **Mobile UI/UX**
   - Responsive design for mobile
   - Touch-optimized interfaces
   - Offline capability implementation
   - Native-like transitions

3. **Mobile-Specific Features**
   - Push notification setup
   - Background sync
   - Local data caching
   - App store preparation

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
   - Monitoring and logging setup
   - Backup and recovery systems

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
   - Social media setup
   - Launch materials

4. **Launch Execution**
   - Coordinated release
   - Monitoring during launch
   - User support setup
   - Feedback collection system

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