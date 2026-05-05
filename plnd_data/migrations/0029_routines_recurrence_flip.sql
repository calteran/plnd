-- Migration 0029: D.3 + D.4 — flip recurrence storage model
-- recurrence_rule becomes NOT NULL (canonical RRULE storage)
-- recurrence becomes recurrence_tag (nullable derived enum for presentation)
-- Curated enum gains 'monthly' and 'yearly'; loses 'custom'

-- Step 1: Drop the old CHECK constraint on recurrence
-- (auto-named by postgres as routines_recurrence_check after table rename in 0028)
ALTER TABLE routines DROP CONSTRAINT IF EXISTS routines_recurrence_check;

-- Step 2: Rename recurrence → recurrence_tag
ALTER TABLE routines RENAME COLUMN recurrence TO recurrence_tag;

-- Step 3: Make recurrence_tag nullable (it's now derived, may be null for advanced RRULEs)
ALTER TABLE routines ALTER COLUMN recurrence_tag DROP NOT NULL;

-- Step 4: Add new CHECK constraint for recurrence_tag with updated enum
ALTER TABLE routines
    ADD CONSTRAINT routines_recurrence_tag_check
    CHECK (recurrence_tag IS NULL
        OR recurrence_tag IN ('daily', 'weekdays', 'weekly', 'monthly', 'yearly'));

-- Step 5: Synthesize RRULE for legacy rows that have no recurrence_rule yet
UPDATE routines SET recurrence_rule =
    CASE recurrence_tag
        WHEN 'daily'    THEN 'FREQ=DAILY'
        WHEN 'weekdays' THEN 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'
        WHEN 'weekly'   THEN 'FREQ=WEEKLY'
        ELSE 'FREQ=DAILY'
    END
WHERE recurrence_rule IS NULL;

-- Step 6: Derive recurrence_tag from RRULE for rows that already have recurrence_rule
UPDATE routines SET recurrence_tag =
    CASE
        WHEN recurrence_rule = 'FREQ=DAILY'                         THEN 'daily'
        WHEN recurrence_rule = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' THEN 'weekdays'
        WHEN recurrence_rule LIKE 'FREQ=WEEKLY%'                    THEN 'weekly'
        WHEN recurrence_rule LIKE 'FREQ=MONTHLY%'                   THEN 'monthly'
        WHEN recurrence_rule LIKE 'FREQ=YEARLY%'                    THEN 'yearly'
        ELSE NULL
    END
WHERE recurrence_rule IS NOT NULL;

-- Step 7: Make recurrence_rule NOT NULL (all rows now have a value)
ALTER TABLE routines ALTER COLUMN recurrence_rule SET NOT NULL;

-- The routines_recurrence_rule_fmt check constraint (from 0027/0028) is still valid.
