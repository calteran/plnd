-- Add external_source + external_id to catalog_dishes and catalog_meals,
-- matching the pattern already established on catalog_ingredients (0006) and
-- catalog_exercises (0011). Existing rows keep NULL for both columns.
-- PostgreSQL UNIQUE treats NULLs as distinct, so manually-created rows won't conflict.

-- catalog_dishes
ALTER TABLE catalog_dishes
    ADD COLUMN external_source VARCHAR(50),
    ADD COLUMN external_id     VARCHAR(100);

ALTER TABLE catalog_dishes
    ADD CONSTRAINT uq_dish_external UNIQUE (external_source, external_id);

-- catalog_meals
ALTER TABLE catalog_meals
    ADD COLUMN external_source VARCHAR(50),
    ADD COLUMN external_id     VARCHAR(100);

ALTER TABLE catalog_meals
    ADD CONSTRAINT uq_meal_external UNIQUE (external_source, external_id);
