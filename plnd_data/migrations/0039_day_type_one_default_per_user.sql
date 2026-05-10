-- Migration 0039: Enforce exactly one default day type per user at the database level.
--
-- Context (closes #717): application-layer create() uses a NOT EXISTS subquery
-- to auto-assign the first type as default, but code that bypasses that path
-- (e.g. plnd_seed inserts is_default = true directly) has no constraint to catch
-- a second default. This partial unique index closes that gap.

CREATE UNIQUE INDEX idx_user_day_types_one_default
    ON user_day_types (user_id)
    WHERE is_default = true;
