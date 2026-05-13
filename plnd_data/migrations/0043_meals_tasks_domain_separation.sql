-- Migration 0043 — meals/tasks domain separation
-- Resolves issue #795: meal references stored in task-domain task_ref_* columns
-- violate the architecture.md §3.3 / §4.4 / §4.6 boundary between meals and tasks.
--
-- Strategy:
--   1. Create planned_meal_entries in the meals domain.
--   2. Backfill from existing schedule_entries meal-anchor rows
--      (task_type IS NULL AND task_ref_id IS NOT NULL).
--   3. Drop task_ref_id / task_ref_type from schedule_entries (no longer needed).
--   4. Drop task_ref_id / task_ref_type from routines (no live consumer —
--      exercise model design is deferred to a follow-up issue).
--
-- Meal-anchor rows in schedule_entries (task_type IS NULL) are retained as
-- positional placeholders so floating-task slot_anchor_id references remain
-- non-polymorphic.

-- ---------------------------------------------------------------------------
-- 1. Create planned_meal_entries
-- ---------------------------------------------------------------------------
CREATE TABLE planned_meal_entries (
    meal_entry_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    schedule_entry_id   UUID NOT NULL UNIQUE
                            REFERENCES schedule_entries(entry_id) ON DELETE CASCADE,
    meal_ref_id         UUID NOT NULL,
    meal_ref_type       VARCHAR(30) NOT NULL,
    title               VARCHAR(255),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT planned_meal_entries_meal_ref_type_check
        CHECK (meal_ref_type IN ('user_meal', 'catalog_meal', 'user_dish', 'catalog_dish'))
);

CREATE INDEX idx_planned_meal_entries_user_id
    ON planned_meal_entries(user_id);

-- ---------------------------------------------------------------------------
-- 2. Backfill from existing meal-anchor rows
-- The client currently writes 'catalog' or 'user' into task_ref_type for meals;
-- normalize those to the longer canonical values during the move.
-- ---------------------------------------------------------------------------
INSERT INTO planned_meal_entries
    (user_id, schedule_entry_id, meal_ref_id, meal_ref_type, title)
SELECT
    user_id,
    entry_id,
    task_ref_id,
    CASE task_ref_type
        WHEN 'catalog' THEN 'catalog_meal'
        WHEN 'user'    THEN 'user_meal'
        ELSE task_ref_type
    END,
    title
FROM schedule_entries
WHERE task_type IS NULL
  AND task_ref_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Drop the columns from schedule_entries
-- ---------------------------------------------------------------------------
ALTER TABLE schedule_entries DROP COLUMN task_ref_id;
ALTER TABLE schedule_entries DROP COLUMN task_ref_type;

-- ---------------------------------------------------------------------------
-- 4. Drop the columns from routines
-- ---------------------------------------------------------------------------
ALTER TABLE routines DROP COLUMN task_ref_id;
ALTER TABLE routines DROP COLUMN task_ref_type;
