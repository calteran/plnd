-- Migration 0015: Planning horizon preferences + schedule entry title

ALTER TABLE user_preferences
  ADD COLUMN week_start_day           SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN planning_trigger_offset  SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN default_plan_length_days SMALLINT NOT NULL DEFAULT 7;

ALTER TABLE user_preferences
  ADD CONSTRAINT chk_week_start_day
    CHECK (week_start_day BETWEEN 0 AND 6),
  ADD CONSTRAINT chk_planning_trigger_offset
    CHECK (planning_trigger_offset BETWEEN -14 AND 14),
  ADD CONSTRAINT chk_default_plan_length_days
    CHECK (default_plan_length_days BETWEEN 1 AND 90);

-- Optional display title for schedule entries without an entity reference
-- (e.g., one-off custom tasks created in the planning wizard)
ALTER TABLE schedule_entries
  ADD COLUMN title VARCHAR(200);
