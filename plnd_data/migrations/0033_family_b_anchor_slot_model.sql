-- Migration 0033: Family B — Anchor & slot model
--
-- B.1  Remove hardcoded 3-meal CHECK constraint from schedule_entries.after_anchor.
--      The column is widened to unconstrained TEXT so any anchor label is valid:
--      user-pattern meal occasions, "start_of_day", "end_of_day", custom labels.
--
-- B.8  Rename after_entry_id → slot_anchor_id to make the slot concept explicit.
--      The FK (REFERENCES schedule_entries(entry_id) ON DELETE SET NULL) is preserved;
--      PostgreSQL renames it automatically with the column.

-- B.1 — widen after_anchor
ALTER TABLE schedule_entries DROP CONSTRAINT IF EXISTS schedule_entries_after_anchor_check;
ALTER TABLE schedule_entries ALTER COLUMN after_anchor TYPE TEXT;

-- B.8 — rename after_entry_id → slot_anchor_id
ALTER TABLE schedule_entries RENAME COLUMN after_entry_id TO slot_anchor_id;
