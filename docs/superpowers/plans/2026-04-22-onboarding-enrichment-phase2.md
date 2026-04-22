# Onboarding Enrichment — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the hub-and-spoke onboarding wizard per the revised architecture spec and the UI visual design spec, closing superseded sub-issues and opening replacement ones aligned with the updated design.

**Architecture:** The hub screen (`/onboarding`) is both the entry point and the commit surface — there is no `/onboarding/review` route. Three new domain concepts introduced by the UI spec (Schedule Types, Meal Times, Meal Habits) each require backend models, DB migrations, and CRUD routes before frontend implementation can begin. Shared spoke chrome and `PlanningPrefsSubstep` are standalone components reused across the Tasks and Food spokes.

**Tech Stack:** Rust/Axum (backend), Angular 19 standalone components with signals (frontend), PostgreSQL (migrations via sqlx), Playwright (E2E)

**Design refs:**
- Architecture: `docs/superpowers/specs/2026-04-22-onboarding-enrichment-design.md`
- UI/Visual: `docs/superpowers/specs/2026-04-22-onboarding-ui-design.md`

---

## What Was Completed (Closed Sub-Issues)

The following sub-issues are done and their work is in `main`:

| # | Description |
|---|---|
| #486 | Backend: ScheduleTemplate repository methods + CRUD routes |
| #487 | Backend: `MealPlanRequest` extended with `plan_start` + `plan_end` |
| #488 | Backend: `is_blocked` replaced with signed `preference_score` (−2…+2) |
| #489 | Frontend: `wake_time` on `UpdatePreferencesRequest`, `ScheduleTemplate` model, RRULE util, `ScheduleTemplatesService` |
| #490 | Frontend: Onboarding parent shell (`<router-outlet>`), child routing, `OnboardingStateService` skeleton |
| #491 | Frontend: `OnboardingHubComponent` (section cards, ghost→accent CTA, completion badges) |
| #494 | Frontend: `firstRun` input + date range override on `PlanMealsStepComponent` and `PlanDayGridStepComponent` |
| #499 | Bug: `computeFirstPlanPeriod` anomalous `planEnd` fix |
| #501 | Refactor: `MealPlanResponse.week` renamed to `plan_start` |
| #507 | Fix: `currentState()` horizon mismatch when `planStart`/`planEnd` inputs override `WeekPlanService` |

---

## What Is Being Closed (Superseded Sub-Issues)

The following open sub-issues are superseded by design changes and must be closed with a reference to this plan:

| # | Reason for closure |
|---|---|
| #492 | OnboardingAccount scope changed: wake time removed (moves to Schedule Types), notifications added |
| #493 | OnboardingTasks scope changed: Schedule Types step added, structure reorganized |
| #495 | OnboardingFood scope changed: Meal Times and Meal Habits steps added, structure expanded |
| #496 | `/onboarding/review` route eliminated — hub IS the review/commit surface |
| #497 | E2E scope changed: covers new steps (Schedule Types, Meal Times, Meal Habits, hub commit flow) |

---

## Key Architecture Decisions (New vs. Old Design)

| Decision | Old design | New design |
|---|---|---|
| Commit surface | Separate `/onboarding/review` route | Hub screen when all sections complete |
| Wake time | Account section → `PATCH /preferences/me` | Schedule Types step (per day-type wake/bed window) |
| Day patterns | Not in spec | New: Schedule Types (Weekdays, Weekends, custom; wake+bed time per type) |
| Meal time windows | Not in spec | New: Meal Times step (per-slot window: Breakfast / Lunch / Dinner) |
| Recurring meals | Not in spec | New: Meal Habits step (meal name + slot + recurrence) |
| Plan length input | Arbitrary slider (1–14 days) | Segmented: 1 week / **2 weeks** (default) / 4 weeks |
| Hub CTA | "Review & Build My First Week →" → `/onboarding/review` | "Approve Plan →" → `commitPlan()` inline |
| Hub complete state | No stats; redirect to review | Stats banner (Routines / Tasks / Meals / Days counts) |
| Skip path | Not in spec | Skip modal → `/day/<today>` without committing |
| `PlanningPrefsSubstep` | Described but not isolated | Shared standalone component under `onboarding/shared/` |
| Spoke chrome | Ad-hoc per spoke | Shared standalone component: header bar + dot progress + footer |

