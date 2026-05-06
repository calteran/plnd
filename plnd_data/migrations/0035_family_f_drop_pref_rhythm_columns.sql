-- Migration 0035: Family F — Remove daily-rhythm columns from user_preferences.
-- wake_time now lives on user_day_types (Family E, migration 0029).
-- Meal windows now live on meal_pattern_entries (Family G, migration 0034).
ALTER TABLE user_preferences DROP COLUMN wake_time;
ALTER TABLE user_preferences DROP COLUMN breakfast_window_start;
ALTER TABLE user_preferences DROP COLUMN breakfast_window_end;
ALTER TABLE user_preferences DROP COLUMN lunch_window_start;
ALTER TABLE user_preferences DROP COLUMN lunch_window_end;
ALTER TABLE user_preferences DROP COLUMN dinner_window_start;
ALTER TABLE user_preferences DROP COLUMN dinner_window_end;
