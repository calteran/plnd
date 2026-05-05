-- Migration: rename 'milepost' vocabulary to 'anchor' per architecture §10
-- Postgres automatically renames CHECK constraint references on RENAME COLUMN.

ALTER TABLE tasks             RENAME COLUMN is_milepost    TO is_anchor;
ALTER TABLE schedule_templates RENAME COLUMN is_milepost   TO is_anchor;
ALTER TABLE schedule_entries  RENAME COLUMN after_milepost TO after_anchor;
