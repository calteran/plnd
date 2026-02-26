# PLND - Planning Document

## Overview
PLND (pronounced "planned") is a planner/assistant designed for neurodivergent individuals who are picky eaters or struggle with nutrition and exercise. The goal is to provide a structured yet flexible tool to help users plan meals, track nutrition, and manage exercise routines in a way that accommodates their unique needs.

## Features

### Core Features
- Secure authentication (email/password, OAuth) with persistent sessions
- User profiles for preferences, dietary restrictions, and exercise routines
- Weekly planning view with recurring plan options
- Easy day-by-day adjustments and overrides
- Drag-and-drop functionality for rearranging plans
- Notifications and reminders for upcoming plans

### Integration Features
- Sync with popular calendar services (Google, Apple, Outlook)
- Display calendar events within the app
- Link meal/exercise plans to existing calendar events

### Personalization Features
- Track food preferences, likes, and dislikes
- Analyze eating habits and patterns
- Adapt suggestions based on feedback and behavior
- Incorporate dietary restrictions and allergies

### Meal Planning Features
- Support for recurring meals (e.g., daily breakfast)
- Encourage variety in other meals for balanced nutrition
- Configurable preferences for trying new meals
- Gentle expansion of food choices through similar meal suggestions

### Food Preference System
- Rating scale (1-5 stars) for meals and ingredients
- Allergen marking with strict enforcement
- Prioritize suggestions based on preferences while avoiding disliked foods

### Safety Features
- Separate category for allergens/unsafe ingredients
- Strict exclusion of marked allergens from suggestions
- Visual warnings for potential allergens
- Safety restrictions override preference-based suggestions

### Nutrition Features
- Support for multiple guideline sets (USDA, EU, custom)
- Configurable adherence levels (strict, moderate, flexible)
- Visual feedback on guideline alignment
- Recommendations to improve nutritional balance

### Ingredient Management
- Input and track ingredients on hand
- Meal suggestions using available ingredients
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

### Additional Features
- Current weather display and forecasts
- Weather-appropriate activity recommendations
- Indoor alternatives for unfavorable weather
- Weather-based reminders (e.g., umbrella alerts)
- Summary of daily schedule and meal plan
- Weather forecast overview
- Important reminders (medications, deadlines)
- Customizable briefing content
- Log completed tasks and consumed meals
- Track progress toward daily/weekly goals
- Automatic adjustments to future plans based on progress
- Performance feedback and improvement suggestions
- Manual data input and correction capabilities

## Architecture

## User Stories

### Authentication and Identification
- **As a user, I need secure authentication** so my personal data, preferences, and progress are accurately tracked and secured
  - Secure login (email/password, OAuth) with persistent sessions
  - User profiles for preferences, dietary restrictions, and exercise routines
  - Optional multi-factor authentication for enhanced security

### Planning and Scheduling
- **As a user, I want flexible planning capabilities** to organize meals, exercise, and activities efficiently
  - Weekly planning view with recurring plan options
  - Easy day-by-day adjustments and overrides
  - Drag-and-drop functionality for rearranging plans
  - Notifications and reminders for upcoming plans

### Calendar Integration
- **As a user, I want calendar integration** to avoid scheduling conflicts and leverage existing commitments
  - Sync with popular calendar services (Google, Apple, Outlook)
  - Display calendar events within the app
  - Link meal/exercise plans to existing calendar events

### Personalization and Learning
- **As a user, I want the app to learn my food preferences** so meal suggestions improve over time
  - Track food preferences, likes, and dislikes
  - Analyze eating habits and patterns
  - Adapt suggestions based on feedback and behavior
  - Incorporate dietary restrictions and allergies

### Routine and Variety Balance
- **As a user, I want balanced meal planning** that incorporates both routine and variety
  - Support for recurring meals (e.g., daily breakfast)
  - Encourage variety in other meals for balanced nutrition
  - Configurable preferences for trying new meals
  - Gentle expansion of food choices through similar meal suggestions

### Food Preference System
- **As a user, I want a comprehensive rating system** to distinguish between preferred and avoided foods
  - Rating scale (1-5 stars) for meals and ingredients
  - Allergen marking with strict enforcement
  - Prioritize suggestions based on preferences while avoiding disliked foods

### Allergies and Safety
- **As a user, I need clear distinction between preferences and safety issues** to ensure allergen avoidance
  - Separate category for allergens/unsafe ingredients
  - Strict exclusion of marked allergens from suggestions
  - Visual warnings for potential allergens
  - Safety restrictions override preference-based suggestions

### Nutrition Guidelines
- **As a user, I want nutrition-aware meal planning** aligned with my chosen standards
  - Support for multiple guideline sets (USDA, EU, custom)
  - Configurable adherence levels (strict, moderate, flexible)
  - Visual feedback on guideline alignment
  - Recommendations to improve nutritional balance

### Ingredient Management
- **As a user, I want to reduce food waste** through ingredient-aware meal planning
  - Input and track ingredients on hand
  - Meal suggestions using available ingredients
  - Priority scheduling for ingredients marked "use soon"
  - Expiration reminders for perishable items

