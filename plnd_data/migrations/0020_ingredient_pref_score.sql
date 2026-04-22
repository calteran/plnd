-- Add the new column; existing rows default to 0 (neutral)
ALTER TABLE user_ingredient_prefs
    ADD COLUMN preference_score SMALLINT NOT NULL DEFAULT 0
        CONSTRAINT user_ingredient_prefs_score_range
        CHECK (preference_score BETWEEN -2 AND 2);

-- Back-fill: previously blocked ingredients map to -2 (will refuse)
UPDATE user_ingredient_prefs
    SET preference_score = -2
    WHERE is_blocked = TRUE;

-- Drop the partial index that depended on is_blocked
DROP INDEX IF EXISTS idx_user_ingredient_prefs_blocked;

-- Drop the old column
ALTER TABLE user_ingredient_prefs
    DROP COLUMN is_blocked;
