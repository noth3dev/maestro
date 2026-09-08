-- Preserve structured hard-filter rejection reasons in routing evidence.
-- The NOT NULL default is metadata-only for existing rows; it does not issue
-- UPDATE statements, so the 0072 append-only trigger remains authoritative.
ALTER TABLE ensemble_router_routing_evidence
  ADD COLUMN rejections jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(rejections) = 'array');
