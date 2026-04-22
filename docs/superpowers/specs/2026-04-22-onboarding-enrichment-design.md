# Onboarding Enrichment Design

**Date:** 2026-04-22
**Status:** Approved
**Author:** Robert Chambers

## Context

New users currently complete a 3-step onboarding wizard (welcome → profile → dietary restrictions) and are dropped into an empty day view with no tasks or meals populated. This creates a poor first-run experience: the app's value proposition — an intelligent daily planner — isn't visible until the user has manually completed at least one weekly planning session.

This design replaces the linear onboarding wizard with a hub-and-spoke "Getting Started" experience that captures enough context to generate a pre-populated first-week plan before the user ever sees the day view.

## Goals

- Land every new user in `/today` with a populated schedule (tasks + meals) for their first planning period
- Capture planning cadence preferences (week structure, plan length, planning day) that drive ongoing weekly planning
- Capture recurring routines that would otherwise need to be re-entered every weekly planning cycle
- Introduce app concepts (energy levels, mileposts, planning cadence) in context, not via a separate tutorial
- Support non-linear completion: users pick which focus area to tackle first
- Support browser back/forward navigation within onboarding
- Future-proof for an Exercise section without structural changes

## Non-Goals

- Creating persistent `ScheduleTemplate` records for recurring tasks (V1 expands routines client-side at commit)
- Re-entering the onboarding wizard after `onboarding_completed = true` (the weekly planning wizard serves that purpose)
- Saving partial wizard state across browser sessions (routines and meal plan are in-memory; DB-backed data persists naturally)
- The Exercise hub section (card is present but disabled)
- Implementation of push notifications or reminders (wake time is captured but the notification scheduler is Phase 5)

## User Experience

### Hub Screen (`/onboarding`)

The hub is the landing screen for all new users. It presents four section cards in a fixed order: Account, Tasks & Routines, Food & Meals, Exercise (disabled). Each card shows:

- Icon, title, one-line description of what the section configures
- Completion badge: "not started" (muted) → "✓ done" (accent) after the user returns from the section

A "Review & Build My First Week →" CTA sits below the cards. It is always visible and clickable, but renders as a ghost/secondary button until all three active sections (Account, Tasks & Routines, Food & Meals) are marked complete, at which point it becomes the full accent primary button. A note below it reads: "Future planning happens in the weekly planning wizard."

Any completed section can be re-entered from the hub for editing before the user commits.

### Navigation

Angular child routes under `/onboarding` provide native back/forward support:

| Path | View |
|---|---|
| `/onboarding` | Hub (default child) |
| `/onboarding/account` | Account section |
| `/onboarding/tasks` | Tasks & Routines section |
| `/onboarding/food` | Food & Meals section |
| `/onboarding/review` | Review & commit |

The existing `onboardingNotCompletedGuard` covers the parent route and all children. Navigating to any child while `onboarding_completed = true` redirects to `/today`.

### Section: Account (`/onboarding/account`)

Intro callout: brief explanation that wake time helps PLND schedule tasks intelligently throughout the day.

Fields:
- **Display name** (optional, max 100 chars) — saved via `PATCH /users/me`
- **Wake time** (HH:MM picker) — saved via `PATCH /preferences/me`

Both fields save on "Save & Continue" which returns to hub. Section marked complete in `OnboardingStateService`.

### Section: Tasks & Routines (`/onboarding/tasks`)

Opens with an educational callout covering three concepts:
- **Planning day**: the day each week when you'll review and plan the next period (PLND will surface the planning wizard automatically)
- **Energy levels**: low / medium / high — used to schedule tasks at the right time of day
- **Floating tasks**: tasks without a fixed time that the AI agent will schedule for you

**Planning Preferences sub-step** (saves immediately to DB via `PATCH /preferences/me`):
- Week start day (day-of-week picker, default: Monday)
- Plan length in days (slider or stepper, 1–14 days, default: 7)
- Planning day of week (day-of-week picker — presented as "which day do you plan your week?"; the value is translated to `planning_trigger_offset` relative to `week_start_day + default_plan_length_days` before sending to the API)

**Routines sub-step** (held in `OnboardingStateService` until commit):

Freeform entry. Each routine has:
- Title (required)
- Recurrence pattern: Daily | Weekdays | Weekly on [day] | Custom
- Scheduled time (optional HH:MM)
- Duration (minutes)
- Energy level (low / medium / high)
- Task type (exercise / work / personal / other)

