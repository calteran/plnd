ALTER TABLE user_preferences
  ADD COLUMN breakfast_window_start TIME,
  ADD COLUMN breakfast_window_end   TIME,
  ADD COLUMN lunch_window_start     TIME,
  ADD COLUMN lunch_window_end       TIME,
  ADD COLUMN dinner_window_start    TIME,
  ADD COLUMN dinner_window_end      TIME;
