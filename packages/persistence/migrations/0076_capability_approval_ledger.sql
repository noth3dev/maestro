-- Goal-scoped capability approvals, repetition budgets, session mode, and append-only decision evidence.
CREATE TABLE IF NOT EXISTS capability_approvals (
  approval_id uuid PRIMARY KEY,
  capability_kind text NOT NULL CHECK (btrim(capability_kind) <> ''),
  project_id uuid NOT NULL,
  goal_id uuid NOT NULL REFERENCES goals(goal_id),
  command_id text NOT NULL CHECK (btrim(command_id) <> ''),
  action text NOT NULL CHECK (btrim(action) <> ''),
  target text NOT NULL CHECK (btrim(target) <> ''),
  policy_version integer NOT NULL CHECK (policy_version > 0),
  control_epoch text NOT NULL CHECK (btrim(control_epoch) <> ''),
  budget_effect_cents bigint NOT NULL CHECK (budget_effect_cents >= 0),
  tier text NOT NULL CHECK (tier IN ('automatic progress', 'Department Head', 'Encore Council', 'user')),
  approver_id text NOT NULL CHECK (btrim(approver_id) <> ''),
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected', 'safer_alternative')),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (capability_kind, goal_id, command_id)
);
CREATE INDEX IF NOT EXISTS capability_approvals_goal_idx
  ON capability_approvals (capability_kind, project_id, goal_id, expires_at);

CREATE TABLE IF NOT EXISTS capability_sessions (
  session_id uuid PRIMARY KEY,
  capability_kind text NOT NULL CHECK (btrim(capability_kind) <> ''),
  project_id uuid NOT NULL,
  goal_id uuid NOT NULL REFERENCES goals(goal_id),
  full_access_mode text NOT NULL CHECK (full_access_mode IN ('retain_intermediate_approvals', 'skip_intermediate_approvals')),
  selected_by text NOT NULL CHECK (btrim(selected_by) <> ''),
  selected_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (capability_kind, goal_id, session_id)
);
CREATE INDEX IF NOT EXISTS capability_sessions_goal_idx
  ON capability_sessions (capability_kind, project_id, goal_id, selected_at);

CREATE TABLE IF NOT EXISTS capability_repetition_budgets (
  approval_id uuid PRIMARY KEY REFERENCES capability_approvals(approval_id),
  scope_kind text NOT NULL CHECK (scope_kind IN ('one_execution', 'bounded_count', 'bounded_time', 'bounded_budget', 'session')),
  remaining_count bigint CHECK (remaining_count IS NULL OR remaining_count >= 0),
  remaining_budget_cents bigint CHECK (remaining_budget_cents IS NULL OR remaining_budget_cents >= 0),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CHECK (scope_kind <> 'bounded_count' OR remaining_count IS NOT NULL),
  CHECK (scope_kind <> 'bounded_time' OR expires_at IS NOT NULL),
  CHECK (scope_kind <> 'bounded_budget' OR remaining_budget_cents IS NOT NULL),
  CHECK (scope_kind NOT IN ('one_execution', 'session') OR remaining_count IS NULL OR remaining_count >= 0)
);

CREATE TABLE IF NOT EXISTS capability_repetition_claims (
  claim_id uuid PRIMARY KEY,
  approval_id uuid NOT NULL REFERENCES capability_approvals(approval_id),
  capability_kind text NOT NULL CHECK (btrim(capability_kind) <> ''),
  project_id uuid NOT NULL,
  goal_id uuid NOT NULL REFERENCES goals(goal_id),
  command_id text NOT NULL CHECK (btrim(command_id) <> ''),
  action text NOT NULL CHECK (btrim(action) <> ''),
  target text NOT NULL CHECK (btrim(target) <> ''),
  policy_version integer NOT NULL CHECK (policy_version > 0),
  budget_effect_cents bigint NOT NULL CHECK (budget_effect_cents >= 0),
  consumed_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (approval_id, command_id),
  UNIQUE (capability_kind, goal_id, command_id)
);
CREATE INDEX IF NOT EXISTS capability_repetition_claims_goal_idx
  ON capability_repetition_claims (capability_kind, project_id, goal_id, consumed_at);

CREATE TABLE IF NOT EXISTS capability_decision_journal (
  journal_id uuid PRIMARY KEY,
  capability_kind text NOT NULL CHECK (btrim(capability_kind) <> ''),
  project_id uuid NOT NULL,
  goal_id uuid NOT NULL REFERENCES goals(goal_id),
  approval_id uuid REFERENCES capability_approvals(approval_id),
  command_id text,
  event text NOT NULL CHECK (event IN ('approval', 'rejection', 'safer_alternative', 'interruption', 'effect_result', 'failure')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
CREATE INDEX IF NOT EXISTS capability_decision_journal_goal_idx
  ON capability_decision_journal (capability_kind, project_id, goal_id, recorded_at, journal_id);

CREATE OR REPLACE FUNCTION validate_capability_goal_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM goals WHERE goal_id = NEW.goal_id AND project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'Capability record Goal/project binding is invalid';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS capability_approvals_scope ON capability_approvals;
CREATE TRIGGER capability_approvals_scope BEFORE INSERT ON capability_approvals
  FOR EACH ROW EXECUTE FUNCTION validate_capability_goal_scope();
DROP TRIGGER IF EXISTS capability_sessions_scope ON capability_sessions;
CREATE TRIGGER capability_sessions_scope BEFORE INSERT ON capability_sessions
  FOR EACH ROW EXECUTE FUNCTION validate_capability_goal_scope();
DROP TRIGGER IF EXISTS capability_repetition_claims_scope ON capability_repetition_claims;
CREATE TRIGGER capability_repetition_claims_scope BEFORE INSERT ON capability_repetition_claims
  FOR EACH ROW EXECUTE FUNCTION validate_capability_goal_scope();
DROP TRIGGER IF EXISTS capability_decision_journal_scope ON capability_decision_journal;
CREATE TRIGGER capability_decision_journal_scope BEFORE INSERT ON capability_decision_journal
  FOR EACH ROW EXECUTE FUNCTION validate_capability_goal_scope();

CREATE OR REPLACE FUNCTION validate_capability_repetition_claim_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE approval_row capability_approvals%ROWTYPE;
BEGIN
  SELECT * INTO approval_row FROM capability_approvals WHERE approval_id = NEW.approval_id;
  IF NOT FOUND OR approval_row.capability_kind <> NEW.capability_kind
     OR approval_row.project_id <> NEW.project_id OR approval_row.goal_id <> NEW.goal_id
     OR approval_row.action <> NEW.action OR approval_row.target <> NEW.target
     OR approval_row.policy_version <> NEW.policy_version
     OR approval_row.budget_effect_cents <> NEW.budget_effect_cents THEN
    RAISE EXCEPTION 'Capability repetition claim identity does not match approval';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS capability_repetition_claims_identity ON capability_repetition_claims;
CREATE TRIGGER capability_repetition_claims_identity BEFORE INSERT ON capability_repetition_claims
  FOR EACH ROW EXECUTE FUNCTION validate_capability_repetition_claim_scope();

CREATE OR REPLACE FUNCTION reject_capability_journal_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Capability decision journal is append-only';
END;
$$;
DROP TRIGGER IF EXISTS capability_decision_journal_append_only ON capability_decision_journal;
CREATE TRIGGER capability_decision_journal_append_only BEFORE UPDATE OR DELETE ON capability_decision_journal
  FOR EACH ROW EXECUTE FUNCTION reject_capability_journal_mutation();
