# Onboarding Enrichment Design

**Date:** 2026-04-22
**Revised:** 2026-04-22
**Status:** Approved (revised)
**Author:** Robert Chambers

## Context

New users currently complete a 3-step onboarding wizard (welcome → profile → dietary restrictions) and are dropped into an empty day view with no tasks or meals populated. This creates a poor first-run experience: the app's value proposition — an intelligent daily planner — isn't visible until the user has manually completed at least one weekly planning session.

This design replaces the linear onboarding wizard with a hub-and-spoke "Getting Started" experience that captures enough context to generate a pre-populated first-week plan before the user ever sees the day view.

## Goals

- Land every new user in `/today` with a populated schedule (tasks + meals) for their first planning period
- Capture planning cadence preferences (week structure, plan length, planning day) that drive ongoing weekly planning
- Capture recurring routines and known one-off upcoming tasks that would otherwise need to be re-entered later
- Introduce app concepts (energy levels, mileposts, planning cadence, AI task placement) in context — onboarding is the tutorial for how the app works every week
- Support non-linear completion: users pick which focus area to tackle first
- Support browser back/forward navigation within onboarding
- Future-proof for an Exercise section without structural changes

## Non-Goals

- Re-entering the onboarding wizard after `onboarding_completed = true` (the weekly planning wizard serves that purpose)
- Saving partial wizard state across browser sessions (tasks, routines, and meal plan are in-memory; DB-backed data persists naturally)
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

### Floating Planning Preferences Pane

Planning Preferences (week start day, plan length, planning day) are required before the Food spoke can compute the first-period date range for meal plan generation. Rather than gating any spoke or adding a mandatory pre-hub step, these preferences are captured as the first pane of whichever spoke the user enters first.

**Rules:**
- If `planningPrefsComplete` is `false` when a spoke is entered, Planning Preferences is shown as the first pane before that spoke's own content
- Once saved, `planningPrefsComplete` is set to `true` and the pane is skipped for all subsequent spoke entries (including re-entry from the hub for editing)
- The Tasks & Routines and Food & Meals spokes both conditionally host this pane; the Exercise spoke will do the same when implemented

This means users encounter Planning Preferences exactly once — in whatever context feels natural to them — without being aware it's a shared dependency.

### Section: Account (`/onboarding/account`)

Intro callout: brief explanation that wake time helps PLND schedule tasks intelligently throughout the day.

Fields:
- **Display name** (optional, max 100 chars) — saved via `PATCH /users/me`
- **Wake time** (HH:MM picker) — saved via `PATCH /preferences/me`

Both fields save on "Save & Continue" which returns to hub. Section marked complete in `OnboardingStateService`.

### Section: Tasks & Routines (`/onboarding/tasks`)

This section introduces the two core ways users populate their schedule in PLND — recurring routines and one-off upcoming tasks — using the same patterns they will use every week thereafter.

An educational callout covers three concepts:
- **Planning day**: the day each week when you'll review and plan the next period
- **Energy levels**: low / medium / high — used to balance task load across days and across the week
- **Floating tasks**: tasks without a fixed time that the AI agent will schedule for you

**Sub-step 1 — Planning Preferences** *(conditional: shown only if `planningPrefsComplete = false`)*

Saves immediately to DB via `PATCH /preferences/me`:
- Week start day (day-of-week picker, default: Monday)
- Plan length in days (slider or stepper, 1–14 days, default: 7)
- Planning day of week (day-of-week picker — presented as "which day do you plan your week?"; translated to `planning_trigger_offset` relative to `week_start_day + default_plan_length_days` before sending to the API)

On save, sets `planningPrefsComplete = true` and `planPeriod` in `OnboardingStateService`.

**Sub-step 2 — Routines & Upcoming Tasks** *(single combined pane)*

Two clearly labelled sections on the same page — users see both at once to understand the distinction before entering anything.

*Recurring Routines* (saved immediately to DB as `ScheduleTemplate` records via `POST /schedule/templates`):

Inspiration chips shown above the entry form (illustrative only): "Morning walk · 7am · 30 min · daily", "Team standup · Mon–Fri · 9am · 15 min", "Evening wind-down · 9pm · 20 min · daily".