---

## Files to Create / Modify

### Backend (`plnd_data` + `plnd_api`)

| Action | Path | Purpose |
|---|---|---|
| Create migration | `plnd_data/migrations/YYYYMMDD_create_user_schedule_types.sql` | New table: `id, user_id, name, days_bitmask (INT), wake_time TIME, bed_time TIME, is_cycle BOOL, cycle_length INT` |
| Create migration | `plnd_data/migrations/YYYYMMDD_add_meal_windows_to_preferences.sql` | Add `breakfast_window_start/end`, `lunch_window_start/end`, `dinner_window_start/end` (all `TIME NULL`) to `user_preferences` |
| Create migration | `plnd_data/migrations/YYYYMMDD_create_user_meal_habits.sql` | New table: `id, user_id, meal_name, slot (breakfast/lunch/dinner), recurrence_rule TEXT` |
| Create | `plnd_data/src/repository/schedule_types.rs` | `ScheduleTypeRepository` trait + `PgScheduleTypeRepository` impl |
| Modify | `plnd_data/src/repository/mod.rs` | Re-export `ScheduleTypeRepository` |
| Create | `plnd_data/src/repository/meal_habits.rs` | `MealHabitRepository` trait + `PgMealHabitRepository` impl |
| Modify | `plnd_data/src/repository/mod.rs` | Re-export `MealHabitRepository` |
| Modify | `plnd_data/src/repository/preferences.rs` | Add `update_meal_windows` method to `PreferencesRepository` trait |
| Modify | `plnd_api/src/models.rs` | Add `ScheduleTypeRequest/Response`, `MealHabitRequest/Response`, `PlaceTasksRequest/Response`, extend `PlanEntryRequest` with `duration_minutes?: u32` + `energy_required?: EnergyLevel` |
| Create | `plnd_api/src/routes/schedule_types.rs` | `GET /schedule/types`, `POST /schedule/types`, `PUT /schedule/types/{id}`, `DELETE /schedule/types/{id}` |
| Create | `plnd_api/src/routes/meal_habits.rs` | `GET /meal-habits`, `POST /meal-habits`, `DELETE /meal-habits/{id}` |
| Create | `plnd_api/src/routes/agent/place_tasks.rs` | `POST /agent/place-tasks` — accepts `{ task_names: string[], plan_start, plan_end }`, returns `PlanEntryRequest[]` |
| Modify | `plnd_api/src/routes/mod.rs` | Wire new route modules |
| Modify | `plnd_api/src/routes/schedule/plan.rs` | Extend `POST /schedule/plan` body to accept `schedule_type_ids: Vec<Uuid>`, `placed_tasks: Vec<PlanEntryRequest>`, `meal_habit_ids: Vec<Uuid>` alongside existing meal plan |

### Frontend (`plnd_client`)

