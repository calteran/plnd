-- Migration 0006: Catalog ingredients — atomic food items with nutrition, allergens, and external DB hooks
CREATE TABLE catalog_ingredients (
    ingredient_id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name                   VARCHAR(200) NOT NULL,
    description            TEXT,
    serving_size_g         NUMERIC(8,2),
    nutrition              JSONB,                  -- per serving (or per 100g if serving_size_g IS NULL)
    allergens              TEXT[]       NOT NULL DEFAULT '{}',
    occasion_tags          TEXT[]       NOT NULL DEFAULT '{}',
    external_id            VARCHAR(100),
    external_source        VARCHAR(50),            -- 'usda_fdc' | 'openfoodfacts' | NULL
    contributed_by_user_id UUID         REFERENCES users(user_id) ON DELETE SET NULL,
    created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_ingredient_external UNIQUE (external_source, external_id)
);

CREATE INDEX idx_catalog_ingredients_fts ON catalog_ingredients
    USING GIN (to_tsvector('english', name || ' ' || COALESCE(description, '')));
CREATE INDEX idx_catalog_ingredients_allergens     ON catalog_ingredients USING GIN (allergens);
CREATE INDEX idx_catalog_ingredients_occasion_tags ON catalog_ingredients USING GIN (occasion_tags);