### Seasonal and Local Awareness
- **As a user, I want location-aware meal recommendations** that consider seasonality
  - Detect local seasonal produce
  - Prioritize seasonal ingredients in suggestions
  - Provide information about local seasonal availability
  - Optional integration with farmers' market data

### Exercise Planning
- **As a user, I want comprehensive exercise planning** to meet my fitness goals
  - Set and track fitness goals (weight loss, muscle gain, endurance)
  - Personalized exercise plans based on goals and preferences
  - Integration with daily schedules considering preferred times
  - Progress tracking and plan adjustments
  - Reminders and motivational support

### Health Integration
- **As a user, I want health-aware planning** that considers medications and sleep
  - Medication schedule tracking with effect management
  - Adjust meal timing/portions based on medication effects
  - Avoid intense exercise during medication-sensitive periods
  - Sleep schedule recommendations with alarm reminders
  - Integration of sleep patterns with meal/exercise plans

### Work and Productivity
- **As a user, I want work-aware scheduling** that integrates with my professional life
  - Track long-term work patterns and schedules
  - Add short-term tasks and deadlines
  - Adjust meal/exercise plans around work commitments
  - Work task reminders and calendar sync

### Context-Aware Scheduling
- **As a user, I want smart task sequencing** that considers my current context
  - Schedule work tasks during work hours, personal tasks during free time
  - Location-aware task prioritization
  - Context-appropriate reminders and notifications
  - Manual override capabilities

### Weather Awareness
- **As a user, I want weather-informed planning** for outdoor activities
  - Current weather display and forecasts
  - Weather-appropriate activity recommendations
  - Indoor alternatives for unfavorable weather
  - Weather-based reminders (e.g., umbrella alerts)

### Daily Briefing
- **As a user, I want a morning briefing** to start my day organized
  - Summary of daily schedule and meal plan
  - Weather forecast overview
  - Important reminders (medications, deadlines)
  - Customizable briefing content

### Progress Tracking
- **As a user, I want comprehensive progress tracking** to stay on target with my goals
  - Log completed tasks and consumed meals
  - Track progress toward daily/weekly goals
  - Automatic adjustments to future plans based on progress
  - Performance feedback and improvement suggestions
  - Manual data input and correction capabilities

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

## Next Steps

## Open Questions

## Resources

## Conclusion## Architecture

### Technology Stack

PLND uses a modern stack combining Rust's performance with Angular's productivity:

**Frontend:**
- Angular (TypeScript) with NgRx for state management
- Capacitor for iOS mobile deployment
- Angular Material for UI components
- RxJS for reactive programming

**Backend:**
- Rust with Axum web framework
- SQLx for PostgreSQL database access
- JWT for authentication
- Mistral LLM API integration

**Database:**
- Self-hosted PostgreSQL in Docker
- Single instance deployment
- Regular automated backups

**AI/ML:**
- Mistral LLM API for natural language processing
- Custom Rust tools and skills built around the LLM
- Prompt engineering for domain-specific tasks
- Function calling for structured LLM interactions

**Deployment:**
- Docker Compose for development
- Kubernetes-ready architecture for production
- CI/CD pipeline for automated deployments

### System Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                        Client Applications                    │
│  ┌───────────────────┐            ┌─────────────────────────┐  │
│  │ iOS App           │            │ Web App                │  │
│  │ (Angular +        │            │ (Angular + NgRx)       │  │
│  │ Capacitor)        │            │                        │  │
│  └───────────────────┘            └─────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌───────────────────────────────────────────────────────────────┐
│                        Rust Backend (Axum)                    │
│  ┌───────────────────┐    ┌───────────────────────────────┐  │
│  │ Authentication    │    │ Core Services:               │  │
│  │ (OAuth +         │    │ - Planning Engine            │  │
│  │ Passwordless)    │    │ - Nutrition Analysis         │  │
│  └───────────────────┘    │ - Integration Service        │  │
│                          │ - Mistral LLM Service        │  │
│                          └───────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌───────────────────────────────────────────────────────────────┐
│                        PostgreSQL (Docker)                    │
│  - User authentication and profiles                          │
│  - Meal and exercise plans                                   │
│  - Preferences and ratings                                  │
│  - LLM interaction history                                   │
└───────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌───────────────────────────────────────────────────────────────┐
│                        External Services                      │
│  ┌───────────────────┐    ┌───────────────────────────────┐  │
│  │ Mistral LLM API  │    │ Third-Party Services:         │  │
│  │                  │    │ - OAuth Providers            │  │
│  └───────────────────┘    │ - Calendar APIs              │  │
│                          │ - Weather APIs               │  │
│                          └───────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

### Mistral LLM Integration

PLND leverages Mistral's LLM capabilities through a structured integration layer:

**Integration Components:**
1. **LLM Service**: Rust backend service handling all Mistral API calls
2. **Prompt Templates**: Domain-specific prompts for meal planning, exercise suggestions, etc.
3. **Function Calling**: Mistral's tool calling feature for structured interactions
4. **Context Management**: Conversation history stored in PostgreSQL

