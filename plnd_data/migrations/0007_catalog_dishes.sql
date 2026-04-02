-- Migration 0007: Catalog dishes — recipes composed of catalog ingredients
CREATE TABLE catalog_dishes (
    dish_id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name                   VARCHAR(200) NOT NULL,
    description            TEXT,
    instructions           TEXT,
    prep_time_minutes      INTEGER      CHECK (prep_time_minutes >= 0),
    cook_time_minutes      INTEGER      CHECK (cook_time_minutes >= 0),
    servings               NUMERIC(5,2) NOT NULL DEFAULT 1 CHECK (servings > 0),
    allergens              TEXT[]       NOT NULL DEFAULT '{}',
    allergens_overridden   BOOLEAN      NOT NULL DEFAULT FALSE, -- TRUE = manually verified, not computed
    occasion_tags          TEXT[]       NOT NULL DEFAULT '{}',  -- soft hints, no CHECK constraint
    tags                   TEXT[]       NOT NULL DEFAULT '{}',
    nutrition              JSONB,                               -- per serving; NULL = compute from ingredients
    nutrition_overridden   BOOLEAN      NOT NULL DEFAULT FALSE,
    contributed_by_user_id UUID         REFERENCES users(user_id) ON DELETE SET NULL,
    created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_catalog_dishes_fts ON catalog_dishes
    USING GIN (to_tsvector('english', name || ' ' || COALESCE(description, '')));
CREATE INDEX idx_catalog_dishes_allergens     ON catalog_dishes USING GIN (allergens);
CREATE INDEX idx_catalog_dishes_occasion_tags ON catalog_dishes USING GIN (occasion_tags);
CREATE INDEX idx_catalog_dishes_tags          ON catalog_dishes USING GIN (tags);

CREATE TABLE catalog_dish_ingredients (
    dish_ingredient_id UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    dish_id            UUID          NOT NULL REFERENCES catalog_dishes(dish_id) ON DELETE CASCADE,
    ingredient_id      UUID          NOT NULL REFERENCES catalog_ingredients(ingredient_id) ON DELETE RESTRICT,
    quantity           NUMERIC(10,4) NOT NULL CHECK (quantity > 0),
    unit               VARCHAR(50)   NOT NULL,
    preparation_note   VARCHAR(200),
    is_optional        BOOLEAN       NOT NULL DEFAULT FALSE,
    sort_order         SMALLINT      NOT NULL DEFAULT 0,
    CONSTRAINT uq_dish_ingredient UNIQUE (dish_id, ingredient_id)
);

CREATE INDEX idx_catalog_dish_ingredients_dish       ON catalog_dish_ingredients (dish_id);
CREATE INDEX idx_catalog_dish_ingredients_ingredient ON catalog_dish_ingredients (ingredient_id);
