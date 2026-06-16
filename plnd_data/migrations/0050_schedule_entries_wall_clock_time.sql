-- #936: Migrate planned wall-clock times off the timestamptz-as-UTC encoding.
--
-- `schedule_entries.scheduled_start` / `scheduled_end` stored a wall-clock
-- HH:MM as a TIMESTAMPTZ pinned to a UTC instant on the entry's date — the
-- #920 round-trip. The value is a literal wall-clock time-of-day; the row's
-- `date` column already supplies the calendar day (design D1, D7). Convert the
-- columns to TIME, extracting the wall-clock component from the legacy UTC
-- encoding so the persisted type matches the semantics.
--
-- `actual_start` / `actual_end` are genuine recorded instants (when a task was
-- actually started/finished), not planned wall-clock times — they remain
-- TIMESTAMPTZ. Absolute instants for planned times are computed only at the
-- edge via `timezone::resolve_instant` (D8).
ALTER TABLE schedule_entries
    ALTER COLUMN scheduled_start TYPE TIME USING (scheduled_start AT TIME ZONE 'UTC')::time,
    ALTER COLUMN scheduled_end   TYPE TIME USING (scheduled_end   AT TIME ZONE 'UTC')::time;