| Action | Path | Purpose |
|---|---|---|
| Modify | `src/app/features/onboarding/onboarding-state.service.ts` | Add signals: `planningPrefsComplete`, `upcomingTaskNames`, `placedTasks`, `scheduleTypes`, `mealHabits` |
| Create | `src/app/features/onboarding/shared/spoke-chrome/spoke-chrome.ts` | Reusable spoke shell: `← Hub` header, dot progress indicator, footer with ← Back + Save & Continue → |
| Create | `src/app/features/onboarding/shared/planning-prefs-substep/planning-prefs-substep.ts` | Floating pane (plan length segmented · week start row · planning day + time); reads `planningPrefsComplete` from state; no-ops when already set |
| Modify | `src/app/features/onboarding/hub/onboarding-hub.ts` | Add stats banner, skip modal, `commitPlan()`, update CTA text + section descriptions; hub note removed |
| Implement | `src/app/features/onboarding/account/onboarding-account.ts` | Display name (pre-filled), email (pre-filled + "Pre-filled" chip), notifications (email/SMS/push toggles), future placeholder box |
| Create | `src/app/features/onboarding/tasks/substeps/schedule-types-substep/schedule-types-substep.ts` | Day-type cards (name, day pills, wake+bed time); + Add schedule type; 7-day mode and cycle mode toggle |
| Create | `src/app/features/onboarding/tasks/substeps/routines-tasks-substep/routines-tasks-substep.ts` | Recurring Routines section + Upcoming Tasks section on one pane; inspiration chips; saves templates to DB |
| Create | `src/app/features/onboarding/tasks/substeps/task-placement-review-substep/task-placement-review-substep.ts` | Day-card grid with meal dividers; AI-placed tasks with edit/remove; calls `POST /agent/place-tasks` |
| Implement | `src/app/features/onboarding/tasks/onboarding-tasks.ts` | Orchestrate 4 substeps with `SpokeChromeComponent`; dot count = 4 (3 if `planningPrefsComplete`) |
| Create | `src/app/features/onboarding/food/substeps/meal-times-substep/meal-times-substep.ts` | Breakfast / Lunch / Dinner time-window cards; saves to `PATCH /preferences/me` |
| Create | `src/app/features/onboarding/food/substeps/dietary-restrictions-substep/dietary-restrictions-substep.ts` | Moved from existing onboarding step 3; type-segmented (Allergy/Intolerance/Cultural) mini-cards |
| Create | `src/app/features/onboarding/food/substeps/dietary-preferences-substep/dietary-preferences-substep.ts` | Lifestyle collapsible (grouped chips + hover tooltips) + Ingredient Ratings (emoji scale) + Meal Ratings |
| Create | `src/app/features/onboarding/food/substeps/meal-habits-substep/meal-habits-substep.ts` | Meal name + slot pills + recurrence pills; conflict detection; chips display |
| Rewrite | `src/app/features/onboarding/food/onboarding-food.ts` | Orchestrate 6 substeps; remove direct `PlanMealsStepComponent` usage (now via MealPlanReview substep) |
| Modify | `src/app/app.routes.ts` | Remove `/review` child route |
| Delete | `src/app/features/onboarding/review/onboarding-review.ts` | No longer needed; route removed |
| Modify | `src/app/core/models/week-plan.ts` | Add `duration_minutes?: number` and `energy_required?: EnergyLevel` to `PlanEntryRequest` |
| Create | `src/app/core/services/schedule-types.service.ts` | `GET/POST/PUT/DELETE /schedule/types` |
| Create | `src/app/core/services/meal-habits.service.ts` | `GET/POST/DELETE /meal-habits` |
| Modify | `e2e/tests/onboarding.e2e.ts` | Extend for all new steps, hub stats banner, skip modal, commit flow |

---

## Implementation Tasks

### Task 1: Close superseded sub-issues

- [ ] Close #492 with comment: "Superseded by updated design spec — account scope changed (wake time removed, notifications added). New sub-issue will be opened."
- [ ] Close #493 with comment: "Superseded — Tasks spoke now has 4 steps including new Schedule Types step. New sub-issue will be opened."
- [ ] Close #495 with comment: "Superseded — Food spoke now has 6 steps including Meal Times and Meal Habits. New sub-issue will be opened."
- [ ] Close #496 with comment: "Superseded — UI design spec eliminates /onboarding/review route. The hub screen is the review/commit surface. No ReviewComponent needed."
- [ ] Close #497 with comment: "Superseded — E2E suite scope expanded to cover Schedule Types, Meal Times, Meal Habits, hub stats banner, and commit flow. New sub-issue will be opened."

---

### Task 2: Update issue #485

- [ ] Update the issue body to:
  - Reference both design specs
  - Mark all previously-open checklist items as either ✅ done or superseded
  - Replace the implementation checklist with links to the new sub-issues below
  - Note the three new domain concepts (Schedule Types, Meal Times, Meal Habits)

---

### Task 3: Backend — ScheduleType model and routes

**New sub-issue:** `feat(backend): add ScheduleType model, DB migration, and CRUD routes`

Files:
- Create: `plnd_data/migrations/YYYYMMDD_create_user_schedule_types.sql`
- Create: `plnd_data/src/repository/schedule_types.rs`
- Modify: `plnd_data/src/repository/mod.rs`
- Modify: `plnd_api/src/models.rs`
- Create: `plnd_api/src/routes/schedule_types.rs`
- Modify: `plnd_api/src/routes/mod.rs`