**Example Workflow:**
```
User Request → Angular UI → Rust Backend → Mistral API → Rust Tools → Response
```

**Custom Rust Tools:**
- `meal_suggestion_tool`: Generates meal ideas based on preferences and ingredients
- `nutrition_analysis_tool`: Evaluates meal nutrition against guidelines
- `schedule_optimizer_tool`: Finds optimal time slots for activities
- `preference_updater_tool`: Adjusts user preferences based on feedback

### Authentication Architecture

**Passwordless + OAuth Flow:**
1. User chooses login method (magic link or OAuth provider)
2. Backend generates magic link or OAuth redirect
3. User completes authentication flow
4. Backend validates and issues JWT
5. All subsequent API calls include JWT for authentication

**Security Features:**
- Short-lived access tokens with refresh token rotation
- Rate limiting on authentication endpoints
- Secure token storage on client devices
- Regular token validation

### Development Environment

**Docker-Based Development:**
- Docker Compose for service orchestration
- Hot reloading for both Rust and Angular
- Shared volumes for live code updates
- Mock services for external APIs during development

**Key Containers:**
- Rust backend with development dependencies
- PostgreSQL with persistent volume
- Angular development server
- Optional: Local Mistral mock for testing

### Production Architecture

**Kubernetes-Ready Design:**
- Containerized microservices
- Horizontal pod autoscaling
- ConfigMaps and Secrets for configuration
- Persistent volumes for database
- Ingress controller for routing

**Deployment Strategy:**
1. Development: Docker Compose
2. Staging: Minikube or similar
3. Production: Kubernetes cluster (when ready)
4. CI/CD: Automated testing and deployment pipeline

### Data Architecture

**Core Data Models:**
```rust
// User and Authentication
struct User {
    id: Uuid,
    email: String,
    auth_method: AuthMethod, // OAuth or Passwordless
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

// Preferences and Profiles
struct UserPreferences {
    user_id: Uuid,
    dietary_restrictions: Vec<DietaryRestriction>,
    allergies: Vec<Allergy>,
    fitness_goals: Vec<FitnessGoal>,
    notification_settings: NotificationSettings,
}

// Planning Data
struct MealPlan {
    id: Uuid,
    user_id: Uuid,
    date: Date,
    meals: Vec<MealAssignment>,
    is_recurring: bool,
    recurrence_pattern: Option<RecurrencePattern>,
}

// LLM Interactions
struct LLMInteraction {
    id: Uuid,
    user_id: Uuid,
    session_id: Uuid,
    prompt: String,
    response: String,
    tools_used: Vec<String>,
    created_at: DateTime<Utc>,
}
```

### Evolution Path

The architecture is designed to grow with the application:

**V1 (Hobby Scale):**
- Single backend service
- Docker Compose development
- Simple VPS deployment
- Basic monitoring

**V2 (Growth):**
- Separate LLM service
- Redis caching layer
- Improved monitoring and logging
- Basic load balancing

**V3 (Scale):**
- Full Kubernetes deployment
- Database read replicas
- Advanced observability
- A/B testing framework

**V4 (Maturity):**
- Microservices architecture
- Advanced caching strategies
- Multi-region deployment
- Comprehensive security auditing

### Key Design Principles

1. **Simplicity First**: Start with the simplest solution that works
2. **Docker Everything**: Consistent environments from dev to prod
3. **Progressive Enhancement**: Build core features first, add AI enhancements
4. **Observability**: Instrument from the beginning
5. **Security by Design**: Implement security best practices early
6. **Documentation**: Maintain architecture documentation as we build

## Development Roadmap

### Phase 1: Foundation (Core Infrastructure)
**Goal**: Set up development environment and implement basic authentication

**Tasks:**
1. **Project Setup**
   - Initialize Rust backend with Axum
   - Set up Angular frontend with NgRx
   - Configure Docker Compose development environment
   - Create basic project structure and build scripts

2. **Database Foundation**
   - Set up PostgreSQL with SQLx
   - Implement database connection pooling
   - Create initial migration system
   - Design core database schemas (users, auth)

3. **Authentication System**
   - Implement passwordless email authentication
   - Add OAuth provider integration (Google/Apple)
   - Create JWT token management
   - Build session handling middleware

4. **Basic API Structure**
   - Set up Axum router and middleware
   - Create error handling framework
   - Implement request validation
   - Add API documentation (OpenAPI/Swagger)

**Deliverables:**
- Working development environment
- Functional authentication system
- Basic API skeleton
- Dockerized services

### Phase 2: Core Features (MVP Functionality)
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

**Deliverables:**
- Functional meal and exercise planning
- Basic LLM-powered suggestions
- User profile management
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
   - Nutrition database integration
   - Meal nutrition analysis
   - Guideline compliance checking
   - Personalized nutrition scoring

4. **Advanced Planning**
   - Drag-and-drop interface
   - Recurring plan templates
   - Plan override functionality
   - Bulk editing capabilities

**Deliverables:**
- External service integrations
- Enhanced planning features
- Weather and calendar awareness
- Advanced nutrition tracking

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