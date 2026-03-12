-- Migration 0009: User dish library — personal recipes forked from catalog or created from scratch.
-- user_dish_ingredients references catalog_ingredients only (personal ingredient overrides deferred to Phase 3/4).
CREATE TABLE user_dishes (
    user_dish_id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                UUID         NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    catalog_dish_id        UUID         REFERENCES catalog_dishes(dish_id) ON DELETE SET NULL,
    name                   VARCHAR(200) NOT NULL,
    description            TEXT,
    instructions           TEXT,
    prep_time_minutes      INTEGER      CHECK (prep_time_minutes >= 0),
    cook_time_minutes      INTEGER      CHECK (cook_time_minutes >= 0),
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

CREATE INDEX idx_user_dishes_user    ON user_dishes (user_id);
CREATE INDEX idx_user_dishes_catalog ON user_dishes (catalog_dish_id) WHERE catalog_dish_id IS NOT NULL;
CREATE INDEX idx_user_dishes_safe    ON user_dishes (user_id) WHERE is_safe_food = TRUE;

CREATE TABLE user_dish_ingredients (
    user_dish_ingredient_id UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    user_dish_id            UUID          NOT NULL REFERENCES user_dishes(user_dish_id) ON DELETE CASCADE,
    ingredient_id           UUID          NOT NULL REFERENCES catalog_ingredients(ingredient_id) ON DELETE RESTRICT,
    quantity                NUMERIC(10,4) NOT NULL CHECK (quantity > 0),
    unit                    VARCHAR(50)   NOT NULL,
    preparation_note        VARCHAR(200),
    is_optional             BOOLEAN       NOT NULL DEFAULT FALSE,
    sort_order              SMALLINT      NOT NULL DEFAULT 0,
    CONSTRAINT uq_user_dish_ingredient UNIQUE (user_dish_id, ingredient_id)
);

CREATE INDEX idx_user_dish_ingredients_dish ON user_dish_ingredients (user_dish_id);