Steps:
- [ ] Write failing sqlx integration test for `create_schedule_type` + `list_schedule_types_for_user` + `delete_schedule_type`
- [ ] Write the DB migration (`user_schedule_types` table)
- [ ] Implement `ScheduleTypeRepository` trait + `PgScheduleTypeRepository`
- [ ] Make integration tests pass; run `just verify`
- [ ] Add `ScheduleTypeRequest` and `ScheduleTypeResponse` to `plnd_api/src/models.rs`
- [ ] Implement route handlers + wire into router
- [ ] Run `just verify`; commit

---

### Task 4: Backend — Meal windows and meal habits

**New sub-issue:** `feat(backend): add meal windows to preferences and meal habits model/routes`

Files:
- Create: `plnd_data/migrations/YYYYMMDD_add_meal_windows_to_preferences.sql`
- Create: `plnd_data/migrations/YYYYMMDD_create_user_meal_habits.sql`
- Modify: `plnd_data/src/repository/preferences.rs`
- Create: `plnd_data/src/repository/meal_habits.rs`
- Modify: `plnd_api/src/models.rs`
- Create: `plnd_api/src/routes/meal_habits.rs`

Steps:
- [ ] Write failing tests for `update_meal_windows` on `PreferencesRepository`
- [ ] Write meal window migration; implement `update_meal_windows`; pass tests
- [ ] Write failing tests for `MealHabitRepository` (create, list, delete)
- [ ] Write meal habits migration; implement `PgMealHabitRepository`; pass tests
- [ ] Add request/response models to `plnd_api/src/models.rs`
- [ ] Implement meal habits route handlers; wire into router
- [ ] Run `just verify`; commit

---

### Task 5: Backend — POST /agent/place-tasks

**New sub-issue:** `feat(backend): add POST /agent/place-tasks AI endpoint`

Files:
- Modify: `plnd_api/src/models.rs` — add `PlaceTasksRequest`, extend `PlanEntryRequest` with `duration_minutes?` + `energy_required?`
- Modify: `plnd_client/src/app/core/models/week-plan.ts` — mirror TS-side
- Create: `plnd_api/src/routes/agent/place_tasks.rs`
- Modify: `plnd_api/src/routes/mod.rs`

Steps:
- [ ] Add `duration_minutes?: u32` and `energy_required?: EnergyLevel` to Rust `PlanEntryRequest` (models.rs)
- [ ] Write integration test for `POST /agent/place-tasks` with mock LLM (or real if CI config allows)
- [ ] Implement handler: call LLM with task names + plan period; parse placements; return `Vec<PlanEntryRequest>`
- [ ] Wire route; run `just verify`; commit
- [ ] Mirror TS: add `duration_minutes?: number` and `energy_required?: EnergyLevel` to `PlanEntryRequest` in `core/models/week-plan.ts`

---

### Task 6: Backend — Extend POST /schedule/plan for full commit

**New sub-issue:** `feat(backend): extend POST /schedule/plan for full onboarding commit`

Files:
- Modify: `plnd_api/src/routes/schedule/plan.rs`
- Modify: `plnd_api/src/models.rs`

Steps:
- [ ] Add `schedule_type_ids?: Vec<Uuid>`, `placed_tasks?: Vec<PlanEntryRequest>`, `meal_habit_ids?: Vec<Uuid>` to `PostSchedulePlanRequest`
- [ ] Write integration test for commit with all three new fields populated
- [ ] Implement handler logic: expand schedule types into plan entries; insert placed tasks; apply meal habits as recurring meal entries
- [ ] Ensure existing weekly-plan tests still pass; run `just verify`; commit

---

### Task 7: Frontend — Extend OnboardingStateService

**New sub-issue:** `feat(frontend): extend OnboardingStateService for updated design`

Files:
- Modify: `src/app/features/onboarding/onboarding-state.service.ts`
- Modify: `src/app/features/onboarding/onboarding-state.service.spec.ts`

