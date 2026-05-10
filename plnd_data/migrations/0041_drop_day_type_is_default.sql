-- Drop is_default from user_day_types.
--
-- Day-of-week assignment is exclusive: every weekday belongs to exactly one
-- day type, so no date can be unassigned for bitmask-based schedules.
-- The partial unique index and column are removed to eliminate the parallel-
-- insert race condition they introduced.
DROP INDEX idx_user_day_types_one_default;
ALTER TABLE user_day_types DROP COLUMN is_default;
