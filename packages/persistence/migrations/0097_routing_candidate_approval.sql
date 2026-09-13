-- Plan 6 S10: bind routing candidate judgment/evaluation evidence and rollback scope.
-- Routing candidates cannot become judged or start rollout on an in-memory claim.

ALTER TABLE improvement_candidate_rollback_targets
  ADD COLUMN IF NOT EXISTS kind text,
  ADD COLUMN IF NOT EXISTS role_id text,
  ADD COLUMN IF NOT EXISTS task_class text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'improvement_candidate_rollback_targets'::regclass AND conname = 'improvement_candidate_rollback_targets_scope_shape') THEN
    ALTER TABLE improvement_candidate_rollback_targets ADD CONSTRAINT improvement_candidate_rollback_targets_scope_shape CHECK (
      (kind IS NULL AND role_id IS NULL AND task_class IS NULL)
      OR (kind IN ('persona_axis', 'routing_capability_axis') AND btrim(role_id) <> '' AND btrim(task_class) <> '')
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS routing_candidate_approvals (
  approval_id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES improvement_candidates(candidate_id) ON DELETE RESTRICT,
  candidate_version integer NOT NULL CHECK (candidate_version >= 1),
  candidate_content_hash char(64) NOT NULL CHECK (candidate_content_hash ~ '^[0-9a-f]{64}$'),
  project_id uuid NOT NULL,
  goal_id uuid NOT NULL REFERENCES goals(goal_id),
  role_id text NOT NULL CHECK (btrim(role_id) <> '' AND length(role_id) <= 256 AND role_id !~ E'[\r\n]'),
  task_class text NOT NULL CHECK (btrim(task_class) <> '' AND length(task_class) <= 256 AND task_class !~ E'[\r\n]'),
  evaluation_hash char(64) NOT NULL CHECK (evaluation_hash ~ '^[0-9a-f]{64}$'),
  evaluation_payload jsonb NOT NULL CHECK (jsonb_typeof(evaluation_payload) = 'object'),
  replay_status text NOT NULL CHECK (replay_status = 'compared'),
  synthetic_status text NOT NULL CHECK (synthetic_status = 'completed'),
  council_round_id uuid NOT NULL REFERENCES encore_council_rounds(round_id) ON DELETE RESTRICT,
  council_evidence_ids jsonb NOT NULL CHECK (jsonb_typeof(council_evidence_ids) = 'array' AND jsonb_array_length(council_evidence_ids) BETWEEN 1 AND 32),
  source_evidence_ids jsonb NOT NULL CHECK (jsonb_typeof(source_evidence_ids) = 'array' AND jsonb_array_length(source_evidence_ids) BETWEEN 1 AND 32),
  rollback_target_candidate_id uuid NOT NULL,
  rollback_target_version integer NOT NULL CHECK (rollback_target_version >= 1),
  rollback_target_content_hash char(64) NOT NULL CHECK (rollback_target_content_hash ~ '^[0-9a-f]{64}$'),
  rollback_target_kind text NOT NULL CHECK (rollback_target_kind IN ('persona_axis', 'routing_capability_axis')),
  rollback_target_role_id text NOT NULL CHECK (btrim(rollback_target_role_id) <> '' AND length(rollback_target_role_id) <= 256 AND rollback_target_role_id !~ E'[\r\n]'),
  rollback_target_task_class text NOT NULL CHECK (btrim(rollback_target_task_class) <> '' AND length(rollback_target_task_class) <= 256 AND rollback_target_task_class !~ E'[\r\n]'),
  operation_ref text NOT NULL UNIQUE CHECK (btrim(operation_ref) <> '' AND length(operation_ref) <= 256 AND operation_ref !~ E'[\r\n]'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime' CHECK (retention = 'project_lifetime'),
  UNIQUE (candidate_id, candidate_version, candidate_content_hash)
);
CREATE INDEX IF NOT EXISTS routing_candidate_approvals_scope_idx ON routing_candidate_approvals (project_id, goal_id, role_id, task_class);
REVOKE ALL ON routing_candidate_approvals FROM PUBLIC;

CREATE TABLE IF NOT EXISTS routing_candidate_approval_mutation_markers (
  transaction_id bigint PRIMARY KEY,
  token_hash char(64) NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$')
);
REVOKE ALL ON routing_candidate_approval_mutation_markers FROM PUBLIC;

CREATE OR REPLACE FUNCTION authorize_routing_candidate_approval_marker_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.transaction_id = txid_current()
     AND NEW.token_hash = encode(public.digest(NULLIF(current_setting('maestro.routing_candidate_approval_token', true), ''), 'sha256'), 'hex') THEN RETURN NEW; END IF;
  IF TG_OP = 'DELETE' AND OLD.transaction_id = txid_current()
     AND OLD.token_hash = encode(public.digest(NULLIF(current_setting('maestro.routing_candidate_approval_token', true), ''), 'sha256'), 'hex') THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'routing candidate approval markers are secured and one-use';
END;
$$;

CREATE OR REPLACE FUNCTION authorize_routing_candidate_approval_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE token_hash_value char(64);
BEGIN
  token_hash_value := encode(public.digest(NULLIF(current_setting('maestro.routing_candidate_approval_token', true), ''), 'sha256'), 'hex');
  IF NOT EXISTS (SELECT 1 FROM routing_candidate_approval_mutation_markers WHERE transaction_id = txid_current() AND token_hash = token_hash_value) THEN
    RAISE EXCEPTION 'routing candidate approval write is not bound to secured authorization';
  END IF;
  DELETE FROM routing_candidate_approval_mutation_markers WHERE transaction_id = txid_current() AND token_hash = token_hash_value;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION reject_routing_candidate_approval_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RAISE EXCEPTION 'routing candidate approvals are append-only evidence';
END;
$$;

CREATE OR REPLACE FUNCTION validate_routing_candidate_rollback_binding()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'routing_capability_axis' THEN
    IF NOT EXISTS (
      SELECT 1 FROM improvement_candidate_rollback_targets b
      WHERE b.target_candidate_id = (NEW.rollback_target->>'candidateId')::uuid
        AND b.target_version = (NEW.rollback_target->>'version')::integer
        AND b.project_id = NEW.project_id
        AND b.goal_id = NEW.goal_id
        AND b.content_hash = NEW.rollback_target->>'contentHash'
        AND b.kind = 'routing_capability_axis'
        AND b.role_id = NEW.target->>'roleId'
        AND b.task_class = NEW.target->>'taskClass'
    ) THEN
      RAISE EXCEPTION 'routing candidate rollback target must bind kind, role, and task scope';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS routing_candidate_approval_marker_guard ON routing_candidate_approval_mutation_markers;
CREATE TRIGGER routing_candidate_approval_marker_guard BEFORE INSERT OR UPDATE OR DELETE ON routing_candidate_approval_mutation_markers FOR EACH ROW EXECUTE FUNCTION authorize_routing_candidate_approval_marker_mutation();
DROP TRIGGER IF EXISTS routing_candidate_approval_guard ON routing_candidate_approvals;
CREATE TRIGGER routing_candidate_approval_guard BEFORE INSERT ON routing_candidate_approvals FOR EACH ROW EXECUTE FUNCTION authorize_routing_candidate_approval_write();
DROP TRIGGER IF EXISTS routing_candidate_approval_immutable ON routing_candidate_approvals;
CREATE TRIGGER routing_candidate_approval_immutable BEFORE UPDATE OR DELETE ON routing_candidate_approvals FOR EACH ROW EXECUTE FUNCTION reject_routing_candidate_approval_mutation();
DROP TRIGGER IF EXISTS routing_candidate_approval_no_truncate ON routing_candidate_approvals;
CREATE TRIGGER routing_candidate_approval_no_truncate BEFORE TRUNCATE ON routing_candidate_approvals FOR EACH STATEMENT EXECUTE FUNCTION reject_unscoped_truncate();
DROP TRIGGER IF EXISTS improvement_candidate_routing_rollback_binding ON improvement_candidates;
CREATE TRIGGER improvement_candidate_routing_rollback_binding BEFORE INSERT ON improvement_candidates FOR EACH ROW EXECUTE FUNCTION validate_routing_candidate_rollback_binding();

REVOKE EXECUTE ON FUNCTION authorize_routing_candidate_approval_marker_mutation() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION authorize_routing_candidate_approval_write() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reject_routing_candidate_approval_mutation() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION validate_routing_candidate_rollback_binding() FROM PUBLIC;