New signals to add:
- `planningPrefsComplete: signal<boolean>(false)`
- `upcomingTaskNames: signal<string[]>([])`
- `placedTasks: signal<PlanEntryRequest[]>([])`
- `scheduleTypes: signal<ScheduleTypeResponse[]>([])`
- `mealHabits: signal<MealHabitResponse[]>([])`

New methods:
- `setPlanningPrefsComplete()` — sets flag; called by `PlanningPrefsSubstep` on save
- `setUpcomingTaskNames(names)` / `setPlacedTasks(tasks)`
- `setScheduleTypes(types)` / `setMealHabits(habits)`
- `totalRoutines`, `totalTasks`, `totalMeals`, `planDays` — computed signals for the stats banner

Steps:
- [ ] Write failing unit tests for all new signals and computed values
- [ ] Add signals and methods; pass tests
- [ ] Run `just test-ng-headless`; commit

---

### Task 8: Frontend — Shared spoke chrome and PlanningPrefsSubstep

**New sub-issue:** `feat(frontend): implement shared spoke chrome and PlanningPrefsSubstep`

Files:
- Create: `src/app/features/onboarding/shared/spoke-chrome/spoke-chrome.ts`
- Create: `src/app/features/onboarding/shared/planning-prefs-substep/planning-prefs-substep.ts`
- Create: `src/app/features/onboarding/shared/planning-prefs-substep/planning-prefs-substep.spec.ts`

SpokeChromeComponent inputs:
- `@Input() title: string`
- `@Input() totalSteps: number`
- `@Input() currentStep: number`
- `@Output() backClick` / `@Output() continueClick`
- Shows `← Hub` (always), dots, `← Back` (hidden on step 0), `Save & Continue →`

PlanningPrefsSubstep behavior:
- Reads `planningPrefsComplete` from `OnboardingStateService`
- If `true`: emits `complete` immediately (host advances to next substep)
- If `false`: renders plan-length segmented (1 wk / **2 wk** / 4 wk), week-start 7-button row, planning-day + time pickers
- On save: calls `PATCH /preferences/me`, calls `service.setPlanningPrefsComplete()`, calls `service.computeAndSetPlanPeriod(today)`, emits `complete`

Steps:
- [ ] Write failing unit tests: `SpokeChromeComponent` dot rendering, back-button visibility, output emissions
- [ ] Implement `SpokeChromeComponent`; pass tests
- [ ] Write failing unit tests: `PlanningPrefsSubstep` skips when already complete; shows when not
- [ ] Implement `PlanningPrefsSubstep`; pass tests
- [ ] Run `just test-ng-headless`; commit

---

### Task 9: Frontend — OnboardingAccountComponent

**New sub-issue:** `feat(frontend): implement OnboardingAccountComponent (/onboarding/account)`

Files:
- Implement: `src/app/features/onboarding/account/onboarding-account.ts`

Design spec (UI spec, Account section):
- Display Name — text input, pre-filled, hint "Used in greetings and plan summaries"
- Email — text input, pre-filled from auth, amber border (not gray), "Pre-filled" label alongside
- Notifications section — Email toggle (shows email as subtitle), SMS toggle (reveals phone input on toggle-on), Push toggle (triggers browser permission prompt)
- Future placeholder — dashed amber box "More settings — integrations, accessibility, timezone — coming in a future update."
- Footer — uses `SpokeChromeComponent` with `totalSteps=1`, `currentStep=1`; no Back button (first/only step)
- On save: `PATCH /users/me` (display name) + `PATCH /preferences/me` (notifications); `service.markComplete('account')`; `router.navigate(['/onboarding'])`

Note: **wake time is NOT in this component** — it moved to Schedule Types step 2 of Tasks.

Steps:
- [ ] Write failing unit test for component rendering and save flow
- [ ] Implement component; pass tests
- [ ] Run `just test-ng-headless`; commit

---

### Task 10: Frontend — OnboardingTasksComponent (4 steps)

**New sub-issue:** `feat(frontend): implement OnboardingTasksComponent (/onboarding/tasks)`

Files:
- Implement: `src/app/features/onboarding/tasks/onboarding-tasks.ts`
- Create: `src/app/features/onboarding/tasks/substeps/schedule-types-substep/schedule-types-substep.ts`
- Create: `src/app/features/onboarding/tasks/substeps/routines-tasks-substep/routines-tasks-substep.ts`
- Create: `src/app/features/onboarding/tasks/substeps/task-placement-review-substep/task-placement-review-substep.ts`