Each routine maps directly to a `ScheduleTemplate`:

| UI field | `ScheduleTemplate` field |
|---|---|
| Title | `title` |
| Recurrence: Daily / Weekdays / Weekly on [day] / Custom | `recurrence` + `recurrence_rule` (RRULE) |
| Start time | `time_window_start` |
| Duration (minutes) | `duration_minutes` |
| Energy level (low / medium / high) | `energy_required` |
| Task type | `task_type` |

Simple recurrence patterns are translated to RRULE strings client-side (e.g., Weekdays → `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR`). Custom recurrence exposes a simplified rule builder. Saved templates are displayed as removable chips below the entry form.

*Upcoming Tasks* (held in `OnboardingStateService.upcomingTaskNames` until task placement):

The same AI-assisted entry pattern users will use in the day view every day: enter a task name and the AI figures out the rest. An illustrative prompt: "Dentist appointment Thursday, finish quarterly report, pick up prescription."

Tasks are collected as a list of names and displayed as removable chips. Users are not asked for dates, times, or energy levels here — the AI handles those in the next sub-step.

**Sub-step 3 — Task Review** *(AI-generated)*

After the user taps "Place My Tasks," an agent call fires with the task names and the first-period date range (`planPeriod` from `OnboardingStateService` — already set regardless of whether Planning Preferences was captured here or in the Food spoke). The LLM returns tentative `PlanEntryRequest` placements across `plan_start – plan_end`.

