-- Migration 0049: brand provenance for branded-ingredient normalization (#913).
-- Branded products (Open Food Facts / USDA Branded) are promoted under a clean
-- generic `name`; the extracted brand lives here. NULL for canonical (USDA
-- Foundation/SR Legacy) and user-contributed rows. Forward-only: the dev DB is
-- rebuilt each boot, so no backfill of existing rows is required.
ALTER TABLE catalog_ingredients
    ADD COLUMN brand VARCHAR(100);

-- Recreate the FTS index to include `brand` so a brand-token query (e.g.
-- "Great Value") still matches after the brand moves out of `name`. The clean
-- generic `name` continues to drive the exact/prefix ranking in search_ingredients.
DROP INDEX IF EXISTS idx_catalog_ingredients_fts;
CREATE INDEX idx_catalog_ingredients_fts ON catalog_ingredients
    USING GIN (to_tsvector('english',
        name || ' ' || COALESCE(brand, '') || ' ' || COALESCE(description, '')));
