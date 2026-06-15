-- Migration 0047 — Timezone-change anchor store (issue #929).
--
-- Introduces the timezone model's anchor store: every time the user's
-- effective timezone changes (device signal, explicit override, or AI-
-- inferred travel) a row is written here.  Downstream code builds the
-- user's "effective timezone at instant T" by finding the latest anchor
-- whose (effective_date, effective_time) ≤ T.
--
-- Key design choices:
--   effective_time nullable  — NULL means a whole-day/start-of-day switch
--                              that sorts before any timed anchor on that date.
--   zone TEXT                — IANA timezone name validated by Rust (chrono-tz),
--                              not by a DB check constraint.
--   source_ref nullable UUID — originating task id for 'inferred' anchors;
--                              no FK because calendar items span multiple tables.
--   inference_group nullable — links a depart/return pair so they can be
--                              atomically removed when an inferred trip is
--                              cancelled.
--
-- These anchors are NOT lazily materialised: they persist directly and must
-- be queryable for future dates.

-- ---------------------------------------------------------------------------
-- 1. Anchor store
-- ---------------------------------------------------------------------------
CREATE TABLE timezone_change_anchors (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID         NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    effective_date    DATE         NOT NULL,
    effective_time    TIME,
    zone              TEXT         NOT NULL,
    source            TEXT         NOT NULL CHECK (source IN ('device', 'user', 'inferred')),
    source_ref        UUID,
    inference_group   UUID,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    -- Anchors are immutable: the repository layer only inserts and deletes
    -- (a superseding zone is a new anchor, not an update). `updated_at` is set
    -- at insert and has no update trigger by design. If an UPDATE path is ever
    -- added, introduce a moddatetime trigger to keep this column accurate.
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_timezone_change_anchors_user_date
    ON timezone_change_anchors(user_id, effective_date);
