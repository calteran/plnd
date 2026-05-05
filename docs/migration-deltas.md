# Migration Deltas — Working Inventory

> **Status:** Working file. Will be deleted when the architecture-alignment migration completes (per `docs/architecture.md` §11.3).
>
> **Purpose:** Catalog every place the current implementation **contradicts** `docs/architecture.md`. Sub-issues will be opened from this inventory once the catalog stabilizes.

## Method

The contradiction-vs-absence test (from the deltas-phase handoff):

- A **delta** is a place where the implementation **directly contradicts** the architecture document. Either the wrong shape, the wrong vocabulary, or behavior the doc forbids.
- An **unimplemented feature** — something the doc describes that the code has not yet built — is **not** a delta. It is later-phase work.
- **Vocabulary mismatches *are* deltas** (e.g., the codebase says "schedule_template" where the doc says "routine"). Mismatched names against an authoritative glossary are real contradictions.

When in doubt, items are logged as **open questions** rather than entries.

## Resolved during this phase

Decisions taken on open questions (recorded in architecture-doc revision 1.4, 2026-05-04):

- **§5.3 wins on terminal-tool count.** The §5.4 "exactly one terminal tool per use case" line was the contradiction; §5.3's roster (which lists `TaskEntry` as `create_task` *or* `request_clarification`) is now the canonical statement. §5.4 has been edited to allow one-or-more terminal tools per use case, citing `TaskEntry` as the multi-terminal example. Code already aligns with §5.3 — no implementation work needed.
- **"Appointment" — both meanings coexist, no conflict.** §4.4's `appointment` task category and §10's "informal synonym for scheduled task" describe different facets and don't contradict in practice (a category=appointment task often *is* a scheduled task; a category=leisure task with a fixed start time is also "informally an appointment"). No doc edit needed; both entries stand.

Code reads that closed open questions:

- **Carryover lookback semantics on backend** — confirmed contradicts §4.10. `plnd_data/src/db/schedule.rs:34-46` caps lookback at `CARRYOVER_LOOKBACK_DAYS = 90` (`plnd_data/src/models/schedule.rs:6-8`); doc says "no lookback horizon." New delta entry **I.5** below.
- **`one_shot` server-side filter** — confirmed wholly absent end-to-end (no struct, no SQL, no DTO, no handler reference). This validates Family H's "absent everywhere" framing. Carryover SELECT lacks the filter (now confirmed delta **H.5**, promoted from speculative); `commit_plan` also lacks any window-close drop pass (new delta **H.6**). Both blocked on H.1.
- **`family_meals` table active wiring** — confirmed ALIGNED with §3.4 deferral. No production code path writes to `families` / `family_members` / `family_meals`; no repository, route, agent tool, or frontend service touches them. The single API-surface leak (`ScheduleEntryResponse.family_meal_id` always serialized as `null`) is unrelated tech debt, not a delta — listed under "Independent items" below for separate tracking.

Design calls that closed open questions:

- **Exercise wizard spoke — §4.9 vs §1.1 doc-internal tension** — both readings are correct. Deferred capabilities (per §1.1) appear as permanently-disabled placeholders in the onboarding hub; the doc's spoke enumeration in §4.9 includes them as the placeholders. The current onboarding hub already implements this pattern (`Exercise [disabled]` card). J.1 remains a delta because the planning wizard does not currently match either resolution path (no disabled-exercise step, no doc clarification that linear wizards skip deferred spokes); J.1's resolution choice is a follow-on design call, not part of this phase.
- **Accessibility settings as a missing onboarding spoke** — out of scope for this phase. Both the typed accessibility prefs (already listed under Out of scope as unimplemented) and the spoke itself are deferred design work.

Additional code reads that closed open questions:

- **Dietary-restriction `preference` type** — confirmed ALIGNED. Both the DB CHECK constraint (`plnd_data/migrations/0026_cultural_religious_restriction_type.sql:6`) and the route validator (`plnd_api/src/routes/dietary_restrictions.rs:25,87-89`) accept all four types end-to-end. The onboarding UI's omission is purely a UX choice; the four-type taxonomy from §3.1 is fully implemented.
- **`meal_suggestions.rs` `slot` parameter** — confirmed ALIGNED. The handler binds `slot` directly to a `$2 = ANY(occasion_tags)` predicate against personal-library tables (`plnd_data/src/db/meal_suggestions.rs:22-57`); it never references the user's meal pattern. This is the §3.2.5 occasion-tag filter pattern, exactly as the doc sanctions. The closed enum `breakfast | lunch | dinner | snack` is a UI-input convenience, not a model constraint. Minor caveat: a user who tagged a personal dish with a non-canonical `occasion_tags` value (e.g., `"second_breakfast"`) cannot query it via this endpoint — that's a UX limitation, surfaced under "Independent items" below for separate tracking.

## How this catalog is structured

Deltas are grouped into **families**. A family is a single underlying disagreement that manifests across many files. Each family carries:

- The architecture sections it contradicts.
- A one-paragraph summary of the disagreement.
- A list of distinct **delta entries** within the family, each with `path:line` citations.
- Dependencies / sequencing notes (which families unlock or block which).

Sub-issues will be opened **per family** (or per coherent slice within a family), not per individual citation. Each entry is a verifiable check that should pass after the family's slice merges.

---

## Delta families

### Family A — Meals-vs-tasks conflation (canonical delta)

**Architecture refs:** §3.3, §4.6, §4.4

**Summary.** The doc's defining structural rule is "Meals and tasks are distinct domains." The implementation models a meal as `task_type='meal'` plus a `meal_tasks` specialization table joined off `tasks.task_id`. This conflation propagates through every consumer — schedule entries are written as tasks with `task_type='meal'`, the API surfaces the magic string in route validators, the frontend dispatches on it, and the agent layer has a load-bearing prompt warning to keep the LLM from confusing `task_type` with anchor names. **This is the canonical delta — most of Family B and parts of D, G, K depend on it.**

**Deltas:**

- **A.1 `tasks.task_type` enum includes `'meal'`** — `plnd_data/migrations/0011_tasks_and_scheduling.sql:91-103`, `plnd_data/src/models/task.rs:14`, `plnd_api/src/routes/domain_constants.rs:5-13`. The categorical task-type field stays per §4.4; `'meal'` must be removed from its enum.
- **A.2 `meal_tasks` table joins off `tasks.task_id`** — `plnd_data/migrations/0011_tasks_and_scheduling.sql:114-124`, `plnd_data/src/models/task.rs:28-35`. Same shape as `exercise_tasks`/`work_tasks`/`generic_tasks`, treating meals as a task subtype.
- **A.3 `schedule_entries.task_type` includes `'meal'`** — `plnd_data/migrations/0011_tasks_and_scheduling.sql:185`. Schedule writes flow meals through the same row schema as tasks.
- **A.4 API expands meal habits to schedule entries with `task_type: "meal"`** — `plnd_api/src/routes/schedule.rs:91-99` (`expand_habit_to_entries`), used at `:236-257` (`post_plan`).
- **A.5 Frontend `TaskType` union includes `'meal'`** — `plnd_client/src/app/core/models/schedule-template.ts:1`. Re-exported as the canonical task-type union; `'meal'` must be removed.
- **A.6 Frontend re-hydrates meals via `task_type === 'meal'`** — `plnd_client/src/app/core/services/week-plan.service.ts:119,361,375,389`, `plnd_client/src/app/core/services/schedule.service.ts` (mapEntry path).
- **A.7 Agent `place_tasks` tool has a load-bearing "NEVER use meal anchor names" workaround** — `plnd_agent/src/tools/schedule.rs:518-522` (tool-input description), `plnd_agent/src/agent/mod.rs:526-535` (schema-retry correction), `plnd_agent/src/prompts/place_tasks.md:25-29`, `:93-94`. This guard exists *because* `task_type` and anchor identifiers share lexical surface area; resolves automatically when A.1 is fixed.

**Dependencies:** Family A is the foundation. Family B (anchor/slot model) and Family G (meal pattern as first-class entity) sit on top of it; the load-bearing workaround in A.7 disappears once meals carry their own identifiers.

---

### Family B — Anchor & slot model

**Architecture refs:** §4.7, §4.8

**Summary.** The doc defines anchors as the open set `{every meal in the user's pattern, every scheduled task, implicit start-of-day, implicit end-of-day}`. Slots are positional intervals between *adjacent* anchors. The implementation positions a floating task via `after_milepost VARCHAR(10) CHECK IN ('breakfast','lunch','dinner')` plus optional `after_entry_id` — a single relational pointer with a hardcoded three-meal enum. The shape cannot represent (a) meal patterns other than B/L/D, (b) scheduled-task anchors, (c) implicit start/end-of-day anchors, or (d) the slot-as-interval-between-pair concept. This is reshape, not rename — it persists after the Family C "milepost → anchor" pure rename.

**Deltas:**

