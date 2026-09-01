-- Phase 3 work-sequence step 4: Overwatch Council trigger policy, sealed
-- reviewer judgments, actual-model records, and synthesis. Additive only.

CREATE TABLE IF NOT EXISTS overwatch_council_rounds (
  round_id uuid PRIMARY KEY,
  goal_id uuid NOT NULL REFERENCES goals (goal_id),
  question text NOT NULL CHECK (btrim(question) <> ''),
  criteria jsonb NOT NULL CHECK (jsonb_typeof(criteria) = 'array'),
  evidence_ids jsonb NOT NULL CHECK (jsonb_typeof(evidence_ids) = 'array'),
  trigger_reasons jsonb NOT NULL CHECK (jsonb_typeof(trigger_reasons) = 'array'),
  reviewer_count integer NOT NULL CHECK (reviewer_count > 0),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime'
);
CREATE INDEX IF NOT EXISTS overwatch_council_rounds_goal_idx ON overwatch_council_rounds (goal_id, created_at);

CREATE OR REPLACE FUNCTION reject_overwatch_round_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Overwatch Council round is immutable once frozen';
END;
$$;
DROP TRIGGER IF EXISTS overwatch_council_rounds_immutable ON overwatch_council_rounds;
CREATE TRIGGER overwatch_council_rounds_immutable
  BEFORE UPDATE OR DELETE ON overwatch_council_rounds
  FOR EACH ROW EXECUTE FUNCTION reject_overwatch_round_mutation();

-- Judgments are sealed: they are all written in one transaction only after
-- every reviewer has independently answered, so no partial set is ever
-- visible mid-collection and no reviewer's row can be inserted, read, or
-- amended in isolation from the others.
CREATE TABLE IF NOT EXISTS overwatch_council_judgments (
  judgment_id uuid PRIMARY KEY,
  round_id uuid NOT NULL REFERENCES overwatch_council_rounds (round_id),
  reviewer_index integer NOT NULL CHECK (reviewer_index >= 0),
  model_provider text NOT NULL CHECK (btrim(model_provider) <> ''),
  model_id text NOT NULL CHECK (btrim(model_id) <> ''),
  verdict text NOT NULL CHECK (verdict IN ('proceed', 'do_not_proceed', 'escalate')),
  confidence text NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
  reasoning text NOT NULL CHECK (btrim(reasoning) <> ''),
  conditions jsonb NOT NULL CHECK (jsonb_typeof(conditions) = 'array'),
  dissent_note text,
  cited_evidence_ids jsonb NOT NULL CHECK (jsonb_typeof(cited_evidence_ids) = 'array'),
  execution_ref text NOT NULL CHECK (btrim(execution_ref) <> ''),
  invocation_ref text NOT NULL CHECK (btrim(invocation_ref) <> ''),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime',
  UNIQUE (round_id, reviewer_index)
);
DROP TRIGGER IF EXISTS overwatch_council_judgments_immutable ON overwatch_council_judgments;
CREATE TRIGGER overwatch_council_judgments_immutable
  BEFORE UPDATE OR DELETE ON overwatch_council_judgments
  FOR EACH ROW EXECUTE FUNCTION reject_overwatch_round_mutation();

CREATE TABLE IF NOT EXISTS overwatch_council_syntheses (
  round_id uuid PRIMARY KEY REFERENCES overwatch_council_rounds (round_id),
  final_verdict text NOT NULL CHECK (final_verdict IN ('proceed', 'do_not_proceed', 'escalate')),
  same_model_only boolean NOT NULL,
  escalated boolean NOT NULL,
  dissent_notes jsonb NOT NULL CHECK (jsonb_typeof(dissent_notes) = 'array'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime'
);
DROP TRIGGER IF EXISTS overwatch_council_syntheses_immutable ON overwatch_council_syntheses;
CREATE TRIGGER overwatch_council_syntheses_immutable
  BEFORE UPDATE OR DELETE ON overwatch_council_syntheses
  FOR EACH ROW EXECUTE FUNCTION reject_overwatch_round_mutation();
