-- The catalog now holds the full USDA canonical corpus (~8k ingredients) instead
-- of ~120 seeded rows, so the FTS predicate in db/search.rs (search_ingredients)
-- warrants a GIN index on the same tsvector expression it queries.
CREATE INDEX IF NOT EXISTS idx_catalog_ingredients_fts
    ON catalog_ingredients
    USING gin (to_tsvector('english', name || ' ' || coalesce(description, '')));
