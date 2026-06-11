-- Migration 0045 — meal anchor consumption tracking
-- Resolves issue #829: the `yesterday_snapshot.meals_logged` metric lost its
-- source when #828 (migration 0044) moved meal anchors out of schedule_entries
-- into meal_anchor_instances. Pre-#828 the metric counted meal-anchor rows
-- whose schedule_entries.status was 'completed'; that proxy no longer exists.
--
-- Meals are a separate domain from tasks (architecture.md §4.6) with their own
-- lifecycle, so this introduces meal-specific consumption state rather than
-- reusing the task status vocabulary:
--   status      — 'planned' (default), 'consumed', or 'skipped'.
--   consumed_at — when the user logged the meal as eaten; NULL otherwise.
--
-- The CHECK ties the timestamp to the status: consumed_at is present exactly
-- when status = 'consumed', so "when was this eaten" analytics can rely on it.
-- meals_logged is rewired to COUNT FILTER (status = 'consumed').

ALTER TABLE meal_anchor_instances
    ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned', 'consumed', 'skipped')),
    ADD COLUMN consumed_at TIMESTAMPTZ,
    ADD CONSTRAINT meal_anchor_instances_consumed_at_status_check
        CHECK ((status = 'consumed') = (consumed_at IS NOT NULL));
