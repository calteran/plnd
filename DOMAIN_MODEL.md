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
| `task_type` | enum | `meal \| exercise \| work \| leisure \| appointment \| medication \| general` |
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
| `user_dish_id` | FK → `user_dishes` (nullable — schedule a single dish directly, without a meal wrapper) |
| `family_meal_id` | FK → `family_meals` (nullable) |
| `occasion_label` | TEXT (free-form eating occasion: "breakfast", "morning snack", "late snack", etc.) |

Note: `user_meal_id` and `user_dish_id` are mutually exclusive (DB CHECK). `occasion_label` is free-form text — not DB-validated — so it can accommodate any custom eating occasion without a schema change.

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

The catalog answers "what things *are*" independent of scheduling. It has three levels of food abstraction plus a two-tier public/personal split at each level:

1. **Public catalog** — a shared, community-sourced reference that users browse and draw from
2. **Personal library** — the user's fully owned, independently editable copy

### Layer 1: Ingredients (atomic food items)

**`catalog_ingredients`** — atomic food items with nutrition and allergen data:

| Field | Notes |
|---|---|
| `ingredient_id` | UUID |
| `name` | text |
| `description` | text |
| `serving_size_g` | numeric (null = nutrition is per 100g) |
| `nutrition` | JSONB per serving — canonical shape: `{ calories_kcal, protein_g, fat_g, carbohydrates_g, fiber_g, sugar_g, sodium_mg }` |
| `allergens` | text[] |
| `occasion_tags` | text[] (soft hints, e.g. "snack", "breakfast-friendly") |
| `external_id` | text (e.g. FDC NDB number) |
| `external_source` | `'usda_fdc' \| 'openfoodfacts' \| null` |
| `contributed_by_user_id` | UUID → users, nullable |

Ingredients are the leaves of the composition tree. They carry the authoritative nutrition facts. All higher layers (dishes, meals) can compute their nutrition by summing ingredient contributions — unless a manual override flag is set.

### Layer 2: Dishes (recipes composed of ingredients)

**`catalog_dishes`** — complete recipes; the middle layer:

| Field | Notes |
|---|---|
| `dish_id` | UUID |
| `name`, `description`, `instructions` | text |
| `prep_time_minutes`, `cook_time_minutes` | integer |
| `servings` | numeric |
| `allergens` | text[] |
| `allergens_overridden` | bool — `true` = human verified; `false` = computed from ingredients |
| `occasion_tags` | text[] (suggestions only — no DB CHECK) |
| `tags` | text[] |
| `nutrition` | JSONB per serving; null = compute from ingredients |
| `nutrition_overridden` | bool — distinguishes "not computed yet" from "manually verified" |
| `contributed_by_user_id` | UUID → users, nullable |

**`catalog_dish_ingredients`** — composition join table (dish → ingredient):

| Field | Notes |
|---|---|
| `dish_ingredient_id` | UUID |
| `dish_id` | FK → catalog_dishes (cascade) |
| `ingredient_id` | FK → catalog_ingredients (restrict) |
| `quantity` | numeric |
| `unit` | text (e.g. "cups", "grams") |
| `preparation_note` | text (e.g. "diced", "torn into pieces") |
| `is_optional` | bool |
| `sort_order` | smallint |

**Key design — `_overridden` flags**: `allergens_overridden` and `nutrition_overridden` distinguish "no allergens because none computed" from "no allergens because a human verified this explicitly." Without these flags, a recomputation pass would silently clobber manual corrections.

### Layer 3: Meals (eating occasion templates composed of dishes)

**`catalog_meals`** — eating occasion templates; the top layer:

| Field | Notes |
|---|---|
| `meal_id` | UUID |
| `name`, `description` | text |
| `servings` | numeric |
| `allergens`, `allergens_overridden` | same override pattern as dishes |
| `occasion_tags` | text[] — replaces the old `meal_type` enum; suggestions only, no DB CHECK |
| `tags` | text[] |
| `nutrition`, `nutrition_overridden` | same override pattern as dishes |
| `contributed_by_user_id` | UUID → users, nullable |

