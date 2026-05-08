-- Migration 0038: Family G follow-up — re-scope meal_pattern_entries from user to day type
--
-- Ownership moves from user_id (direct) to day_type_id (via user_day_types FK).
-- Backfill assigns every existing row to its owning user's default day type.

-- 1. Add nullable column (rows must exist before backfill)
ALTER TABLE meal_pattern_entries
    ADD COLUMN day_type_id UUID REFERENCES user_day_types(id) ON DELETE CASCADE;

-- 2. Backfill: point every row at the user's default day type.
--    If any user has no default day type, this UPDATE leaves NULL and step 3 will
--    fail, rolling back the migration (safe guard against data corruption).
UPDATE meal_pattern_entries mpe
SET day_type_id = (
    SELECT id
    FROM user_day_types
    WHERE user_id = mpe.user_id
      AND is_default = true
    LIMIT 1
);

-- 3. Enforce NOT NULL now all rows are backfilled
ALTER TABLE meal_pattern_entries
    ALTER COLUMN day_type_id SET NOT NULL;

-- 4. Drop old user-scoped constraints (PostgreSQL auto-generated names from migration 0034)
ALTER TABLE meal_pattern_entries
    DROP CONSTRAINT meal_pattern_entries_user_id_name_key;

ALTER TABLE meal_pattern_entries
    DROP CONSTRAINT meal_pattern_entries_user_id_sort_order_key;

-- 5. Drop old user index
DROP INDEX meal_pattern_entries_user_idx;

-- 6. Add day-type-scoped unique constraints + index
ALTER TABLE meal_pattern_entries
    ADD CONSTRAINT meal_pattern_entries_day_type_id_name_key
    UNIQUE (day_type_id, name);

ALTER TABLE meal_pattern_entries
    ADD CONSTRAINT meal_pattern_entries_day_type_id_sort_order_key
    UNIQUE (day_type_id, sort_order);

CREATE INDEX meal_pattern_entries_day_type_idx
    ON meal_pattern_entries (day_type_id);

-- 7. Drop the now-redundant user_id column
ALTER TABLE meal_pattern_entries
    DROP COLUMN user_id;
