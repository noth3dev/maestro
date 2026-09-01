CREATE TABLE IF NOT EXISTS authority_records (
  record_id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('grant', 'approval')),
  command_id uuid,
  project_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  actor_id text NOT NULL CHECK (actor_id <> ''),
  action text NOT NULL CHECK (action <> ''),
  target text NOT NULL CHECK (target <> ''),
  policy_version integer NOT NULL CHECK (policy_version >= 0),
  budget_effect_cents bigint NOT NULL,
  expires_at timestamptz NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  revoked_at timestamptz,
  CHECK ((kind = 'approval' AND command_id IS NOT NULL) OR kind = 'grant')
);
CREATE INDEX IF NOT EXISTS authority_records_scope_idx
  ON authority_records (project_id, goal_id, actor_id, action, target, policy_version, budget_effect_cents, kind);

CREATE TABLE IF NOT EXISTS authority_decisions (
  decision_id uuid PRIMARY KEY,
  command_id uuid NOT NULL,
  project_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  actor_id text NOT NULL CHECK (actor_id <> ''),
  action text NOT NULL CHECK (action <> ''),
  target text NOT NULL CHECK (target <> ''),
  policy_version integer NOT NULL CHECK (policy_version >= 0),
  budget_effect_cents bigint NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('allow', 'deny', 'require_approval')),
  reason text NOT NULL CHECK (reason <> ''),
  classification text NOT NULL CHECK (classification IN ('ordinary', 'critical', 'forbidden', 'ambiguous')),
  matched_record_id uuid REFERENCES authority_records(record_id),
  decided_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS authority_decisions_request_idx ON authority_decisions (project_id, goal_id, command_id, decided_at);

CREATE OR REPLACE FUNCTION authority_records_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.record_id IS DISTINCT FROM OLD.record_id OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.command_id IS DISTINCT FROM OLD.command_id OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.goal_id IS DISTINCT FROM OLD.goal_id OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
    OR NEW.action IS DISTINCT FROM OLD.action OR NEW.target IS DISTINCT FROM OLD.target
    OR NEW.policy_version IS DISTINCT FROM OLD.policy_version OR NEW.budget_effect_cents IS DISTINCT FROM OLD.budget_effect_cents
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.issued_at IS DISTINCT FROM OLD.issued_at THEN
    RAISE EXCEPTION 'authority record issuance is immutable';
  END IF;
  IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'authority record revocation is final';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS authority_records_immutable_trigger ON authority_records;
CREATE TRIGGER authority_records_immutable_trigger BEFORE UPDATE ON authority_records
  FOR EACH ROW EXECUTE FUNCTION authority_records_immutable();

CREATE OR REPLACE FUNCTION authority_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'authority audit records are append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS authority_records_append_only_delete ON authority_records;
CREATE TRIGGER authority_records_append_only_delete BEFORE DELETE ON authority_records
  FOR EACH ROW EXECUTE FUNCTION authority_append_only();

DROP TRIGGER IF EXISTS authority_decisions_append_only_update ON authority_decisions;
DROP TRIGGER IF EXISTS authority_decisions_append_only_delete ON authority_decisions;
CREATE TRIGGER authority_decisions_append_only_update BEFORE UPDATE ON authority_decisions
  FOR EACH ROW EXECUTE FUNCTION authority_append_only();
CREATE TRIGGER authority_decisions_append_only_delete BEFORE DELETE ON authority_decisions
  FOR EACH ROW EXECUTE FUNCTION authority_append_only();