Inspiration chips shown above the entry form (non-selectable, illustrative only): "Morning walk · 7am · 30 min · daily", "Team standup · Mon–Fri · 9am · 15 min", "Evening wind-down · 9pm · 20 min · daily".

Section marked complete when user taps "Save & Continue" (even with zero routines entered).

### Section: Food & Meals (`/onboarding/food`)

Intro callout: "These restrictions are used every time PLND generates meals for you."

**Dietary Restrictions sub-step** (saves immediately to DB via `POST /dietary-restrictions`):
- Identical UI to the current onboarding step 3 (restriction type + name + notes, displayed as removable chips)

**Meal Plan sub-step** (held in `OnboardingStateService` until commit):
- Triggered automatically after restrictions are saved and user advances
- Calls `POST /agent/meal-plan` with the computed first-period date range
- Renders using the adapted `PlanMealsStepComponent` (with `firstRun: true` input, which suppresses carryover references and shows a first-run welcome callout)
- User can approve / edit / skip individual meal slots

Section marked complete when user taps "Save & Continue" from the meal plan sub-step.

### Review & Commit (`/onboarding/review`)

Renders using the adapted `PlanDayGridStepComponent` (with `firstRun: true` input). Shows the full first-period day grid with all routines expanded into dated entries and all approved meals.

**First-period date range logic:**
- `plan_start` = today
- Compute `first_trigger_date`: the next date on which PLND would prompt weekly planning, derived from `week_start_day`, `default_plan_length_days`, and `planning_trigger_offset`
- Compute `days_until_trigger` = `first_trigger_date` − today
- If `days_until_trigger / default_plan_length_days < 0.15` (i.e., fewer than ~1 day away for a 7-day plan): set `plan_end` to the *second* trigger date instead, giving the user a meaningful first period
- Otherwise `plan_end` = today + `default_plan_length_days`
- The computed period is displayed to the user: "Planning your first [N] days: [start date] – [end date]"

**Routines expansion (client-side):**
Each routine in `OnboardingStateService.routines` is expanded into individual `PlanEntryInput` records covering `plan_start` through `plan_end` based on its recurrence pattern. This expansion runs in the Review component before rendering the grid.

**Commit sequence:**
1. `POST /schedule/plan` — commits expanded routines + approved meals
2. `POST /users/me/complete-onboarding` — sets `onboarding_completed = true`
3. Guard redirects to `/today`

## Architecture

### Component tree

```
OnboardingComponent (parent shell, provides OnboardingStateService)
  ├── OnboardingHubComponent         (/onboarding)
  ├── OnboardingAccountComponent     (/onboarding/account)
  ├── OnboardingTasksComponent       (/onboarding/tasks)
  │     ├── PlanningPrefsSubstep     (planning cadence fields)
  │     └── RoutinesSubstep          (freeform routine entry)
  ├── OnboardingFoodComponent        (/onboarding/food)
  │     ├── DietaryRestrictionsUI    (extracted from existing onboarding step 3)
  │     └── PlanMealsStepComponent   (adapted, firstRun input)
  └── OnboardingReviewComponent      (/onboarding/review)
        └── PlanDayGridStepComponent (adapted, firstRun input)
```

### OnboardingStateService

Provided at `OnboardingComponent` level — lives exactly as long as the user is in the onboarding flow and is destroyed on completion. Holds:

```typescript
interface OnboardingState {
  sectionStatus: Record<'account' | 'tasks' | 'food', 'not-started' | 'complete'>;
  routines: RoutineEntry[];           // expanded to PlanEntryInput[] at commit
  mealPlan: WeekPlanMeals | null;     // type from core/models/week-plan.ts; held until POST /schedule/plan
  planPeriod: { start: string; end: string } | null; // ISO dates, computed in tasks section
}
```

DB-backed section readiness (account, restrictions) is derived from existing service signals (`UserService.user()`, `PreferencesService.preferences()`, `DietaryRestrictionsService.restrictions()`), not duplicated in `OnboardingStateService`.

### Weekly planning wizard adaptations

`PlanMealsStepComponent` and `PlanDayGridStepComponent` each receive a `@Input() firstRun = false`. When `true`:
- Suppress any carryover-related UI copy
- Show a first-run welcome callout at the top of the step
- Accept the first-period date range from `OnboardingStateService` rather than deriving dates from `WeekPlanService`

