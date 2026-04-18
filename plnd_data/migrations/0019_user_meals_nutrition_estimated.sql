-- Migration 0019: Add nutrition_estimated flag to user_meals.
-- Indicates that nutrition data was estimated by the AI rather than sourced from a catalog.
ALTER TABLE user_meals
    ADD COLUMN nutrition_estimated BOOLEAN NOT NULL DEFAULT FALSE;
