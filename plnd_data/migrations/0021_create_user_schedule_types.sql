CREATE TABLE user_schedule_types (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    name         TEXT        NOT NULL,
    days_bitmask INTEGER     NOT NULL,
    wake_time    TIME        NOT NULL,
    bed_time     TIME        NOT NULL,
    is_cycle     BOOLEAN     NOT NULL DEFAULT false,
    cycle_length INTEGER,
    anchor_date  DATE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_cycle_fields CHECK (
        (is_cycle = false AND cycle_length IS NULL AND anchor_date IS NULL)
        OR
        (is_cycle = true AND cycle_length IS NOT NULL AND anchor_date IS NOT NULL)
    )
);

CREATE INDEX idx_user_schedule_types_user ON user_schedule_types (user_id);