- **B.1 `schedule_entries.after_milepost` enum hardcoded `breakfast | lunch | dinner`** — `plnd_data/migrations/0011_tasks_and_scheduling.sql:185`, `plnd_data/src/models/schedule.rs:53`.
- **B.2 API validates against `VALID_AFTER_MILEPOSTS = &["breakfast", "lunch", "dinner"]`** — `plnd_api/src/routes/domain_constants.rs:30`, `plnd_api/src/routes/schedule.rs:41,58`.
- **B.3 `PlanEntryRequest` / `PlaceTasksEntry` / `ActionTaken` carry `after_milepost: Option<String>`** — `plnd_api/src/models.rs:79`, `:123`, `:305`; `plnd_api/src/api_response.rs:377,393,421,447,560,580`.
- **B.4 Frontend `ScheduleEntryDto` / `PlanEntryRequest` / `PlaceTasksEntry` carry `after_milepost`** — `plnd_client/src/app/core/models/week-plan.ts:101-111`, `:123-133`, `:154-164`; `plnd_client/src/app/core/models/agent.ts:6`; reads at `plnd_client/src/app/core/services/schedule.service.ts:127`, `plnd_client/src/app/core/services/week-plan.service.ts:119,120,366,380`.
- **B.5 Agent tool schemas hardcode the same three-meal enum** — `plnd_agent/src/tools/schedule.rs:401-405` (create_task), `:488-495` (place_tasks), `plnd_agent/src/context/mod.rs:272` (`PLACE_TASKS_RESPONSE_SCHEMA`).
- **B.6 Agent prompts teach the LLM to reason about `after_milepost` as the only positioning field** — `plnd_agent/src/prompts/task_entry.md:33,37,44,46,137,146`, `plnd_agent/src/prompts/place_tasks.md:28,34,38,45,66,69,76,94`.
- **B.7 Agent uses "bucket" vocabulary instead of "slot"** — `plnd_agent/src/prompts/task_entry.md:23,30,33-34,42-52`; `plnd_agent/src/tools/schedule.rs:130` (response field literally named `"bucket"`); `plnd_agent/src/context/mod.rs:23,399`. Term not in the §10 glossary; replacement is "slot."
- **B.8 No slot-as-domain-object exists** — verified absent across schema, models, and frontend types. Slots are implicit (positions inferred from anchor order) but the *concept* is foreclosed because positioning is via single-anchor reference rather than slot identifier.

**Dependencies:** Depends on A (a meal must have its own identity to be addressable as an anchor without going through `task_type`). B.8 is the structural reshape; B.1–B.6 are the surface-level expressions that all need to change in the same migration.

---

### Family C — "Milepost" vocabulary deprecated

**Architecture refs:** §10 ("Milepost" *(deprecated → use "anchor")*)

**Summary.** Pure-rename family, listed separately from B because the doc explicitly retires "milepost" as a term. Many citations overlap with Family B; the distinction is that even after Family B's reshape, any *remaining* surface field needs to be named "anchor," not "milepost."

**Deltas:**

- **C.1 `tasks.is_milepost` and `schedule_templates.is_milepost`** — `plnd_data/migrations/0011_tasks_and_scheduling.sql:100,159`, `plnd_data/src/models/schedule.rs:26`, `plnd_data/src/models/task.rs:19`.
- **C.2 `schedule_template.rs` route uses `is_milepost`** — `plnd_api/src/routes/schedule_template.rs:39,56,136,236`.
- **C.3 Frontend `ScheduleTemplate.is_milepost`** — `plnd_client/src/app/core/models/schedule-template.ts:16,32,45`.
- **C.4 Agent emits `is_milepost` to the LLM** — `plnd_agent/src/tools/schedule.rs:120,129`.
- **C.5 All `after_milepost` field names everywhere** — see Family B citations.

**Dependencies:** Pure rename, but coupled enough with Family B that they should ship together. Doing C alone leaves B's structural problems intact; doing B alone leaves the doc-deprecated word still in the schema.

---

### Family D — Routines vs `schedule_templates` (vocabulary + structure + recurrence shape)

**Architecture refs:** §4.5, §10

**Summary.** Three intertwined contradictions in one place: (D-vocab) the doc names this concept "routine"; the code says "schedule_template" everywhere. (D-struct) the doc says routines are tasks-only; the table accepts `task_type='meal'`. (D-recur) the doc says the canonical persisted form is an RRULE string with the curated enum derived for presentation; the code persists *both* a curated enum (as primary state) and an *optional* RRULE.

**Deltas:**

