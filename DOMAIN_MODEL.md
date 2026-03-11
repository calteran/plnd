# PLND Domain & Scheduling Model

> **Status**: Settled design — authoritative reference for Phase 2+ implementation.
> Decisions recorded here emerged from architectural brainstorming prior to coding meals, exercise, and tasks.

---

## 1. Core Philosophy

### Tasks as the Universal Scheduling Unit

Every item on a user's schedule — a meal, a workout, a work block, a medication reminder, a leisure break — is a **Task**. There is no separate "meal system" and "exercise system"; they are specializations of the same underlying entity. This gives us:

- A single query to fetch a full day's schedule regardless of content type
- A unified weekly/daily view without gluing together parallel data sources
- Consistent status tracking, energy tracking, and dynamic adjustment across all item types

### Meals as Structural Mileposts

Meals (breakfast, lunch, dinner) are **anchor points** around which the rest of the day is organized. When building or adjusting a schedule, meal mileposts are placed first; other tasks fill in the windows between them. This reflects a neurodivergent scheduling principle: predictable anchors reduce cognitive load and anxiety. An LLM scheduling engine can use mileposts as hard constraints when suggesting or adjusting the day.

### Template → Instance Pattern

Recurring patterns (e.g., "walk the dog every morning") live in **schedule templates** and are not pre-materialized into the database. Concrete **schedule entries** are generated on demand — when a user opens a day's plan or explicitly commits a week. This keeps the database lean, makes templates the single source of truth, and avoids stale pre-generated records when a template changes.

### Energy Level as a First-Class Field

Every task carries an `energy_required` rating (`low | medium | high`). This enables schedule balancing: the system (or LLM) can warn against placing two high-energy tasks back-to-back, or suggest lighter tasks after a difficult appointment. This is a core neurodivergent-support feature.

---

## 2. Entity Hierarchy

### Task (base entity)

All scheduled items share a common set of fields:

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `user_id` | UUID → users | Owner |
| `title` | text | Display name |
| `task_type` | enum | `meal \| exercise \| work \| leisure \| appointment \| medication \| custom` |
| `scheduled_start` | timestamptz | Planned start time |
| `duration_minutes` | integer | Expected duration |
| `energy_required` | enum | `low \| medium \| high` |
| `status` | enum | `planned \| in_progress \| completed \| skipped \| deferred` |
| `is_milepost` | bool | `true` for anchor meals (breakfast, lunch, dinner) |

### Task Specializations (extension tables)

Joined on demand by `task_type`. Each references the base task by `id`.

**`meal_tasks`**
| Field | Notes |
|---|---|
| `task_id` | FK → tasks |
| `user_meal_id` | FK → `user_meals` (nullable — meal may be unspecified at planning time) |
| `family_meal_id` | FK → `family_meals` (nullable) |
| `meal_type` | `breakfast \| lunch \| dinner \| snack` |

**`exercise_tasks`**
| Field | Notes |
|---|---|
| `task_id` | FK → tasks |
| `user_exercise_id` | FK → `user_exercises` (nullable) |
| `intensity` | `low \| moderate \| high` |
| `muscle_groups` | text[] |

**`work_tasks`**
| Field | Notes |
|---|---|
| `task_id` | FK → tasks |
| `project_label` | text (free-form) |
| `focus_level_required` | `low \| medium \| deep` |

**`generic_tasks`**
| Field | Notes |
|---|---|
| `task_id` | FK → tasks |
| `category` | text |
| `priority` | `low \| normal \| high` |

---

## 3. The Catalog Layer

The catalog answers "what things *are*" independent of scheduling. It has two levels:

1. **Public catalog** — a shared, community-sourced reference that users browse and draw from
2. **Personal library** — the user's fully owned, independently editable copy

### Meals

**`catalog_meals`** — public/community-sourced reference (read-only to ordinary users):

| Field | Notes |
|---|---|
| `id` | UUID |
| `name` | text |
| `description` | text |
| `meal_type` | `breakfast \| lunch \| dinner \| snack` |
| `prep_time_minutes` | integer |
| `allergens` | text[] |
| `tags` | text[] |
| `nutrition` | JSONB (normalize in a later phase) |
| `contributed_by_user_id` | UUID → users, nullable (null = system seed data) |

