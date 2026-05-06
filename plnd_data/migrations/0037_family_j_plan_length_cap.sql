-- Migration 0037: Family J — cap default_plan_length_days at 14 per §4.9

-- Clamp any stored values that exceed the new cap before tightening the constraint.
UPDATE user_preferences
  SET default_plan_length_days = 14
  WHERE default_plan_length_days > 14;

-- Replace the 1–90 constraint with 1–14.
ALTER TABLE user_preferences
  DROP CONSTRAINT chk_default_plan_length_days;

ALTER TABLE user_preferences
  ADD CONSTRAINT chk_default_plan_length_days
    CHECK (default_plan_length_days BETWEEN 1 AND 14);
