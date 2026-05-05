-- E.1: rename table and index
ALTER TABLE user_schedule_types RENAME TO user_day_types;
ALTER INDEX idx_user_schedule_types_user RENAME TO idx_user_day_types_user;

-- E.2: rename bed_time → sleep_time
ALTER TABLE user_day_types RENAME COLUMN bed_time TO sleep_time;

-- E.3: add is_default flag (default false, then backfill one per user)
ALTER TABLE user_day_types ADD COLUMN is_default BOOLEAN NOT NULL DEFAULT false;

-- Backfill: make the earliest day type per user the default (safe for existing data)
UPDATE user_day_types
SET is_default = true
WHERE id IN (
    SELECT DISTINCT ON (user_id) id
    FROM user_day_types
    ORDER BY user_id, created_at ASC
);

-- E.4: drop old cycle-only CHECK, add XOR-enforcing CHECK
ALTER TABLE user_day_types DROP CONSTRAINT chk_cycle_fields;

-- Defensively zero out bitmask on any pre-existing cycle types
UPDATE user_day_types SET days_bitmask = 0 WHERE is_cycle = true;

ALTER TABLE user_day_types ADD CONSTRAINT chk_day_type_mechanism CHECK (
    (is_cycle = false AND cycle_length IS NULL AND anchor_date IS NULL)
    OR
    (is_cycle = true AND days_bitmask = 0
     AND cycle_length IS NOT NULL AND cycle_length > 0
     AND anchor_date IS NOT NULL)
);
