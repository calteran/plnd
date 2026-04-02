-- Migration 0008: Revised catalog_meals — eating occasion templates composed of dishes.
-- Safe to DROP + recreate; no catalog meal data exists yet (catalog seeding is a future task).
DROP TABLE IF EXISTS catalog_meals CASCADE;

CREATE TABLE catalog_meals (
    meal_id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name                   VARCHAR(200) NOT NULL,
    description            TEXT,
    servings               NUMERIC(5,2) NOT NULL DEFAULT 1 CHECK (servings > 0),
    allergens              TEXT[]       NOT NULL DEFAULT '{}',
    allergens_overridden   BOOLEAN      NOT NULL DEFAULT FALSE,
    occasion_tags          TEXT[]       NOT NULL DEFAULT '{}',  -- replaces meal_type enum; soft hints only
    tags                   TEXT[]       NOT NULL DEFAULT '{}',
    nutrition              JSONB,                               -- per person; NULL = compute from dishes
    nutrition_overridden   BOOLEAN      NOT NULL DEFAULT FALSE,
    contributed_by_user_id UUID         REFERENCES users(user_id) ON DELETE SET NULL,
    created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_catalog_meals_fts ON catalog_meals
    USING GIN (to_tsvector('english', name || ' ' || COALESCE(description, '')));
CREATE INDEX idx_catalog_meals_occasion_tags ON catalog_meals USING GIN (occasion_tags);
CREATE INDEX idx_catalog_meals_tags          ON catalog_meals USING GIN (tags);

CREATE TABLE catalog_meal_dishes (
    meal_dish_id  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    meal_id       UUID         NOT NULL REFERENCES catalog_meals(meal_id) ON DELETE CASCADE,
    dish_id       UUID         NOT NULL REFERENCES catalog_dishes(dish_id) ON DELETE RESTRICT,
    dish_servings NUMERIC(5,2) NOT NULL DEFAULT 1 CHECK (dish_servings > 0),
    notes         TEXT,
    sort_order    SMALLINT     NOT NULL DEFAULT 0,
    CONSTRAINT uq_meal_dish UNIQUE (meal_id, dish_id)
);

CREATE INDEX idx_catalog_meal_dishes_meal ON catalog_meal_dishes (meal_id);
CREATE INDEX idx_catalog_meal_dishes_dish ON catalog_meal_dishes (dish_id);
