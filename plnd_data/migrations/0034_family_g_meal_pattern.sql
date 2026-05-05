-- Migration 0034: Family G — Replace user_meal_habits with meal_pattern_entries
--
-- G.1  Add preferred_time, tolerance_minutes, sort_order (previously absent)
-- G.2  Remove CHECK constraint closing slot to breakfast/lunch/dinner; name is open TEXT
-- G.3  Remove per-meal recurrence_rule (architecture §4.6 forbids it; daily recurrence
--       is intrinsic to the pattern)

CREATE TABLE meal_pattern_entries (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    name              TEXT        NOT NULL,
    preferred_time    TIME        NOT NULL,
    tolerance_minutes INT         NOT NULL DEFAULT 60
                                  CHECK (tolerance_minutes >= 0 AND tolerance_minutes <= 720),
    sort_order        INT         NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, name),
    UNIQUE (user_id, sort_order)
);

CREATE INDEX meal_pattern_entries_user_idx ON meal_pattern_entries (user_id);

-- Drop old table. Consumer code is removed in this same PR.
DROP TABLE IF EXISTS user_meal_habits;
