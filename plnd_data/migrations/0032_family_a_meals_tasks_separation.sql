-- Migration: remove 'meal' from the task_type vocabulary across the scheduling model.
-- Meal anchors in schedule_entries become task_type = NULL (distinct domain, not a task subtype).
-- Note: schedule_templates was renamed to routines in migration 0030.

-- ---------------------------------------------------------------------------
-- A.2 Drop meal_tasks specialization table (meals are not task subtypes)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS meal_tasks;

-- ---------------------------------------------------------------------------
-- A.1 Remove 'meal' from tasks.task_type CHECK constraint
-- ---------------------------------------------------------------------------
-- Purge any existing meal-typed tasks (invalid under new model)
DELETE FROM tasks WHERE task_type = 'meal';

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check
    CHECK (task_type IN ('exercise', 'work', 'leisure', 'appointment', 'medication', 'general'));

-- ---------------------------------------------------------------------------
-- A.3 Make schedule_entries.task_type nullable and remove 'meal' from CHECK
-- Meal anchor entries: task_type = NULL. Task entries: task_type = non-null.
-- ---------------------------------------------------------------------------
ALTER TABLE schedule_entries ALTER COLUMN task_type DROP NOT NULL;

-- Migrate existing meal anchor entries: task_type 'meal' → NULL
UPDATE schedule_entries SET task_type = NULL WHERE task_type = 'meal';

ALTER TABLE schedule_entries DROP CONSTRAINT IF EXISTS schedule_entries_task_type_check;
ALTER TABLE schedule_entries ADD CONSTRAINT schedule_entries_task_type_check
    CHECK (task_type IS NULL OR task_type IN ('exercise', 'work', 'leisure', 'appointment', 'medication', 'general'));

-- ---------------------------------------------------------------------------
-- Remove 'meal' from routines.task_type CHECK (routines are for tasks only)
-- Table was renamed from schedule_templates → routines in migration 0030.
-- ---------------------------------------------------------------------------
DELETE FROM routines WHERE task_type = 'meal';

ALTER TABLE routines DROP CONSTRAINT IF EXISTS schedule_templates_task_type_check;
ALTER TABLE routines DROP CONSTRAINT IF EXISTS routines_task_type_check;
ALTER TABLE routines ADD CONSTRAINT routines_task_type_check
    CHECK (task_type IN ('exercise', 'work', 'leisure', 'appointment', 'medication', 'general'));
