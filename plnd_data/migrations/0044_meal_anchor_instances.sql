-- Migration 0044 — Per-date meal anchor instances (issue #828).
--
-- Completes the meals/tasks separation started in 0032 and continued in 0043:
-- meal anchors move out of schedule_entries entirely into their own table.
-- schedule_entries becomes task-only (task_type NOT NULL again).
--
-- New shape:
--   meal_anchor_instances        — concrete per-date meal anchors (the instance store).
--   meal_anchor_materializations — marker per (user_id, date); allows
--                                  "materialized but emptied" to be distinguished
--                                  from "never materialized" so a user who removes
--                                  every meal on a date doesn't see them re-appear.
--
-- planned_meal_entries.schedule_entry_id → meal_anchor_instance_id  (FK retargeted).
-- schedule_entries.slot_anchor_id        → slot_meal_anchor_id      (FK retargeted).

-- ---------------------------------------------------------------------------
-- 1. Instance store
-- ---------------------------------------------------------------------------
CREATE TABLE meal_anchor_instances (
    id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID         NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    date               DATE         NOT NULL,
    name               TEXT         NOT NULL,
    preferred_time     TIME         NOT NULL,
    tolerance_minutes  INT          NOT NULL DEFAULT 60
                                        CHECK (tolerance_minutes >= 0 AND tolerance_minutes <= 720),
    sort_order         INT          NOT NULL,
    template_entry_id  UUID         REFERENCES meal_pattern_entries(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, date, name)
);

CREATE INDEX idx_meal_anchor_instances_user_date
    ON meal_anchor_instances(user_id, date);

-- ---------------------------------------------------------------------------
-- 2. Materialization marker (the lazy-on-first-need bookkeeping)
-- ---------------------------------------------------------------------------
CREATE TABLE meal_anchor_materializations (
    user_id          UUID         NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    date             DATE         NOT NULL,
    materialized_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, date)
);

-- ---------------------------------------------------------------------------
-- 3. Backfill existing meal-anchor rows from schedule_entries.
--    Preserve entry_id so planned_meal_entries.schedule_entry_id values
--    (which equal these entry_ids) can be copied across in step 4 without
--    a lookup.
-- ---------------------------------------------------------------------------
INSERT INTO meal_anchor_instances
    (id, user_id, date, name, preferred_time, sort_order, created_at, updated_at)
SELECT
    entry_id,
    user_id,
    date,
    title,
    (scheduled_start AT TIME ZONE 'UTC')::time,
    (ROW_NUMBER() OVER (PARTITION BY user_id, date ORDER BY scheduled_start, entry_id) - 1)::int,
    created_at,
    updated_at
FROM schedule_entries
WHERE task_type IS NULL;

INSERT INTO meal_anchor_materializations (user_id, date, materialized_at)
SELECT user_id, date, MIN(created_at)
FROM schedule_entries
WHERE task_type IS NULL
GROUP BY user_id, date;

-- ---------------------------------------------------------------------------
-- 4. Retarget planned_meal_entries: schedule_entry_id → meal_anchor_instance_id.
--    The old FK was REFERENCES schedule_entries(entry_id) ON DELETE CASCADE
--    (migration 0043). The new FK preserves the cascade semantics that
--    the design relies on (cascade-delete planned meal content when an
--    instance is removed).
-- ---------------------------------------------------------------------------
ALTER TABLE planned_meal_entries
    ADD COLUMN meal_anchor_instance_id UUID
        REFERENCES meal_anchor_instances(id) ON DELETE CASCADE;

UPDATE planned_meal_entries
SET meal_anchor_instance_id = schedule_entry_id;

ALTER TABLE planned_meal_entries
    ALTER COLUMN meal_anchor_instance_id SET NOT NULL;

ALTER TABLE planned_meal_entries
    DROP CONSTRAINT IF EXISTS planned_meal_entries_schedule_entry_id_key;

ALTER TABLE planned_meal_entries
    ADD CONSTRAINT planned_meal_entries_instance_unique
        UNIQUE (meal_anchor_instance_id);

ALTER TABLE planned_meal_entries DROP COLUMN schedule_entry_id;

-- ---------------------------------------------------------------------------
-- 5. Retarget schedule_entries.slot_anchor_id → slot_meal_anchor_id.
--    Floating tasks ("30 min after lunch") used to point at a meal-anchor
--    schedule_entries row by UUID; now they point at the instance.
-- ---------------------------------------------------------------------------
ALTER TABLE schedule_entries
    ADD COLUMN slot_meal_anchor_id UUID
        REFERENCES meal_anchor_instances(id) ON DELETE SET NULL;

UPDATE schedule_entries
SET slot_meal_anchor_id = slot_anchor_id
WHERE slot_anchor_id IS NOT NULL;

ALTER TABLE schedule_entries DROP COLUMN slot_anchor_id;

-- ---------------------------------------------------------------------------
-- 6. Remove meal-anchor placeholder rows; reinstate task_type NOT NULL and
--    tighten the CHECK constraint to the task-only vocabulary.
-- ---------------------------------------------------------------------------
DELETE FROM schedule_entries WHERE task_type IS NULL;

ALTER TABLE schedule_entries ALTER COLUMN task_type SET NOT NULL;

ALTER TABLE schedule_entries DROP CONSTRAINT IF EXISTS schedule_entries_task_type_check;
ALTER TABLE schedule_entries ADD CONSTRAINT schedule_entries_task_type_check
    CHECK (task_type IN ('exercise', 'work', 'leisure', 'appointment', 'medication', 'general'));
