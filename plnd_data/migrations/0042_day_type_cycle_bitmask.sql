-- Add per-position bitmask for cycle day types.
--
-- A cycle of length N may now be partitioned among multiple day types: each
-- type's cycle_bitmask is an N-bit value indicating which positions in the
-- cycle that type covers. Mirrors days_bitmask (Sun..Sat) for weekday types.
-- Existing cycle types backfill to full coverage so the resolver returns true
-- for every date in the cycle, matching the prior "1-of-1" behavior.
--
-- The intermediate shift goes through bigint to avoid the `1 << 31` overflow
-- on the int4 expression. The validator caps cycle_length at 30 going forward;
-- any pre-existing row with cycle_length > 30 keeps the default 0 (the user
-- will need to re-author it through the new contract).
ALTER TABLE user_day_types ADD COLUMN cycle_bitmask INTEGER NOT NULL DEFAULT 0;
UPDATE user_day_types
SET cycle_bitmask = ((1::bigint << cycle_length) - 1)::integer
WHERE is_cycle = TRUE
  AND cycle_length IS NOT NULL
  AND cycle_length BETWEEN 1 AND 30;
