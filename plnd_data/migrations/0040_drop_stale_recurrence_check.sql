-- Migration 0040: drop orphaned check constraint from pre-rename era.
-- schedule_templates_recurrence_check was the auto-named inline CHECK on the
-- original schedule_templates.recurrence column (migration 0011). When the table
-- was renamed to routines (0030), the constraint kept its old name. Migration 0031
-- tried to drop it as routines_recurrence_check — wrong name, silently ignored due
-- to IF EXISTS. Routines with recurrence_tag 'monthly' or 'yearly' are blocked by
-- this stale constraint even though routines_recurrence_tag_check (added in 0031)
-- already covers the correct enum.
ALTER TABLE routines DROP CONSTRAINT IF EXISTS schedule_templates_recurrence_check;
