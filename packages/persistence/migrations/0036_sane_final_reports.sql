-- Phase 3 work-sequence step 9: Sane final reporting, gated on real
-- certification completeness -- never on plan-item completion percentage
-- or worker self-report. Additive only.

CREATE TABLE IF NOT EXISTS sane_final_reports (
  report_id uuid PRIMARY KEY,
  goal_id uuid NOT NULL REFERENCES goals (goal_id),
  success boolean NOT NULL,
  blockers jsonb NOT NULL CHECK (jsonb_typeof(blockers) = 'array'),
  ceo_request text NOT NULL CHECK (btrim(ceo_request) <> ''),
  what_changed text NOT NULL CHECK (btrim(what_changed) <> ''),
  user_visible_behavior_passed boolean NOT NULL,
  participating_departments jsonb NOT NULL CHECK (jsonb_typeof(participating_departments) = 'array'),
  key_decisions jsonb NOT NULL CHECK (jsonb_typeof(key_decisions) = 'array'),
  dissent jsonb NOT NULL CHECK (jsonb_typeof(dissent) = 'array'),
  independent_validation jsonb NOT NULL CHECK (jsonb_typeof(independent_validation) = 'array'),
  cost_cents bigint NOT NULL CHECK (cost_cents >= 0),
  budget_cents bigint NOT NULL CHECK (budget_cents >= 0),
  incidents jsonb NOT NULL CHECK (jsonb_typeof(incidents) = 'array'),
  known_limitations jsonb NOT NULL CHECK (jsonb_typeof(known_limitations) = 'array'),
  critical_action_awaiting_approval boolean NOT NULL,
  evidence_bundle_id uuid NOT NULL REFERENCES evidence_bundles (bundle_id),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime',
  -- Success can never be reported alongside a recorded blocker.
  CHECK (NOT success OR jsonb_array_length(blockers) = 0)
);
CREATE INDEX IF NOT EXISTS sane_final_reports_goal_idx ON sane_final_reports (goal_id, created_at);

CREATE OR REPLACE FUNCTION reject_sane_final_report_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Sane final reports are immutable once issued';
END;
$$;
DROP TRIGGER IF EXISTS sane_final_reports_immutable ON sane_final_reports;
CREATE TRIGGER sane_final_reports_immutable
  BEFORE UPDATE OR DELETE ON sane_final_reports
  FOR EACH ROW EXECUTE FUNCTION reject_sane_final_report_mutation();
