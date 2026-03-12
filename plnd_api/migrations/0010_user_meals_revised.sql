-- Migration 0010: Revised user_meals and user_meal_dishes composition table.
-- Safe to DROP + recreate; no user_meal data exists yet.
DROP TABLE IF EXISTS user_meals CASCADE;

CREATE TABLE user_meals (
    user_meal_id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                UUID         NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    catalog_meal_id        UUID         REFERENCES catalog_meals(meal_id) ON DELETE SET NULL,
    name                   VARCHAR(200) NOT NULL,
    description            TEXT,
    servings               NUMERIC(5,2) NOT NULL DEFAULT 1 CHECK (servings > 0),
    allergens              TEXT[]       NOT NULL DEFAULT '{}',
    allergens_overridden   BOOLEAN      NOT NULL DEFAULT FALSE,
    occasion_tags          TEXT[]       NOT NULL DEFAULT '{}',
    tags                   TEXT[]       NOT NULL DEFAULT '{}',
    nutrition              JSONB,
    nutrition_overridden   BOOLEAN      NOT NULL DEFAULT FALSE,
    rating                 SMALLINT     CHECK (rating BETWEEN 1 AND 5),
    is_safe_food           BOOLEAN      NOT NULL DEFAULT FALSE,
    is_blocked             BOOLEAN      NOT NULL DEFAULT FALSE,
    notes                  TEXT,
    created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_meals_user    ON user_meals (user_id);
CREATE INDEX idx_user_meals_catalog ON user_meals (catalog_meal_id) WHERE catalog_meal_id IS NOT NULL;
CREATE INDEX idx_user_meals_safe    ON user_meals (user_id) WHERE is_safe_food = TRUE;

CREATE TABLE user_meal_dishes (
    user_meal_dish_id UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_meal_id      UUID         NOT NULL REFERENCES user_meals(user_meal_id) ON DELETE CASCADE,
    catalog_dish_id   UUID         REFERENCES catalog_dishes(dish_id) ON DELETE RESTRICT,
    user_dish_id      UUID         REFERENCES user_dishes(user_dish_id) ON DELETE RESTRICT,
    dish_servings     NUMERIC(5,2) NOT NULL DEFAULT 1 CHECK (dish_servings > 0),
    notes             TEXT,
    sort_order        SMALLINT     NOT NULL DEFAULT 0,
    -- Exactly one dish source must be set
    CONSTRAINT chk_meal_dish_exactly_one CHECK (
        (catalog_dish_id IS NOT NULL AND user_dish_id IS NULL) OR
        (catalog_dish_id IS NULL     AND user_dish_id IS NOT NULL)
    )
);

CREATE INDEX idx_user_meal_dishes_meal         ON user_meal_dishes (user_meal_id);
CREATE INDEX idx_user_meal_dishes_catalog_dish ON user_meal_dishes (catalog_dish_id) WHERE catalog_dish_id IS NOT NULL;
CREATE INDEX idx_user_meal_dishes_user_dish    ON user_meal_dishes (user_dish_id)    WHERE user_dish_id IS NOT NULL;