Step flow (in `onboarding-tasks.ts`):
1. PlanningPrefsSubstep (conditional — skip if `planningPrefsComplete`)
2. ScheduleTypesSubstep
3. RoutinesTasksSubstep
4. TaskPlacementReviewSubstep

SpokeChromeComponent: `totalSteps = planningPrefsComplete ? 3 : 4`

**ScheduleTypesSubstep** (see UI spec, Tasks step 2):
- Two pre-configured cards: "Weekdays" (M–F) + "Weekends" (S–S)
- Each card: editable name, day pills (M T W T F S S), wake time picker, bed time picker, ✕ remove (disabled while days assigned)
- "+ Add schedule type" link
- "Non-7-day schedule?" link switches to cycle mode (cycle length + anchor date; numbered day pills 1…N)
- Saves to `POST /schedule/types` (or PUT for existing); stores response in `OnboardingStateService.scheduleTypes`

**RoutinesTasksSubstep** (see UI spec, Tasks step 3):
- Recurring Routines section: entry row (name + recurrence dropdown + Add); inspiration chips; saved templates as amber chips with inline recurrence editor
- Upcoming Tasks section: name input + Add; chips display; duration/energy deferred to next step
- Saves routines immediately via `POST /schedule/templates`; stores task names in `OnboardingStateService.upcomingTaskNames`

**TaskPlacementReviewSubstep** (see UI spec, Tasks step 4):
- On enter: calls `POST /agent/place-tasks` with `{ task_names, plan_start, plan_end }`
- Shows day-card grid (horizontal scroll on desktop, vertical on mobile)
- Day card: header (day name + date), chronological timeline with amber meal-slot dividers + task rows
- Task row: default (title + energy badge) → hovered (+ duration + slot summary + Edit button) → edit open (full edit form with Save + Remove)
- Note below grid: "Meal slots will fill in once you complete the Food & Meals section."
- "Save & Return to Hub →": stores `placedTasks` in service; `service.markComplete('tasks')`; navigate to hub

Steps:
- [ ] Write failing unit tests for ScheduleTypesSubstep (7-day mode, cycle mode, disable-✕ rule)
- [ ] Implement ScheduleTypesSubstep; pass tests; run `just test-ng-headless`
- [ ] Write failing unit tests for RoutinesTasksSubstep (add/remove routines, add/remove tasks)
- [ ] Implement RoutinesTasksSubstep; pass tests
- [ ] Write failing unit tests for TaskPlacementReviewSubstep (place-tasks call, edit form behavior)
- [ ] Implement TaskPlacementReviewSubstep; pass tests
- [ ] Wire all three substeps into `onboarding-tasks.ts` with spoke chrome; step counter logic
- [ ] Run `just test-ng-headless`; commit

---

### Task 11: Frontend — OnboardingFoodComponent (6 steps)

**New sub-issue:** `feat(frontend): implement OnboardingFoodComponent (/onboarding/food)`

Files:
- Rewrite: `src/app/features/onboarding/food/onboarding-food.ts`
- Create: `src/app/features/onboarding/food/substeps/meal-times-substep/meal-times-substep.ts`
- Create: `src/app/features/onboarding/food/substeps/dietary-restrictions-substep/dietary-restrictions-substep.ts`
- Create: `src/app/features/onboarding/food/substeps/dietary-preferences-substep/dietary-preferences-substep.ts`
- Create: `src/app/features/onboarding/food/substeps/meal-habits-substep/meal-habits-substep.ts`

Step flow (in `onboarding-food.ts`):
1. PlanningPrefsSubstep (conditional)
2. MealTimesSubstep
3. DietaryRestrictionsSubstep
4. DietaryPreferencesSubstep
5. MealHabitsSubstep
6. Meal Plan Review (use existing `PlanMealsStepComponent` with `firstRun=true`, `planStart`/`planEnd` inputs)

SpokeChromeComponent: `totalSteps = planningPrefsComplete ? 5 : 6`. Final dot renders as ring (not filled) per UI spec.