**`user_meals`** — the user's personal meal library:

| Field | Notes |
|---|---|
| `id` | UUID |
| `user_id` | UUID → users |
| `name` | text (independently editable) |
| `description` | text |
| `meal_type` | `breakfast \| lunch \| dinner \| snack` |
| `prep_time_minutes` | integer |
| `allergens` | text[] |
| `tags` | text[] |
| `nutrition` | JSONB |
| `catalog_meal_id` | UUID → `catalog_meals`, nullable (tracks fork origin; no ongoing constraint) |
| `rating` | smallint (1–5), nullable |
| `is_safe_food` | bool (safe/comfort food — prioritized in suggestions) |
| `is_blocked` | bool (never suggest this) |
| `notes` | text |

**Fork flow**: When a user imports a catalog meal, the system creates a `user_meals` row by copying all fields and setting `catalog_meal_id`. After that point the user's copy is **fully independent** — they can rename it, adjust allergens, correct nutrition info, etc. There is no FK enforcement after the fork. Future: users may optionally contribute improvements back to the catalog.

### Exercises

**`catalog_exercises`** / **`user_exercises`** — same two-level pattern as meals:

| Field | Catalog | User library |
|---|---|---|
| `name`, `description` | ✓ | ✓ (independently editable) |
| `default_duration_minutes` | ✓ | ✓ |
| `intensity` | ✓ | ✓ |
| `muscle_groups[]` | ✓ | ✓ |
| `equipment_required` | ✓ | ✓ |
| `contributed_by_user_id` | ✓ | — |
| `catalog_exercise_id` | — | ✓ (fork origin, nullable) |
| `rating` | — | ✓ (1–5) |
| `is_blocked` | — | ✓ |
| `notes` | — | ✓ |

---

## 4. Schedule Model (Templates → Instances)

### `schedule_templates` — recurring patterns

| Field | Notes |
|---|---|
| `id` | UUID |
| `user_id` | UUID → users |
| `task_type` | enum (same as task) |
| `title` | text |
| `recurrence` | enum: `daily \| weekdays \| weekly \| custom` (or RRULE string for custom) |
| `time_window_start` | time (time-of-day, not datetime — windows not exact times) |
| `time_window_end` | time |
| `duration_minutes` | integer |
| `energy_required` | enum |
| `is_milepost` | bool |
| `task_ref_id` | UUID → appropriate catalog/user table (nullable) |

Using time **windows** rather than exact times gives structure without rigidity — a "dinner window" of 17:30–19:00 can accommodate drift without the user feeling like they've "failed" by eating at 18:15.

### `schedule_entries` — concrete instances on a specific date

| Field | Notes |
|---|---|
| `id` | UUID |
| `user_id` | UUID → users |
| `template_id` | UUID → `schedule_templates`, nullable (ad-hoc entries have no template) |
| `task_type` | enum |
| `task_ref_id` | UUID → catalog/user table (nullable) |
| `date` | date |
| `scheduled_start` | timestamptz |
| `scheduled_end` | timestamptz |
| `status` | enum (`planned \| in_progress \| completed \| skipped \| deferred`) |
| `actual_start` | timestamptz, nullable |
| `actual_end` | timestamptz, nullable |
| `family_meal_id` | UUID → `family_meals`, nullable |
| `after_milepost` | enum: `breakfast \| lunch \| dinner`, nullable (lightweight ordering) |
| `after_entry_id` | UUID → `schedule_entries`, nullable (explicit sequencing) |
| `deviation_note` | text, nullable |

**Generation strategy**: Entries are generated from templates on demand — not stored until the day is "opened" or a week is planned. This keeps the DB lean and templates authoritative for recurrence changes.

---

## 5. Dynamic Adjustment Model

When a `schedule_entry` status changes, the system responds:

| Status change | System behavior |
|---|---|
| `completed` (early) | Offer to pull downstream tasks forward |
| `skipped` | Cascade-defer dependents; if a meal was skipped, surface LLM suggestion for an alternative |
| `deferred` (with new time) | Downstream tasks shift accordingly |
| `in_progress` beyond `scheduled_end` | Surface warning + "compress or defer?" prompt |

