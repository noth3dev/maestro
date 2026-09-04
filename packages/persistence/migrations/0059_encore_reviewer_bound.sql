-- Keep the persistence boundary aligned with the public Encore review contract.
-- Existing rows outside this bound must block migration rather than be silently changed.
ALTER TABLE encore_council_rounds
  ADD CONSTRAINT encore_council_rounds_reviewer_count_max
  CHECK (reviewer_count BETWEEN 1 AND 8);