No functional logic changes to the weekly planning wizard; only additive UI branching behind the `firstRun` flag.

### Routing changes

`app.routes.ts` — replace the flat `onboarding` route with a parent + children:

```typescript
{
  path: 'onboarding',
  canActivate: [authGuard, onboardingNotCompletedGuard],
  component: OnboardingComponent,
  children: [
    { path: '',       component: OnboardingHubComponent },
    { path: 'account', component: OnboardingAccountComponent },
    { path: 'tasks',   component: OnboardingTasksComponent },
    { path: 'food',    component: OnboardingFoodComponent },
    { path: 'review',  component: OnboardingReviewComponent },
  ]
}
```

## Files to Create / Modify

### New files
- `plnd_client/src/app/features/onboarding/onboarding-state.service.ts`
- `plnd_client/src/app/features/onboarding/hub/onboarding-hub.ts`
- `plnd_client/src/app/features/onboarding/account/onboarding-account.ts`
- `plnd_client/src/app/features/onboarding/tasks/onboarding-tasks.ts`
- `plnd_client/src/app/features/onboarding/food/onboarding-food.ts`
- `plnd_client/src/app/features/onboarding/review/onboarding-review.ts`
- `plnd_client/src/app/features/onboarding/shared/routine-entry.ts` (`RoutineEntry` interface + client-side expansion util)

### Modified files
- `plnd_client/src/app/features/onboarding/onboarding.ts` — rewritten as parent shell with `<router-outlet>`
- `plnd_client/src/app/features/onboarding/onboarding.scss` — extended for hub layout
- `plnd_client/src/app/app.routes.ts` — child route tree
- `plnd_client/src/app/core/models/preferences.ts` — add `wake_time` to `UpdatePreferencesRequest`
- `plnd_client/src/app/features/planning/steps/plan-meals-step.ts` — add `firstRun` input
- `plnd_client/src/app/features/planning/steps/plan-day-grid-step.ts` — add `firstRun` input
- `plnd_client/e2e/tests/onboarding.e2e.ts` — extended for hub navigation + section flows

### Backend (no changes required)
All needed endpoints already exist: `PATCH /preferences/me`, `PATCH /users/me`, `POST /dietary-restrictions`, `POST /agent/meal-plan`, `POST /schedule/plan`, `POST /users/me/complete-onboarding`.

## Data Model Notes

**`UpdatePreferencesRequest` missing `wake_time`:** The TypeScript model in `core/models/preferences.ts` currently omits `wake_time`. This field must be added before the Account section can save it — the Rust backend already accepts it via `patch_preferences`.

**`planning_trigger_offset` translation:** The backend stores a signed integer (−14 to +14 days, relative to plan end). The Tasks section UI presents this as "which day of the week do you do your planning?" and derives the offset at save time. The exact derivation must be validated against the backend's planning trigger logic during implementation (see Open Questions).

## Testing

### E2E (extend `onboarding.e2e.ts`)
- Hub renders with all three sections in "not started" state
- Navigating into a section and returning marks it complete on hub
- Browser back button from a section child route returns to hub
- "Review" button has ghost style with 0 sections complete; accent style with all 3 complete
- Full happy path: complete all 3 sections → review → commit → `/today` with populated schedule
- Partial path: skip Food section → review → commit → `/today` with no meals
- Already-onboarded user accessing `/onboarding/tasks` redirects to `/today`

### Unit tests
- `OnboardingStateService` — section status transitions, plan period computation
- `RoutineEntry` expansion util — daily, weekdays, weekly-on-day patterns across 7-day and 14-day periods; boundary: 85% completion ratio threshold for extending to second trigger date

## Open Questions (resolve during implementation)

1. **`planning_trigger_offset` derivation:** Confirm the exact arithmetic for translating "planning day of week" to the signed offset, and validate against the backend's planning trigger calculation in `plnd_api`.
2. **Meal plan date range:** Confirm `POST /agent/meal-plan` accepts an arbitrary date range (not just next-Monday-to-Sunday) — the first period may start mid-week.
3. **`PlanMealsStepComponent` date coupling:** The step currently reads dates from `WeekPlanService`. Determine whether to pass dates via `@Input()` or have the component accept an optional date range override.
4. **`wake_time` format:** Confirm the backend expects `"HH:MM"` or `"HH:MM:SS"` (the TypeScript `UserPreferences` model shows `"HH:MM:SS"`) and match the picker accordingly.