**`catalog_meal_dishes`** — composition join table (meal → dish):

| Field | Notes |
|---|---|
| `meal_dish_id` | UUID |
| `meal_id` | FK → catalog_meals (cascade) |
| `dish_id` | FK → catalog_dishes (restrict) |
| `dish_servings` | numeric |
| `notes` | text |
| `sort_order` | smallint |

**Why `occasion_tags TEXT[]` instead of `meal_type` enum**: A dish or meal is not inherently a "breakfast item" or "dinner item" — that classification belongs to the eating occasion, not the food. Caesar Salad can be lunch or a light dinner. `occasion_tags` are soft hints for UI autocomplete and LLM suggestions, never validated by a CHECK constraint. The eating occasion label lives on the **schedule slot** (`meal_tasks.occasion_label`), not the food item.

### Personal Libraries (user-owned copies)

**`user_dishes`** — personal recipe library (mirrors `catalog_dishes`):

| Additional fields vs. catalog | Notes |
|---|---|
| `user_id` | FK → users |
| `catalog_dish_id` | nullable — fork origin, no ongoing FK enforcement |
| `rating` | smallint 1–5 |
| `is_safe_food` | bool — safe/comfort food, prioritized in suggestions |
| `is_blocked` | bool — never suggest this dish |
| `notes` | text |

**`user_dish_ingredients`** — personal dish composition (refs `catalog_ingredients` only; personal ingredient overrides deferred to Phase 3/4 pantry).

**`user_meals`** — personal meal library (mirrors `catalog_meals`):

Same extra fields as `user_dishes` (user_id, catalog_meal_id, rating, is_safe_food, is_blocked, notes).

**`user_meal_dishes`** — personal meal composition:

| Field | Notes |
|---|---|
| `catalog_dish_id` | FK → catalog_dishes (nullable) |
| `user_dish_id` | FK → user_dishes (nullable) |
| `dish_servings` | numeric |

Exactly one of `catalog_dish_id` / `user_dish_id` must be set (DB CHECK). This lets a personal meal mix catalog dishes with personal recipe overrides.

**Fork flow**: When a user imports a catalog item, the system creates a user row by copying all fields and setting the `catalog_*_id`. After that point the user's copy is **fully independent** — they can rename it, adjust allergens, correct nutrition, etc. There is no FK enforcement after the fork.

### Exercises

**`catalog_exercises`** / **`user_exercises`** — same two-level pattern:

| Field | Catalog | User library |
|---|---|---|
| `name`, `description` | ✓ | ✓ (independently editable) |
| `default_duration_minutes` | ✓ | ✓ |
| `intensity` | ✓ | ✓ |
| `muscle_groups[]` | ✓ | ✓ |
| `equipment_required[]` | ✓ | ✓ |
| `external_id`, `external_source` | ✓ | — |
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
| `recurrence` | enum: `daily \| weekdays \| weekly \| custom` |
| `recurrence_rule` | text (RRULE string for custom recurrence) |
| `time_window_start` | time (time-of-day, not datetime — windows not exact times) |
| `time_window_end` | time |
| `duration_minutes` | integer |
| `energy_required` | enum |
| `is_milepost` | bool |
| `task_ref_id` | UUID → appropriate catalog/user table (nullable, polymorphic) |
| `task_ref_type` | text discriminator: `'user_meal' \| 'user_dish' \| 'user_exercise' \| ...` |

Using time **windows** rather than exact times gives structure without rigidity — a "dinner window" of 17:30–19:00 can accommodate drift without the user feeling like they've "failed" by eating at 18:15.

### `schedule_entries` — concrete instances on a specific date

