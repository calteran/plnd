-- Migration 0036: Family H — add one_shot flag to tasks and schedule_entries.
-- one_shot = TRUE means "drop silently at window close; never enter carryover."
-- Default FALSE is safe for all pre-existing rows (carry them over as before).

ALTER TABLE tasks
    ADD COLUMN one_shot BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE schedule_entries
    ADD COLUMN one_shot BOOLEAN NOT NULL DEFAULT FALSE;
