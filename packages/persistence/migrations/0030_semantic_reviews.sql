-- Phase 3 work-sequence step 3: semantic review with fixed criteria and
-- isolated context. A review record is an immutable historical fact once
-- produced; a re-review of the same claim is a new row, never an edit.
-- Additive only.

CREATE TABLE IF NOT EXISTS semantic_reviews (
  review_id uuid PRIMARY KEY,
  goal_id uuid NOT NULL REFERENCES goals (goal_id),
  claim_text text NOT NULL CHECK (btrim(claim_text) <> ''),
  criteria jsonb NOT NULL CHECK (jsonb_typeof(criteria) = 'array'),
  prompt text NOT NULL CHECK (btrim(prompt) <> ''),
  raw_output text,
  verdict text NOT NULL CHECK (verdict IN ('supported', 'unsupported', 'ambiguous')),
  cited_evidence_ids jsonb NOT NULL CHECK (jsonb_typeof(cited_evidence_ids) = 'array'),
  reasoning text,
  execution_ref text NOT NULL CHECK (btrim(execution_ref) <> ''),
  invocation_ref text NOT NULL CHECK (btrim(invocation_ref) <> ''),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime'
);
CREATE INDEX IF NOT EXISTS semantic_reviews_goal_idx ON semantic_reviews (goal_id, created_at);

CREATE OR REPLACE FUNCTION reject_semantic_review_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Semantic review records are immutable once produced';
END;
$$;
DROP TRIGGER IF EXISTS semantic_reviews_immutable ON semantic_reviews;
CREATE TRIGGER semantic_reviews_immutable
  BEFORE UPDATE OR DELETE ON semantic_reviews
  FOR EACH ROW EXECUTE FUNCTION reject_semantic_review_mutation();
