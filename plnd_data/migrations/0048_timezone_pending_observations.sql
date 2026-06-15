-- 0048_timezone_pending_observations.sql
-- Tracks a single in-flight "contradicting device reading" per user so that a
-- transient/stale device clock cannot immediately override a higher-trust
-- (user/inferred) timezone assertion (spec D9). Corroboration must persist
-- across sessions (observation_count) AND a dwell window before a one-time
-- "gentle confirm" standoff is raised. Promotion to a real timezone anchor or
-- dismissal deletes the row — this table never holds committed timeline state.
CREATE TABLE timezone_pending_observations (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
    observed_zone      TEXT NOT NULL,
    observation_count  INTEGER NOT NULL DEFAULT 1,
    first_seen         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    standoff_raised_at TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