| Field | Notes |
|---|---|
| `id` | UUID |
| `user_id` | UUID → users |
| `template_id` | UUID → `schedule_templates`, nullable (ad-hoc entries have no template) |
| `task_type` | enum |
| `task_ref_id` | UUID → catalog/user table (nullable, polymorphic) |
| `task_ref_type` | text discriminator |
| `date` | date |
| `scheduled_start` | timestamptz |
| `scheduled_end` | timestamptz |
| `status` | enum (`planned \| in_progress \| completed \| skipped \| deferred`) |
| `actual_start` | timestamptz, nullable |
| `actual_end` | timestamptz, nullable |
| `family_meal_id` | UUID → `family_meals`, nullable |
| `after_milepost` | `breakfast \| lunch \| dinner`, nullable — **temporal ordering anchor, not a food classifier** |
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
| Three-level catalog (Ingredient → Dish → Meal) | Enables precise nutrition computation, allergen derivation, and LLM reasoning about food composition; avoids flat opaque JSONB blobs |
| `occasion_tags TEXT[]` not `meal_type` enum | A food item is not inherently a "breakfast food" — the eating occasion label belongs on the schedule slot, not the food entity; free-form tags are more flexible and require no schema migration when new occasions emerge |
| `_overridden` boolean flags | Distinguishes computed values from human-verified values; prevents recomputation passes from silently clobbering manual corrections |
| Two-level catalog (public + personal) | Users get a rich starting library; their personal copy is fully theirs after forking — no shared mutation risk |
| `is_safe_food` flag | First-class support for picky eaters — filters suggestions, avoids surfacing unfamiliar foods |
| Energy level on all tasks | Enables schedule balancing: don't stack two high-energy tasks back-to-back; LLM can optimize for energy curve |
| Family meals as shared events | Meal coordination flows into each participant's schedule naturally; dietary warnings surface to the planner |
| `after_milepost` ordering | Lightweight ordering without a full DAG — covers 90% of sequencing needs at minimal complexity |

---

## 8. Open Questions & Future Considerations

- **Dependency depth**: Does `after_milepost` suffice for real scheduling needs, or will users want explicit task chains? Start simple; revisit in Phase 3 when real usage patterns emerge.
- **LLM scheduling engine**: At what point does the LLM handle template expansion vs. a deterministic rule engine? Likely Phase 3. For Phase 2, template → instance generation is rule-based.
- **Dish-in-dish nesting**: Should `catalog_dishes` reference other dishes as sub-components (e.g., "Hollandaise Sauce" dish inside "Eggs Benedict" dish)? Deferred — recursive composition adds significant complexity; flat ingredient lists cover Phase 2 needs.
- **User ingredients**: Personal overrides of catalog ingredient nutrition/allergens (e.g., "my brand of oat milk"). Deferred to Phase 3/4 pantry feature.
- **`after_milepost` extensibility**: Currently hardcoded as `'breakfast' | 'lunch' | 'dinner'`. If users want custom temporal anchors (e.g., "school pickup"), revisit in Phase 3.
- **External nutrition DB integration**: `external_id` / `external_source` columns on `catalog_ingredients` are placeholders. Actual USDA FoodData Central or OpenFoodFacts import is a separate Phase 3+ task.
- **Pantry / ingredient layer**: `family_meals` will eventually link to pantry inventory for grocery list generation. Deferred to Phase 4.
- **Caregiver write access**: Should a caregiver be able to modify a user's schedule directly, or only propose changes that the user confirms? Security + UX question — defer to Phase 3/4 when caregiver features are built out.
- **Catalog contribution flow**: How do users contribute improvements from their personal library back to the public catalog? Moderation, attribution, and conflict resolution are out of scope for now.
- **Nutrition normalization**: `nutrition` is stored as JSONB for flexibility. When querying becomes a bottleneck or Phase 4 nutrition tracking is built, normalize into a proper `nutrition_facts` table.