**MealTimesSubstep** (UI spec, Food step 2):
- Three amber-header cards: Breakfast / Lunch / Dinner
- Each: "From" + "To" time pickers (window, not point time)
- Note: "Tasks are generally not scheduled during meal windows."
- Saves via `PATCH /preferences/me` (breakfast/lunch/dinner window fields)

**DietaryRestrictionsSubstep** (UI spec, Food step 3):
- Moved from existing step 3 of old onboarding wizard
- Type segmented: Allergy (red) / Intolerance (amber) / Cultural/Religious (purple)
- Mini-cards (not chips) — need space for optional notes
- Inline card editing (all other cards dim to 45% opacity)
- Saves immediately via `POST /dietary-restrictions`

**DietaryPreferencesSubstep** (UI spec, Food step 4):
- Banner: "Your choices here reflect your tastes and practices…"
- Lifestyle section (collapsible): grouped chips with hover tooltips; + Add your own text input
- Ingredient Ratings: text input + 5-emoji scale (😖😕😐🙂😍); rated rows with ✕; color on selected only
- Meal Ratings: same pattern as Ingredient Ratings; saves to new endpoint or service
- Lifestyle saves as `DietaryRestriction` with `restriction_type = 'preference'`
- Ingredient ratings save via `PUT /my/ingredient-prefs/{catalogIngredientId}`

**MealHabitsSubstep** (UI spec, Food step 5):
- Entry form in amber-bordered card: meal name + slot pills (Breakfast/Lunch/Dinner) + recurrence pills (Every day/Weekdays/Weekends/Weekly…) + day picker (revealed for "Weekly…")
- Conflict detection: same slot + same recurrence → inline warning + "Add anyway" relabels button
- Added habits as amber chips: `[name] · [slot] · [recurrence] ✕`
- Saves via `POST /meal-habits`; stores in `OnboardingStateService.mealHabits`

Steps:
- [ ] Write failing unit tests for each of the 4 new substep components
- [ ] Implement MealTimesSubstep; pass tests
- [ ] Implement DietaryRestrictionsSubstep (port from old step 3 wizard); pass tests
- [ ] Implement DietaryPreferencesSubstep; pass tests
- [ ] Implement MealHabitsSubstep (conflict detection logic); pass tests
- [ ] Wire all substeps into `onboarding-food.ts`; remove direct WeekPlanService usage from host (delegate to MealPlanReview step)
- [ ] Run `just test-ng-headless`; commit

---

### Task 12: Frontend — Hub stats banner, skip modal, commit flow

**New sub-issue:** `feat(frontend): update OnboardingHubComponent for stats banner, skip modal, and commitPlan()`

Files:
- Modify: `src/app/features/onboarding/hub/onboarding-hub.ts`
- Modify: `src/app/app.routes.ts` — remove `/review` child route
- Delete: `src/app/features/onboarding/review/onboarding-review.ts` (route removed)

Changes to `onboarding-hub.ts`:
- Replace `goToReview()` with `commitPlan()`:
  1. Show "Saving…" spinner in button; disable button; dim cards + stats banner to 60% opacity
  2. `POST /schedule/plan` (routines expanded from schedule types + placed tasks + meal plan + meal habits)
  3. `POST /users/me/complete-onboarding`
  4. Navigate to `/day/<plan-start-date>`; on error: show error banner, re-enable CTA
- Rename CTA text to "Approve Plan →" (from "Review & Build My First Week →")
- Add stats banner (fades/slides in when `allSectionsComplete`; amber surface):
  - "Everything looks good" heading
  - Four stats separated by 1px dividers: Routines | Tasks | Meals | Days
  - Values from `OnboardingStateService` computed signals
- Add Skip button (visible only when any section incomplete; disappears when all complete):
  - Opens skip modal (centered overlay, warm backdrop 88% opacity)
  - Modal: "Skip setup for now?" / "Your progress is saved. You can add more detail anytime from **Settings**." / "Keep going" (ghost amber) + "Skip for now" (gray primary)
  - "Skip for now" → `/day/<today>` without committing
