CREATE TABLE user_meal_habits (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    meal_name       TEXT NOT NULL,
    -- 'snack' is intentionally excluded: UI spec defines only breakfast/lunch/dinner
    -- as meal habit slots. See plnd_api/src/routes/meal_habits.rs for the companion note.
    slot            TEXT NOT NULL CHECK (slot IN ('breakfast','lunch','dinner')),
    recurrence_rule TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX user_meal_habits_user_idx ON user_meal_habits (user_id);
