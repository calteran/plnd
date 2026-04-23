-- Persist optional task duration and energy level on committed schedule entries.
-- Both columns are NULL for entries created before this migration or where the
-- caller did not supply the values.
ALTER TABLE schedule_entries
    ADD COLUMN duration_minutes INT         NULL CHECK (duration_minutes >= 0),
    ADD COLUMN energy_required  VARCHAR(10) NULL CHECK (energy_required IN ('low', 'medium', 'high'));
