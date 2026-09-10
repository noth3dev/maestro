-- Durable explanation fields for approval decisions. Existing rows remain readable as legacy
-- (NULL) records but cannot satisfy a new below-requirement certification.
ALTER TABLE capability_approvals
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS consequence text;

ALTER TABLE capability_approvals
  DROP CONSTRAINT IF EXISTS capability_approvals_reason_line,
  DROP CONSTRAINT IF EXISTS capability_approvals_consequence_line;

ALTER TABLE capability_approvals
  ADD CONSTRAINT capability_approvals_reason_line CHECK (reason IS NULL OR (btrim(reason) <> '' AND reason !~ E'[\r\n]')),
  ADD CONSTRAINT capability_approvals_consequence_line CHECK (consequence IS NULL OR (btrim(consequence) <> '' AND consequence !~ E'[\r\n]'));
