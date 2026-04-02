-- Migration 0013: User library preference tables.
-- Separates user relationship data (ratings, prefs) from recipe content (user_dishes, user_meals).
-- Pref records are the stable aggregate root — the client always uses the pref_id as its stable handle.

-- ---------------------------------------------------------------------------
-- Dish preferences: stable handle for a user's relationship with any dish
-- ---------------------------------------------------------------------------
CREATE TABLE user_dish_prefs (
    user_dish_pref_id  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    catalog_dish_id    UUID        REFERENCES catalog_dishes(dish_id) ON DELETE SET NULL,
    user_dish_id       UUID        REFERENCES user_dishes(user_dish_id) ON DELETE SET NULL,
    rating             SMALLINT    CHECK (rating BETWEEN 1 AND 5),
    is_safe_food       BOOLEAN     NOT NULL DEFAULT FALSE,
    is_blocked         BOOLEAN     NOT NULL DEFAULT FALSE,
    notes              TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, catalog_dish_id),
    CHECK (catalog_dish_id IS NOT NULL OR user_dish_id IS NOT NULL)
);

CREATE INDEX idx_user_dish_prefs_user    ON user_dish_prefs (user_id);
CREATE INDEX idx_user_dish_prefs_catalog ON user_dish_prefs (catalog_dish_id) WHERE catalog_dish_id IS NOT NULL;
CREATE INDEX idx_user_dish_prefs_blocked ON user_dish_prefs (user_id) WHERE is_blocked = TRUE;
CREATE INDEX idx_user_dish_prefs_safe    ON user_dish_prefs (user_id) WHERE is_safe_food = TRUE;

-- ---------------------------------------------------------------------------
-- Meal preferences: same pattern for meals
-- ---------------------------------------------------------------------------
CREATE TABLE user_meal_prefs (
    user_meal_pref_id  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    catalog_meal_id    UUID        REFERENCES catalog_meals(meal_id) ON DELETE SET NULL,
    user_meal_id       UUID        REFERENCES user_meals(user_meal_id) ON DELETE SET NULL,
    rating             SMALLINT    CHECK (rating BETWEEN 1 AND 5),
    is_safe_food       BOOLEAN     NOT NULL DEFAULT FALSE,
    is_blocked         BOOLEAN     NOT NULL DEFAULT FALSE,
    notes              TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, catalog_meal_id),
    CHECK (catalog_meal_id IS NOT NULL OR user_meal_id IS NOT NULL)
);

CREATE INDEX idx_user_meal_prefs_user    ON user_meal_prefs (user_id);
CREATE INDEX idx_user_meal_prefs_catalog ON user_meal_prefs (catalog_meal_id) WHERE catalog_meal_id IS NOT NULL;
CREATE INDEX idx_user_meal_prefs_blocked ON user_meal_prefs (user_id) WHERE is_blocked = TRUE;
CREATE INDEX idx_user_meal_prefs_safe    ON user_meal_prefs (user_id) WHERE is_safe_food = TRUE;

-- ---------------------------------------------------------------------------
-- Ingredient preferences: user preferences on catalog ingredients (no fork concept)
-- ---------------------------------------------------------------------------
CREATE TABLE user_ingredient_prefs (
    user_ingredient_pref_id UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    catalog_ingredient_id   UUID        NOT NULL REFERENCES catalog_ingredients(ingredient_id) ON DELETE CASCADE,
    is_blocked              BOOLEAN     NOT NULL DEFAULT FALSE,
    notes                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, catalog_ingredient_id)
);

CREATE INDEX idx_user_ingredient_prefs_user    ON user_ingredient_prefs (user_id);
CREATE INDEX idx_user_ingredient_prefs_blocked ON user_ingredient_prefs (user_id) WHERE is_blocked = TRUE;

-- ---------------------------------------------------------------------------
-- Remove prefs columns from recipe tables — they now live in pref records
-- ---------------------------------------------------------------------------
ALTER TABLE user_dishes
    DROP COLUMN rating,
    DROP COLUMN is_safe_food,
    DROP COLUMN is_blocked,
    DROP COLUMN notes;

ALTER TABLE user_meals
    DROP COLUMN rating,
    DROP COLUMN is_safe_food,
    DROP COLUMN is_blocked,
    DROP COLUMN notes;
