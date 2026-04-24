ALTER TABLE dietary_restrictions
  DROP CONSTRAINT IF EXISTS dietary_restrictions_restriction_type_check;

ALTER TABLE dietary_restrictions
  ADD CONSTRAINT dietary_restrictions_restriction_type_check
  CHECK (restriction_type IN ('allergy', 'intolerance', 'preference', 'cultural_religious'));