The user sees each task placed into a date/time slot with AI-suggested details (time, duration, energy level). They can:
- Confirm as-is
- Edit any placement (drag to another day, adjust time/duration)
- Remove a task from the first period (it won't be added to this week but the name is preserved)

Results stored in `OnboardingStateService.placedTasks`. On "Save & Continue," the section is marked complete and the user returns to the hub. The Tasks spoke is now fully resolved — no agent work remains for Review.

### Section: Food & Meals (`/onboarding/food`)

**Sub-step 0 — Planning Preferences** *(conditional: shown only if `planningPrefsComplete = false`)*

Identical to the Planning Preferences pane described above. After saving, proceeds directly to Dietary Restrictions.

**Sub-step 1 — Dietary Restrictions** (saves immediately to DB via `POST /dietary-restrictions`):

Intro callout: "These restrictions are used every time PLND generates meals for you."

Identical UI to the current onboarding step 3 (restriction type + name + notes, displayed as removable chips). Captures medically/ethically significant constraints (allergies, intolerances, lifestyle choices).

**Sub-step 2 — Dietary Preferences** (saves immediately to DB):

Distinct from restrictions: captures the personally significant food patterns common in neurodivergent eaters — sensory aversions, strong dislikes, tolerances, and foods that make other foods more palatable — without requiring a medical or ethical framing.

- **Lifestyle shortcuts** (shown prominently at the top): quick-select chips for Vegan, Vegetarian, Pescatarian, Gluten-free, Dairy-free, etc. Each creates a `DietaryRestriction` record with `restriction_type = 'preference'`
- **Ingredient preference scale** backed by catalog ingredient search: users rate ingredients on a signed scale (−2 will refuse · −1 will tolerate · +1 enjoy · +2 strongly prefer). Stored via `PUT /my/ingredient-prefs/{catalogIngredientId}`

Framing: "Everyone has foods that just don't work for them. Tell us what to skip and what you actually like eating." This sub-step is intentionally skippable with zero entries.

**Sub-step 3 — Meal Plan** *(AI-generated, held in `OnboardingStateService` until commit)*:

Triggered automatically after dietary preferences are saved and the user advances. Calls `POST /agent/meal-plan` with the computed first-period date range (`planPeriod.start` + `planPeriod.end`). Renders using the adapted `PlanMealsStepComponent` (with `firstRun: true` input, which suppresses carryover references and shows a first-run welcome callout).

User can approve / edit / skip individual meal slots. Section marked complete when user taps "Save & Continue."

### Review & Commit (`/onboarding/review`)

The Review step is a pure read-and-confirm aggregator. All agent work is already done — tasks were placed in the Tasks spoke, meals were generated in the Food spoke. No agent call fires on Review entry.

Renders using the adapted `PlanDayGridStepComponent` (with `firstRun: true` input). Shows the full first-period day grid combining:
- Routines expanded into dated `PlanEntryRequest` records (from `ScheduleTemplate` records)
- Placed upcoming tasks (from `OnboardingStateService.placedTasks`)
- Approved meals (from `OnboardingStateService.mealPlan`)
- Exercise slots (placeholder for future Exercise section)

**First-period date range logic** (computed in Planning Preferences sub-step, stored in `OnboardingStateService.planPeriod`):
- `plan_start` = today
- Compute `first_trigger_date`: the next date on which PLND would prompt weekly planning, derived from `week_start_day`, `default_plan_length_days`, and `planning_trigger_offset`
- Compute `days_until_trigger` = `first_trigger_date` − today
- If `days_until_trigger / default_plan_length_days < 0.15`: set `plan_end` to the *second* trigger date instead, giving the user a meaningful first period
- Otherwise `plan_end` = today + `default_plan_length_days`
- Displayed: "Planning your first [N] days: [start date] – [end date]"

**Template application:**
The Review component fetches the user's `ScheduleTemplate` records via `GET /schedule/templates`. Each template is shown with a toggle: "Include in first week?" defaulting to on. Toggled-on templates are expanded client-side into `PlanEntryRequest` records across `plan_start`–`plan_end` using the template's `recurrence` / `recurrence_rule`.

**Commit sequence:**
1. `POST /schedule/plan` — commits expanded routines + placed tasks + approved meals
2. `POST /users/me/complete-onboarding` — sets `onboarding_completed = true`
3. Guard redirects to `/today`

## Architecture

### Component tree

```
OnboardingComponent (parent shell, provides OnboardingStateService)
  ├── OnboardingHubComponent              (/onboarding)
  ├── OnboardingAccountComponent          (/onboarding/account)
  ├── OnboardingTasksComponent            (/onboarding/tasks)
  │     ├── PlanningPrefsSubstep          (conditional: only if !planningPrefsComplete)
  │     ├── CombinedEntrySubstep          (routines + upcoming tasks, single pane)
  │     └── TaskPlacementReviewSubstep    (AI placement; user confirms before returning to hub)
  ├── OnboardingFoodComponent             (/onboarding/food)
  │     ├── PlanningPrefsSubstep          (conditional: only if !planningPrefsComplete)
  │     ├── DietaryRestrictionsSubstep    (extracted from existing onboarding step 3)
  │     ├── DietaryPreferencesSubstep     (new)
  │     └── PlanMealsStepComponent        (adapted, firstRun input)
  └── OnboardingReviewComponent           (/onboarding/review)
        └── PlanDayGridStepComponent      (adapted, firstRun input — shows tasks + meals + exercises)
```

`PlanningPrefsSubstep` is a standalone component reused in both `OnboardingTasksComponent` and `OnboardingFoodComponent`. It reads `planningPrefsComplete` from `OnboardingStateService` to determine whether to render; the host spoke does not need conditional logic in its template beyond passing the service signal.

### OnboardingStateService

Provided at `OnboardingComponent` level — lives exactly as long as the user is in the onboarding flow and is destroyed on completion.

```typescript
interface OnboardingState {
  // Section completion
  sectionStatus: Record<'account' | 'tasks' | 'food', 'not-started' | 'complete'>;

  // Planning prefs — shared dependency for planPeriod computation
  planningPrefsComplete: boolean;                    // gates floating pane in all spokes

  // Plan period — set by PlanningPrefsSubstep, wherever it first appears
  planPeriod: { start: string; end: string } | null; // ISO dates

  // Tasks spoke output
  upcomingTaskNames: string[];                       // names entered in CombinedEntrySubstep
  placedTasks: PlanEntryRequest[];                   // LLM placements confirmed in TaskPlacementReviewSubstep

  // Food spoke output
  mealPlan: MealPlanResponse | null;                 // held until POST /schedule/plan

  // Contextual hint for meal plan generation
  enjoyedIngredients: string[];
}
```

`ScheduleTemplate` records are fully DB-backed and not held in component state. `placedTasks` (one-off tasks) and `mealPlan` are held in state until the final `POST /schedule/plan` commit.

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

### New files — frontend
- `plnd_client/src/app/features/onboarding/onboarding-state.service.ts`
- `plnd_client/src/app/features/onboarding/hub/onboarding-hub.ts`
- `plnd_client/src/app/features/onboarding/account/onboarding-account.ts`
- `plnd_client/src/app/features/onboarding/tasks/onboarding-tasks.ts`
- `plnd_client/src/app/features/onboarding/shared/planning-prefs-substep.ts` — shared floating pane (reused in Tasks and Food)
- `plnd_client/src/app/features/onboarding/tasks/substeps/combined-entry-substep.ts` — routines + upcoming tasks
- `plnd_client/src/app/features/onboarding/tasks/substeps/task-placement-review-substep.ts` — LLM placement review
- `plnd_client/src/app/features/onboarding/food/onboarding-food.ts`
- `plnd_client/src/app/features/onboarding/review/onboarding-review.ts`
- `plnd_client/src/app/core/services/schedule-templates.service.ts` — `GET/POST/DELETE /schedule/templates`
- `plnd_client/src/app/core/models/schedule-template.ts` — `ScheduleTemplate` interface + RRULE translation util

### Modified files — frontend
- `plnd_client/src/app/features/onboarding/onboarding.ts` — rewritten as parent shell with `<router-outlet>`
- `plnd_client/src/app/features/onboarding/onboarding.scss` — extended for hub layout
- `plnd_client/src/app/app.routes.ts` — child route tree
- `plnd_client/src/app/core/models/preferences.ts` — add `wake_time` to `UpdatePreferencesRequest`
- `plnd_client/src/app/features/planning/steps/plan-meals-step.ts` — add `firstRun` input
- `plnd_client/src/app/features/planning/steps/plan-day-grid-step.ts` — add `firstRun` input
- `plnd_client/src/app/core/models/week-plan.ts` — add `duration_minutes` and `energy_required` to `PlanEntryRequest`
- `plnd_api/src/models.rs` — add `duration_minutes` and `energy_required` to Rust `PlanEntryRequest` struct
- `plnd_client/e2e/tests/onboarding.e2e.ts` — extended for hub navigation + section flows

### New backend work required

**`plnd_data`:**
- New repository trait methods: `create_template`, `list_templates_for_user`, `delete_template`
- New repository implementation in `plnd_data/src/repository/`

**`plnd_api`:**
- `GET /schedule/templates` — list the authenticated user's templates
- `POST /schedule/templates` — create a template from `ScheduleTemplate` fields
- `DELETE /schedule/templates/{id}` — delete a template
- Extend `POST /agent/meal-plan` to accept `plan_start` + `plan_end` instead of only `week_start`; update `MealPlanRequest` struct and agent prompt accordingly
- New `POST /agent/place-tasks` endpoint — accepts task names + `plan_start` + `plan_end`; returns `PlanEntryRequest[]` with AI-suggested date, time, duration, energy level per task

### Existing endpoints used
`PATCH /preferences/me`, `PATCH /users/me`, `POST /dietary-restrictions`, `PUT /my/ingredient-prefs/{id}`, `POST /agent/meal-plan`, `POST /agent/place-tasks`, `POST /schedule/plan`, `POST /users/me/complete-onboarding`.

## Data Model Notes

**`UpdatePreferencesRequest` missing `wake_time`:** The TypeScript model in `core/models/preferences.ts` currently omits `wake_time`. This field must be added before the Account section can save it — the Rust backend already accepts it via `patch_preferences`.

**`planning_trigger_offset` translation:** The backend stores a signed integer (−14 to +14 days). It is added to `plan_start` of the **next** plan period to compute the trigger date (`plnd_data/src/db/tasks.rs:18`). Negative values fire before the new period starts (typical case). UI derivation: `offset = ((planningDay − weekStartDay) % 7 + 7) % 7; if (offset > 0) offset −= 7;` — result in [−6, 0], e.g. "plan Friday, week starts Monday" → −3.

**`PlanEntryRequest` missing `duration_minutes` and `energy_required`:** Both the task placement agent response (`POST /agent/place-tasks`) and client-side template expansion need to carry duration and energy level into committed entries. `PlanEntryRequest` must be extended with optional `duration_minutes?: number` and `energy_required?: EnergyLevel` fields. This requires updates to both the TypeScript interface (`plnd_client/src/app/core/models/week-plan.ts`) and the Rust struct (`plnd_api/src/models.rs:49`). Template expansion must explicitly map `ScheduleTemplate.duration_minutes` and `ScheduleTemplate.energy_required` into the resulting `PlanEntryRequest` records.

**`user_ingredient_prefs` schema extension:** Extend with `preference_score SMALLINT DEFAULT 0 CHECK (BETWEEN -2 AND 2)`. Migrate `is_blocked = true → preference_score = -2`, drop `is_blocked`. Scale: −2 will refuse · −1 will tolerate · 0 neutral · +1 enjoy · +2 strongly prefer. Tracked as backend sub-issue.

## Testing

### E2E (extend `onboarding.e2e.ts`)
- Hub renders with all three sections in "not started" state
- Navigating into a section and returning marks it complete on hub
- Browser back button from a section child route returns to hub
- "Review" button has ghost style with 0 sections complete; accent style with all 3 complete
- Planning Preferences pane appears when Tasks is entered first; skipped when Tasks is entered after Food
- Planning Preferences pane appears when Food is entered first; skipped when Food is entered after Tasks
- Full happy path: complete all 3 sections → review → commit → `/today` with populated schedule
- Partial path: skip Food section → review → commit → `/today` with no meals
- Tasks spoke with zero routines and zero tasks still completes the section and returns to hub
- Already-onboarded user accessing `/onboarding/tasks` redirects to `/today`

### Unit tests
- `OnboardingStateService` — section status transitions, plan period computation, `planningPrefsComplete` gate
- `RoutineEntry` expansion util — daily, weekdays, weekly-on-day patterns across 7-day and 14-day periods; boundary: 15% completion ratio threshold for extending to second trigger date
- `PlanningPrefsSubstep` — renders when `planningPrefsComplete = false`; skips render when `true`

## Open Questions — Resolved

1. **`planning_trigger_offset` derivation** ✅ — `offset = ((planningDay − weekStartDay) % 7 + 7) % 7; if (offset > 0) offset −= 7;`. Result in [−6, 0]. Backend adds offset to `plan_start` of the **next** period (`plnd_data/src/db/tasks.rs:18`).

2. **Meal plan date range** ✅ — `MealPlanRequest` (`plnd_api/src/models.rs:182`) currently accepts only `week_start`. Add `plan_start: NaiveDate` and `plan_end: NaiveDate`; update agent prompt from "the week beginning {week}" to "the period {plan_start} through {plan_end}".

3. **`PlanMealsStepComponent` date coupling** ✅ — Add `@Input() planStart?: string` and `@Input() planEnd?: string` to both `PlanMealsStepComponent` and `PlanDayGridStepComponent`. When set, overrides `WeekPlanService`'s `horizonDays`.

4. **Ingredient preference data model** ✅ — Extend `user_ingredient_prefs` with `preference_score SMALLINT`. See Data Model Notes above.

5. **Dietary lifestyle shortcuts** ✅ — Create `DietaryRestriction` with `restriction_type = 'preference'`. No schema changes needed.

6. **Planning Preferences dependency between spokes** ✅ — Resolved via floating pane (Option A): `PlanningPrefsSubstep` appears as the first pane of whichever spoke is entered first; `planningPrefsComplete` flag in `OnboardingStateService` ensures it is shown exactly once.

7. **One-off upcoming task entry** ✅ — Task name only (matches day-view AI-assisted pattern). Names held in `upcomingTaskNames`; LLM places them at end of Tasks spoke via `POST /agent/place-tasks`. Results confirmed by user in `TaskPlacementReviewSubstep` before returning to hub. Review step is agent-free.
