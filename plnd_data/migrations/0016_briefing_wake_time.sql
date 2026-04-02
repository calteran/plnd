-- Migration 0016: Add wake_time to user_preferences (used by Phase 5 push scheduler)
ALTER TABLE user_preferences
  ADD COLUMN wake_time TIME NOT NULL DEFAULT '07:00';