- Update section card descriptions to match UI spec:
  - Account: "Display name and notifications"
  - Tasks: "Recurring routines and upcoming tasks"
  - Food: "Dietary needs and first meal plan"
  - Exercise: "Coming in a future update"
- Update hub subtitle from "Complete each section to build your first week." to "Complete sections in any order"
- Remove `.hub-note` ("Future planning happens in the weekly planning wizard.")

Steps:
- [ ] Write failing unit tests: stats banner hidden when incomplete; shown when all complete; skip modal open/close; commitPlan called on CTA click
- [ ] Implement stats banner (with `allSectionsComplete` animation trigger)
- [ ] Implement skip button + modal
- [ ] Implement `commitPlan()` with submitting state + error handling
- [ ] Update section descriptions and hub subtitle
- [ ] Remove `/review` route from `app.routes.ts`
- [ ] Delete `review/onboarding-review.ts`
- [ ] Run `just test-ng-headless`; run `just verify`; commit

---

### Task 13: E2E test suite

**New sub-issue:** `test(e2e): extend onboarding.e2e.ts for updated hub-and-spoke design`

Files:
- Modify: `plnd_client/e2e/tests/onboarding.e2e.ts`

Scenarios to cover:
- Hub renders with all three sections "not started"; Exercise disabled
- Entering any section and returning marks it complete on hub
- Browser Back from a section child route returns to hub
- "Approve Plan →" ghost when 0 sections done; full amber when all 3 done
- Skip button visible with 0 sections done; opens modal; "Keep going" dismisses; "Skip for now" navigates to `/day/<today>`
- Stats banner absent before all sections complete; present + animated after last completion
- Planning Preferences shown when Tasks entered first; skipped when Tasks entered after Food (and vice versa)
- Schedule Types step: add/remove type; day pills; wake + bed time
- Routines step: add routine via form; add via inspiration chip; add upcoming task
- Task Placement Review: AI places tasks in day grid; user edits a placement; saves and returns to hub
- Meal Times step: set windows for all three slots
- Dietary Restrictions: add allergy + intolerance; edit inline
- Dietary Preferences: select lifestyle chips; rate an ingredient; rate a meal
- Meal Habits: add daily breakfast habit; conflict warning for duplicate slot+recurrence
- Meal Plan Review: generation skeleton; approve all; save and return to hub
- Full happy path: all 3 sections complete → "Approve Plan →" → submitting state → `/day/<plan-start>`
- Already-onboarded user at `/onboarding/tasks` redirects to `/today`
- Error on `POST /schedule/plan`: error banner shown; CTA re-enables

Steps:
- [ ] Write E2E scenarios above; run `just verify` to confirm all pass
- [ ] Commit

---

## Verification

End-to-end verification of the full flow:

1. `just dev` — start full Docker stack
2. Register a new user; confirm redirect to `/onboarding`
3. Complete Account section; verify hub shows Account as "✓ done"
4. Enter Tasks section as first spoke; confirm Planning Preferences appears as step 1
5. Add two schedule types; add two routines; add two task names; confirm placement review appears with AI placements
6. Return to hub; confirm Tasks "✓ done"
7. Enter Food section; confirm Planning Preferences skipped
8. Complete all 6 Food steps (meal times → restrictions → preferences → habits → meal plan review)
9. Return to hub; confirm all three sections "✓ done"; stats banner fades in
10. Tap "Approve Plan →"; confirm submitting state; confirm redirect to `/day/<plan-start>`
11. Verify `/today` shows populated schedule (routines, placed tasks, meals)
12. Register second user; skip all sections via Skip modal; confirm redirect to `/day/<today>` with no plan
13. Run `just verify` — all checks pass

---

## Dependencies / Sequencing Notes

- Tasks 3–6 (backend) can be worked in parallel by separate agents/sessions.
- Task 7 (extend StateService) can start as soon as Task 3–5 response types are known.
- Tasks 8–11 (frontend spokes) depend on Task 7 (state service) and must be sequenced after backend Tasks 3–5 are deployed to dev.
- Task 12 (hub commit) depends on all spoke implementations being complete (Tasks 9–11) and Task 6 (extended plan route).
- Task 13 (E2E) can only run when all implementation tasks are complete.
