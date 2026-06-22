-- One position per task within a (date, slot). The slot key is polymorphic:
-- after_anchor for slot tasks, slot_meal_anchor_id for paired tasks. Postgres
-- treats NULLs as distinct, so each task type is constrained by exactly one of
-- these (scheduled-task anchors, with both NULL, by neither). DEFERRABLE so the
-- reposition transaction can pass through transient collisions (0,1,2 -> 1,2,3)
-- and is validated only at COMMIT.
ALTER TABLE schedule_entries
    ADD CONSTRAINT schedule_entries_slot_after_anchor_position_key
        UNIQUE (user_id, date, after_anchor, slot_position)
        DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE schedule_entries
    ADD CONSTRAINT schedule_entries_slot_meal_anchor_position_key
        UNIQUE (user_id, date, slot_meal_anchor_id, slot_position)
        DEFERRABLE INITIALLY DEFERRED;
