-- Add per-position bitmask for cycle day types.
--
-- A cycle of length N may now be partitioned among multiple day types: each
-- type's cycle_bitmask is an N-bit value indicating which positions in the
-- cycle that type covers. Mirrors days_bitmask (Sun..Sat) for weekday types.
-- Existing cycle types backfill to full coverage so the resolver returns true
-- for every date in the cycle, matching the prior "1-of-1" behavior.
ALTER TABLE user_day_types ADD COLUMN cycle_bitmask INTEGER NOT NULL DEFAULT 0;
UPDATE user_day_types
SET cycle_bitmask = (1 << cycle_length) - 1
WHERE is_cycle = TRUE AND cycle_length IS NOT NULL;