- **D.1 Vocabulary: `schedule_templates` table + `/schedule/templates` route + `ScheduleTemplate*` types** — `plnd_data/migrations/0011_tasks_and_scheduling.sql:144-167`; `plnd_api/src/routes/schedule_template.rs` (entire module); `plnd_api/src/routes/mod.rs:12`; `plnd_client/src/app/core/models/schedule-template.ts:5`; `plnd_client/src/app/core/services/schedule-templates.service.ts:8,24,36,47,58`. Note: `plnd_api/src/models.rs:271-294` already uses the correct word (`RoutineTemplateInput`) — the codebase contradicts itself between agent and CRUD layers.
- **D.2 `schedule_templates.task_type` accepts `'meal'`** — `plnd_data/migrations/0011_tasks_and_scheduling.sql:151`; `plnd_api/src/routes/schedule_template.rs:110-111,259-269`. Doc §4.5: "Routines apply only to tasks. Meals do not use the routine model." `'meal'` must be removed from the enum (the column stays — routines mirror tasks, including the categorical type per the updated §4.5).
- **D.3 Recurrence storage is enum-canonical, RRULE-optional (inverted)** — `plnd_data/migrations/0011_tasks_and_scheduling.sql:153-154`; `plnd_data/migrations/0027_schedule_template_recurrence_rule_check.sql`; `plnd_data/src/models/schedule.rs:20-21`; `plnd_api/src/routes/schedule_template.rs:28-59`; `plnd_client/src/app/core/models/schedule-template.ts:10-11`. The curated tag is the primary persisted state; the RRULE is optional. Doc says it must be the other way round, with the enum derived for presentation only.
- **D.4 Curated enum mismatch**: code stores `daily | weekdays | weekly | custom`; doc §4.5 specifies `daily | weekdays | weekly | monthly | yearly` (no `custom` — that's the advanced-disclosure path) — `plnd_data/migrations/0011_tasks_and_scheduling.sql` (CHECK), `plnd_api/src/routes/domain_constants.rs:28`, `plnd_client/src/app/core/models/schedule-template.ts:2`.
- **D.5 Onboarding routines dropdown omits `weekdays`** — `plnd_client/src/app/features/onboarding/tasks/substeps/routines-tasks-substep/routines-tasks-substep.ts:22-27`. The mapping function declares `weekdays` as a return value but the user-facing options list never produces it.
- **D.6 No round-trip from RRULE to curated enum** — `plnd_client/src/app/core/models/schedule-template.ts:50-68` is one-way (`rruleFromRecurrence`). Doc §4.5 requires round-trip (RRULE matching enum pattern → presented as enum).

**Dependencies:** D-vocab (D.1) is independent of D-struct (D.2) and D-recur (D.3, D.4, D.6). D.2 entangles with Family A (once meals are not tasks, "task_type='meal'" disappears as a possible value here too). Recommend slicing as: D-vocab in one PR, D-recur reshape in another, D-struct as part of A's resolution.

---

### Family E — Day types vs `schedule_types`

**Architecture refs:** §3.1, §4.3, §10

**Summary.** Concept exists in code (table, model, route, frontend service) but uses the deprecated name throughout. Beyond the rename, the implementation is missing the architecturally required invariants: per-meal overrides, the bitmask-XOR-cycle constraint, the mutual-exclusivity-within-user invariant, and the default-day-type-covers-all-dates guarantee.

**Deltas:**

- **E.1 Vocabulary: `schedule_type` everywhere → `day_type`** — `plnd_data/migrations/0021_create_user_schedule_types.sql:1`; `plnd_data/src/models/schedule_type.rs:6`; `plnd_data/src/repository/schedule_type.rs:16`; `plnd_api/src/routes/schedule_types.rs:28`; `plnd_api/src/api_response.rs:516`; `plnd_client/src/app/core/services/schedule-types.service.ts:33`; `plnd_client/src/app/core/models/schedule-type.ts:2`; user-visible labels at `plnd_client/src/app/features/onboarding/tasks/substeps/schedule-types-substep/schedule-types-substep.ts:111,219,224,238,243,617,621`.
- **E.2 `bed_time` field name → `sleep_time`** — `plnd_data/migrations/0021_create_user_schedule_types.sql:7`; `plnd_data/src/models/schedule_type.rs:13`; `plnd_api/src/routes/schedule_types.rs:34`; `plnd_api/src/api_response.rs:523,538`; `plnd_client/src/app/core/models/schedule-type.ts:8,19`.
- **E.3 No `is_default` flag and no default-fallback resolver** — `plnd_data/migrations/0021_create_user_schedule_types.sql:1-17` (no flag); `plnd_data/src/db/schedule_type.rs:128-168` (delete enforces `count > 1`, not "default exists"). Doc §4.3 requires every user to have a designated default day type that catches dates not covered by other day types' weekday/cycle rules.
- **E.4 Bitmask + cycle can be set simultaneously; no XOR enforcement** — `plnd_data/migrations/0021_create_user_schedule_types.sql:5-16`; `plnd_api/src/routes/schedule_types.rs:55-79`. The schema's CHECK only validates cycle-coherence with `is_cycle`; it does NOT force `days_bitmask=0` when `is_cycle=true`. Doc §4.3 requires "exactly one of two mechanisms."
- **E.5 No mutual-exclusivity enforcement within user** — `plnd_data/migrations/0021_create_user_schedule_types.sql` (no overlap check); `plnd_api/src/routes/schedule_types.rs:55-79` (validation does not detect overlap). Two day types can each set `days_bitmask=62` (Mon–Fri) for the same user with no rejection. Doc §4.3 says every date resolves to exactly one day type per user.
- **E.6 No per-meal override on day type** — `plnd_data/migrations/0021_create_user_schedule_types.sql:1-17`; `plnd_data/src/models/schedule_type.rs:5-18`; `plnd_api/src/routes/schedule_types.rs:27-53` (no override fields in request/response). Doc §4.3 requires day types to optionally override per-meal `preferred_time` and `tolerance_minutes`. Borderline-absent; logged as delta because §4.3 calls it a defined property of a day type.

**Dependencies:** E.6 is gated on Family G (a meal pattern must exist before it can be overridden per-day-type). E.1, E.2, E.3, E.4, E.5 are independent and can ship in any order.

---

### Family F — Daily-rhythm state lives on the wrong owner

**Architecture refs:** §3.1, §4.3, §4.6

**Summary.** Doc revisions 1.2 and 1.3 explicitly relocated wake/sleep state off `user_preferences` and onto day types. They also (via §4.6) put meal-time state on the meal pattern with day-type overrides. The implementation still carries `wake_time` on `user_preferences` and stores meal windows as six fixed columns on the same table.

**Deltas:**

- **F.1 `user_preferences.wake_time` exists** — `plnd_data/migrations/0016_briefing_wake_time.sql:1-3`; `plnd_data/src/models/user.rs:11`; `plnd_api/src/models.rs:41` (PATCH); `plnd_api/src/api_response.rs:52` (GET); `plnd_data/src/db/preferences.rs:16-41` (insert/update); `plnd_client/src/app/core/models/preferences.ts:6,26`. (No `sleep_time` companion — half-baked legacy field.)
- **F.2 Meal windows as six columns on `user_preferences`** — `plnd_data/migrations/0022_add_meal_windows_to_preferences.sql:1-7`; `plnd_data/src/models/user.rs:12-17`; `plnd_api/src/models.rs:43-53`; `plnd_api/src/api_response.rs:53-58`; `plnd_client/src/app/core/models/preferences.ts:8-13,28-33`; onboarding `meal-times-substep.ts:73-82,107-115`. Three meals hardcoded; user can't add a snack/second-breakfast slot. Storage shape is start/end pairs, not `preferred_time + tolerance_minutes` (also Family G).
- **F.3 Meal-window validation rejects `start >= end`** — `plnd_api/src/routes/preferences.rs:48-60`. Breaks midnight-crossing semantics for night-shift users (a 23:30–01:00 window is legitimate per §4.3 + §4.6 but rejected today).

**Dependencies:** F is the cleanup that follows E (day types ready to receive wake/sleep) and G (meal pattern ready to receive `preferred_time` + `tolerance_minutes`). Cannot ship F without those targets existing.

---

### Family G — Meal pattern is not a first-class entity

**Architecture refs:** §4.6, §10

**Summary.** Doc says a user has a *meal pattern* — an ordered sequence of named meals, each with `preferred_time` + `tolerance_minutes`, fully reconfigurable (snacks, second breakfast, late-night, cultural patterns). The implementation has no meal-pattern table at all. The closest analogue is `user_meal_habits`, which (1) is named for a deprecated concept, (2) hardcodes `slot IN ('breakfast','lunch','dinner')`, (3) carries a per-meal `recurrence_rule` (RRULE) that the doc explicitly forbids ("Daily recurrence is intrinsic… There is no per-meal recurrence rule; the *pattern* recurs"), and (4) lacks `preferred_time` and `tolerance_minutes`. The closed `MealSlot` enum repeats this constraint across every layer.

**Deltas:**

- **G.1 `user_meal_habits` does not carry `preferred_time` / `tolerance_minutes`** — `plnd_data/migrations/0023_create_user_meal_habits.sql:1-12`; `plnd_data/src/models/user.rs:24-31`; `plnd_api/src/routes/meal_habits.rs:1-138`; `plnd_api/src/models.rs:58-63`; `plnd_client/src/app/core/models/meal-habit.ts:5-21`; `plnd_client/src/app/core/services/meal-habits.service.ts:8`. No `preferred_time` / `tolerance_minutes` columns or fields anywhere in the codebase.
- **G.2 `user_meal_habits.slot` CHECK = `breakfast|lunch|dinner`** — `plnd_data/migrations/0023_create_user_meal_habits.sql:7` (migration comment confirms `'snack' is intentionally excluded`). Closes the meal pattern to three values at the schema layer.
- **G.3 `user_meal_habits` carries a per-meal `recurrence_rule`** — `plnd_data/migrations/0023_create_user_meal_habits.sql:8`; expansion logic `plnd_api/src/routes/schedule.rs:73-110` (`expand_habit_to_entries`). Doc forbids per-meal recurrence ("pattern recurs, not entries").
- **G.4 Frontend `MealSlot` closed enum** — `plnd_client/src/app/core/models/week-plan.ts:2` (`'breakfast' | 'lunch' | 'dinner' | 'snack'`); `plnd_client/src/app/core/models/meal-habit.ts:5` (three only).
- **G.5 `STANDARD_MEAL_SLOTS` hardcodes B/L/D** — `plnd_client/src/app/core/models/week-plan.ts:35`; consumed across both planning + onboarding wizards.
- **G.6 `slotDefaultTime` re-introduces fixed clock minutes** — `plnd_client/src/app/core/services/week-plan.service.ts:413-421`. Contradicts §4.6 ("the LLM reasons about windows, not clock minutes") and the user-controlled `preferred_time` model.
- **G.7 Agent tool schemas hardcode the three-meal `occasion` enum** — `plnd_agent/src/context/mod.rs:95,152` (`MEAL_PLAN_RESPONSE_SCHEMA`, `SUGGEST_SLOT_RESPONSE_SCHEMA`); `plnd_agent/src/tools/meal.rs:517,610,693,783,977`. LLM cannot suggest meals for any non-canonical slot; validator rejects user-named occasions.
- **G.8 Onboarding meal-times substep is fixed-three only** — `plnd_client/src/app/features/onboarding/food/substeps/meal-times-substep/meal-times-substep.ts:73-82,107-115`. No UI to add/rename/reorder meals.
- **G.9 Day-view + planning wizard hardcode B/L/D dividers** — `plnd_client/src/app/features/onboarding/tasks/substeps/task-placement-review-substep/task-placement-review-substep.ts:124-130`; `plnd_client/src/app/features/planning/steps/plan-meals-step/plan-meals-step.ts:9-11,345`; `plnd_client/src/app/features/planning/steps/plan-day-grid-step/plan-day-card.ts:73`.

**Dependencies:** G is a structural prerequisite for E.6 (per-day-type meal overrides need a meal-pattern row to override) and for F.2 (meal windows can move off preferences only when a meal-pattern table exists). Within G, the storage shape (G.1–G.3) ships first; the closed enums (G.4–G.7) follow once the data layer can express open patterns.

---

### Family H — `one_shot` task flag absent everywhere

**Architecture refs:** §4.4 (added in revision 1.1), §4.10, §10

**Summary.** Doc states unambiguously that *every* task always carries `one_shot`, and the field drives carryover behavior (`one_shot=true` tasks are silently dropped at window close and never enter carryover review). The field is missing from the schema, Rust models, API DTOs, frontend interfaces, agent tool schemas, and every UI surface that creates or edits tasks. Tasks are persisted today without it. Per the contradiction-vs-absence test: doc says "always carries"; implementation persists tasks without the field — that's a contradiction with the always-carries invariant, not just an unimplemented enrichment.

**Deltas:**

- **H.1 No `one_shot` column on `tasks`** — `plnd_data/migrations/0011_tasks_and_scheduling.sql:91-103`; `plnd_data/src/models/task.rs:9-22`.
- **H.2 No `one_shot` field in API request/response DTOs** — verified absent via grep across `plnd_api/src/`.
- **H.3 No `one_shot` field in frontend models** — verified absent across `plnd_client/src/app/core/models/`. `PlannedTask`, `ScheduleEntryDto`, `PlanEntryRequest`, `ScheduleTemplate` all lack it.
- **H.4 No `one_shot` field in agent tool schemas or terminal-tool outputs** — `plnd_agent/src/tools/schedule.rs` (`CreateTaskTool`, `PlaceTasksTool` schemas); `plnd_agent/src/context/mod.rs` (response schemas).
- **H.5 Carryover SELECT lacks `one_shot` filter** — `plnd_data/src/db/schedule.rs:35-40` (the carryover query). Confirmed by code-read: no `one_shot` predicate in the SELECT. Today's behavior silently includes tasks the doc says must be dropped at window close. Blocked on H.1 (the column must exist before it can be filtered).
- **H.6 `commit_plan` lacks window-close drop pass** — `plnd_data/src/db/schedule.rs:107-267`. Architecture §4.10 says one-shots are "silently dropped at window close." `commit_plan` performs no sweep that deletes or marks-skipped one-shot entries from the prior window before composing the new one. Blocked on H.1.

**Dependencies:** Independent of other families. H.1 is the structural prerequisite for H.5 and H.6. The migration + DTO + handler chain can ship as one slice; H.5 and H.6 then become two-line query additions.

---

### Family I — Carryover review vocabulary + shape

**Architecture refs:** §4.10 (post-revision-1.1), §10

**Summary.** Doc says carryover review is the **first** conceptual pass of planning — surface *all* incomplete tasks before the current planning window (no lookback horizon), three actions (carry/defer/drop), optional one-tap reason on drop. Implementation uses different vocabulary, embeds carryover decisions as a side-input to the plan-commit POST rather than a first-class step, exposes UI copy that contradicts the no-lookback semantic, and provides no surface for the optional drop reason.

**Deltas:**

- **I.1 Vocabulary: `accept | defer | dismiss` → `carry | defer | drop`** — `plnd_api/src/models.rs:84-90` (`CarryoverDecision`); `plnd_api/src/routes/schedule.rs:264-267` (mapping); `plnd_client/src/app/core/models/week-plan.ts:1`; `plnd_client/src/app/features/planning/steps/plan-review-step/plan-review-step.ts:7,77-91,127-132`. User-visible labels currently render as titlecased "Accept" / "Dismiss".
- **I.2 No standalone carryover review endpoint** — `plnd_api/src/api_response.rs:462-474` (carryover lives on the *commit* response); `plnd_api/src/routes/schedule.rs:259-279` (decisions arrive on the same body that commits the plan). No `GET /schedule/plan/carryover` or equivalent exists.
- **I.3 Client copy "last week" contradicts no-lookback semantics** — `plnd_client/src/app/features/planning/steps/plan-review-step/plan-review-step.ts:30` (empty-state copy "No unfinished items from last week to review."); `loadPeriod(planStart, planEnd)` queries the *new* window, not "all incomplete before planStart."
- **I.4 No drop-reason capture surface** — `plnd_client/src/app/features/planning/steps/plan-review-step/plan-review-step.ts:38-44,127-132` (single-click cycle, no follow-up). Doc says reasons are optional but should be capturable on a one-tap basis.
- **I.5 Backend caps carryover lookback at 90 days** — `plnd_data/src/db/schedule.rs:34-46` (the `get_period` repository call) computes `carryover_start = start - chrono::Duration::days(CARRYOVER_LOOKBACK_DAYS)`; the constant lives at `plnd_data/src/models/schedule.rs:6-8` (value `90`). Doc §4.10: "there is no lookback horizon." Resolution: remove the `carryover_start` predicate from the SQL (and delete the `CARRYOVER_LOOKBACK_DAYS` constant). Note that I.3's frontend "last week" copy is a *separate* contradiction with both the doc and the backend (which returns 90 days, not 7) — the two deltas are independent and both real.

**Dependencies:** I.1 ships independently. I.2 + I.3 may share a slice. I.4 depends on I.1 (vocabulary) + I.2 (the drop action surface). I.5 is a single-file SQL change, independent of the rest.

---

### Family J — Planning wizard shape

**Architecture refs:** §4.9, §4.10

**Summary.** The wizard's outer shell is correctly linear, but the spoke list omits "exercise" (doc §4.9 names four: carryover / tasks / meals / exercise), step 4 introduces a hub-and-spoke per-day card grid inside the linear flow, and the planning-prefs substep offers a 28-day plan length that exceeds the doc's hard cap of 14 days.

**Deltas:**

- **J.1 Wizard omits the "exercise" step** — `plnd_client/src/app/features/planning/planning-wizard/planning-wizard.ts:101-107` (steps: Carryover, Tasks, Meals, Review, Confirm). The doc-internal §4.9-vs-§1.1 tension was resolved this phase via the permanently-disabled-placeholder pattern (see "Resolved during this phase" above). The onboarding hub already implements that pattern (`Exercise [disabled]` card); the planning wizard does not. Two valid resolution paths: (a) extend the placeholder pattern to the linear wizard with a permanently-disabled exercise step, or (b) document that linear wizards skip deferred spokes silently and remove the "exercise" entry from §4.9's planning-wizard spoke list (a small architecture-doc clarification). Resolution choice is a follow-on design call.
- **J.2 Plan length offers up to 28 days** — `plnd_client/src/app/features/onboarding/shared/planning-prefs-substep` (and the comparable surface in the planning wizard); planning-prefs-substep exposes 7 / 14 / 28 options. Doc §4.9: "capped at 14 days to bound LLM cost and reasoning load." Frontend `Preferences` interface comment says `"1–90"` for `default_plan_length_days` (`plnd_client/src/app/core/models/preferences.ts:5`).
- **J.3 Step 4 "Day Review" is hub-and-spoke within the linear shell** — `plnd_client/src/app/features/planning/steps/plan-day-grid-step/plan-day-grid-step.ts:11-23`. Borderline; logged for design judgment.

**Dependencies:** J.1's resolution is a design call (placeholder step vs. doc clarification on linear-wizard semantics). J.2 is a config-cap fix; check the API also enforces. J.3 is borderline (logged for design judgment).

---

### Family K — Day-view item-type taxonomy

**Architecture refs:** §4.4

**Summary.** §4.4's task category enum has six values (`work | exercise | leisure | medication | appointment | general`) that drive agent tone and badging. The day-view UI collapses everything into three (`task | exercise | appointment`), so leisure / medication / work / general all render identically.

**Deltas:**

- **K.1 `ItemType = 'task' | 'exercise' | 'appointment'` collapses six categories into three** — `plnd_client/src/app/core/models/schedule.ts:4`; mapping at `plnd_client/src/app/core/services/schedule.service.ts:141-150` (`mapEntry` collapses non-exercise/appointment to `'task'`).

**Dependencies:** Independent UI fix.

---

## Open questions (deferred)

These items couldn't be classified as contradictions or absences from code alone. They need either a doc clarification, a backend behavioral check, or a design call.

*(All open questions have been resolved this phase. See "Resolved during this phase" above. The deltas inventory is complete pending user review.)*

---

## Independent items (NOT deltas — surface separately as bug / tech-debt issues)

These items came up during the audit but do NOT contradict `architecture.md`. They are unrelated logic bugs, tech debt, or scaffolding cleanups. Per the deltas-phase scoping rule, they should be tracked as their own GitHub issues, not folded into the migration. Listed here so they aren't lost.

- **`ScheduleEntryResponse.family_meal_id` is serialized to API on every `GET /schedule/period` response** (`plnd_api/src/api_response.rs:420,446`; `ENTRY_COLS` projection in `plnd_data/src/db/schedule.rs:12`). The value is always `null` because nothing populates it. This leaks an inert future-domain field into the public API contract. Recommended: drop from `ENTRY_COLS` + `ScheduleEntryResponse` until family coordination lands, OR `#[serde(skip_serializing_if = "Option::is_none")]`. Not a delta because §3.4 says family coordination is deferred and the field carries no behavioral consequence today; just contract noise.
- **Unused `MealTask` struct + `Family*` model structs** (`plnd_data/src/models/task.rs:33`; `plnd_data/src/models/family.rs:1-42`). Publicly re-exported but no callers anywhere. Optional cleanup; leaving them in place is also fine if treated as scaffolding.
- **`VALID_FAMILY_ROLES` constant has only a self-referential test** (`plnd_api/src/routes/domain_constants.rs:22`; test at `plnd_api/tests/domain_model_test.rs:59-62`). The test asserts the constant's literal contents — no real consumer exists. Optional cleanup.
- **`meal_suggestions.rs` `slot` parameter is a closed enum over `occasion_tags`** — `plnd_api/src/routes/meal_suggestions.rs:14,44-46` validates `slot` against `["breakfast","lunch","dinner","snack"]` before passing it to a `$2 = ANY(occasion_tags)` predicate. Personal `occasion_tags` is free-form per §3.2.5, so a user who tagged a dish `"second_breakfast"` cannot query it through this endpoint. Not a delta (§3.2.5 sanctions occasion tags as advisory; the closed enum is a UI-input convenience). Worth tracking as a small UX enhancement once Family G surfaces non-canonical occasion names that users actually adopt.

---

## Out of scope for this phase (verified absent — unimplemented features, not deltas)

- **Paired tasks** (§4.4, §4.6). No `paired_meal_id` / `paired_with` field anywhere; no creation surface. Concept absent. Note: when paired tasks become first-class, the existing UI-level `MealAnchor.duringMealTasks` array (`plnd_client/src/app/core/models/schedule.ts:14-23`) should rename to `pairedTasks` to match doc vocabulary — small follow-on cleanup, not blocking the implementation.
- **Displaced-meal flag** (§4.6, §8.4). No `displaced` field on any meal-shaped model; no rendering hook in `meal-row` / `meal-review-pane`.
- **Floating-task purple panel** (§8.4). No `--color-purple-*` usage in day-view + schedule directories.
- **Accessibility prefs** — dyslexia-friendly font toggle, color-blind-safe palette toggle (§3.1, §9.3).
- **Memory feedback loop continuous capture** (§3.5). Capacity exists in the agent's memory tools; specific edit/override/skip event-capture is not wired up.
- **Catalog browse UI.** Confirmed by routing inventory — no `/catalog`, `/dishes`, `/meals/browse` routes; `CatalogService` is consumed only by an ingredient-typeahead in onboarding's dietary-preferences substep (search-from-context, not a directory).
- **Family feature (frontend).** `features/family/` is empty. Backend has scaffolding (see open question above); frontend absence aligns with §3.4 deferral.
- **End-user chat LLM surface.** `features/llm/` is empty. The only "chat-shaped" UI is `add-entry`, which is single-intent NL → structured action, aligned with §1.3.
- **Exercise feature (frontend).** `features/exercise/` is empty.
- **`Routine` interface / `RoutineService` (frontend).** Absent — when added during D-vocab fix, names should be `Routine*`, not `ScheduleTemplate*`.
- **`DayType` interface and per-day-type meal override surface.** Absent — when E and G land, names should be `DayType*` and the overrides should hang off it.

---

## Sequencing notes

Recommended dependency-aware order (from most foundational to least):

1. **A — Meals-vs-tasks split.** Foundation; unblocks B, parts of D, G, K.
2. **B + C — Anchor/slot reshape + milepost rename.** Ship together; once A lands, anchors can be addressed by id without going through `task_type`.
3. **G — Meal pattern as a first-class entity.** Independent of A in principle but pragmatically shipped after A makes meals own-domain.
4. **E — Day types** (E.1, E.2, E.3, E.4, E.5 independent; E.6 gated on G).
5. **F — Daily-rhythm relocation.** Ships once E and G provide the new owners.
6. **D — Routines vs schedule_templates.** D-vocab and D-recur are independent; D-struct (D.2) entangles with A.
7. **H — `one_shot` flag.** Independent; ships any time.
8. **I — Carryover review vocabulary + shape.** Independent; can ship alongside H since both touch the carryover slice of the planning wizard.
9. **J — Planning wizard shape.** J.1 is a design call (placeholder step or doc clarification). J.2 is a config-cap fix. J.3 is borderline.
10. **K — Day-view item type taxonomy.** Independent UI fix.

Pure-rename pieces (C, D-vocab, E.1, E.2, I.1) could potentially ship as a single "vocabulary alignment" PR if coordinated; doing so makes the diff legible and avoids a long tail of two-line cleanup PRs.
