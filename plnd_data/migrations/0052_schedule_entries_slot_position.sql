-- Per-slot ordering for floating/paired tasks (§4.9 user-sequencing).
-- Meaningful only for tasks that live in a slot (after_anchor) or are paired
-- with a meal (slot_meal_anchor_id); scheduled-task anchors ignore it.
ALTER TABLE schedule_entries
    ADD COLUMN slot_position INT NOT NULL DEFAULT 0;