### Ordering model

Tasks carry lightweight sequencing hints:
- `after_milepost` — "place this after breakfast / lunch / dinner" (simple, covers most cases)
- `after_entry_id` — explicit link to another entry for precise chaining

No full DAG is implemented at this stage. If real dependency chains emerge as a user need, revisit in Phase 3.

### Journal (post-MVP)

A **Journal** view will reconstruct "what actually happened on this day" from `actual_start`, `actual_end`, `deviation_note`, and status fields. This gives a retrospective record without requiring a separate journaling system.

---

## 6. Family Coordination Model

### Entities

**`families`**
| Field | Notes |
|---|---|
| `id` | UUID |
| `name` | text |

**`family_members`**
| Field | Notes |
|---|---|
| `family_id` | UUID → families |
| `user_id` | UUID → users |
| `role` | `owner \| member \| caregiver` |
| `can_plan_for` | UUID[] (user IDs this member can plan on behalf of) |

**`family_meals`** — shared meal events
| Field | Notes |
|---|---|
| `id` | UUID |
| `family_id` | UUID → families |
| `planned_by_user_id` | UUID → users |
| `date` | date |
| `time_window_start` | time |
| `time_window_end` | time |
| `user_meal_id` | UUID → `user_meals`, nullable (may be unspecified at planning time) |
| `title` | text |
| `notes` | text |
| `participants` | UUID[] (user IDs attending) |

### Flow: "Wife plans dinner"

1. Wife (family member) creates a `family_meal` for dinner Tuesday, listing participants.
2. System creates `schedule_entries` for each participant, each linked to `family_meals.id` via `family_meal_id`.
3. Each user sees dinner appear in their Tuesday schedule as a milepost — no manual action required.
4. If any participant has allergens or dietary restrictions that conflict with the planned meal, the planner (wife) sees a warning before confirming.

This model handles meal coordination without requiring full calendar sync or a separate shared-calendar system.

---

## 7. Key Design Decisions

| Decision | Rationale |
|---|---|
| Tasks as universal model | Avoids parallel systems for meals, exercise, and todos — unified weekly view query is a single `SELECT` |
| Meals as mileposts | Neurodivergent need for predictable daily anchors; LLM can use them as hard scheduling constraints |
| Time windows, not exact times | Gives structure without rigidity — reduces anxiety when things slip a few minutes |
| Template → Instance | Keeps templates authoritative; instances are ephemeral until a day is "committed" — template changes don't leave stale rows |
| Two-level catalog (public + personal) | Users get a rich starting library; their personal copy is fully theirs after forking — no shared mutation risk |
| `is_safe_food` flag | First-class support for picky eaters — filters suggestions, avoids surfacing unfamiliar foods |
| Energy level on all tasks | Enables schedule balancing: don't stack two high-energy tasks back-to-back; LLM can optimize for energy curve |
| Family meals as shared events | Meal coordination flows into each participant's schedule naturally; dietary warnings surface to the planner |
| `after_milepost` ordering | Lightweight ordering without a full DAG — covers 90% of sequencing needs at minimal complexity |

---

## 8. Open Questions & Future Considerations

- **Dependency depth**: Does `after_milepost` suffice for real scheduling needs, or will users want explicit task chains? Start simple; revisit in Phase 3 when real usage patterns emerge.
- **LLM scheduling engine**: At what point does the LLM handle template expansion vs. a deterministic rule engine? Likely Phase 3. For Phase 2, template → instance generation is rule-based.
- **Pantry / ingredient layer**: `family_meals` will eventually link to pantry inventory for grocery list generation. Deferred to Phase 4.
- **Caregiver write access**: Should a caregiver be able to modify a user's schedule directly, or only propose changes that the user confirms? Security + UX question — defer to Phase 3/4 when caregiver features are built out.
- **Catalog contribution flow**: How do users contribute improvements from their personal library back to the public catalog? Moderation, attribution, and conflict resolution are out of scope for now.
- **Nutrition normalization**: `nutrition` is stored as JSONB for flexibility. When querying becomes a bottleneck or Phase 4 nutrition tracking is built, normalize into a proper `nutrition_facts` table.
