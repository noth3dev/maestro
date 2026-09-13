-- Plan 6 S6: explicit improvement-class enablement and bounded rollout history.
CREATE TABLE IF NOT EXISTS improvement_class_enablements (
  project_id uuid NOT NULL,
  improvement_class text NOT NULL CHECK (improvement_class IN ('persona_axis', 'routing_capability_axis')),
  operator_id uuid NOT NULL,
  operator_role_id text NOT NULL CHECK (btrim(operator_role_id) <> '' AND length(operator_role_id) <= 256 AND operator_role_id !~ E'[\r\n]'),
  session_ref text NOT NULL CHECK (btrim(session_ref) <> '' AND length(session_ref) <= 256 AND session_ref !~ E'[\r\n]'),
  operation_ref text NOT NULL UNIQUE CHECK (btrim(operation_ref) <> '' AND length(operation_ref) <= 256 AND operation_ref !~ E'[\r\n]'),
  enabled boolean NOT NULL DEFAULT true CHECK (enabled = true),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (project_id, improvement_class)
);
REVOKE ALL ON improvement_class_enablements FROM PUBLIC;

CREATE TABLE IF NOT EXISTS improvement_rollouts (
  rollout_id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES improvement_candidates(candidate_id),
  candidate_version integer NOT NULL CHECK (candidate_version >= 1),
  project_id uuid NOT NULL,
  goal_id uuid NOT NULL REFERENCES goals(goal_id),
  improvement_class text NOT NULL CHECK (improvement_class IN ('persona_axis', 'routing_capability_axis')),
  role_id text NOT NULL CHECK (btrim(role_id) <> '' AND length(role_id) <= 256 AND role_id !~ E'[\r\n]'),
  task_class text NOT NULL CHECK (btrim(task_class) <> '' AND length(task_class) <= 256 AND task_class !~ E'[\r\n]'),
  max_goal_count integer NOT NULL CHECK (max_goal_count BETWEEN 1 AND 1000),
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  protected_metrics jsonb NOT NULL CHECK (jsonb_typeof(protected_metrics) = 'array' AND jsonb_array_length(protected_metrics) BETWEEN 1 AND 16),
  rollback_target jsonb NOT NULL CHECK (jsonb_typeof(rollback_target) = 'object'),
  source_evidence_ids jsonb NOT NULL CHECK (jsonb_typeof(source_evidence_ids) = 'array' AND jsonb_array_length(source_evidence_ids) BETWEEN 1 AND 32),
  active_candidate_id uuid NOT NULL,
  active_version integer NOT NULL CHECK (active_version >= 1),
  last_certified_candidate_id uuid NOT NULL,
  last_certified_version integer NOT NULL CHECK (last_certified_version >= 1),
  observed_goal_count integer NOT NULL DEFAULT 0 CHECK (observed_goal_count >= 0 AND observed_goal_count <= max_goal_count),
  status text NOT NULL CHECK (status IN ('active', 'interrupted', 'certified', 'rolled_back')),
  operation_ref text NOT NULL UNIQUE CHECK (btrim(operation_ref) <> '' AND length(operation_ref) <= 256 AND operation_ref !~ E'[\r\n]'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CHECK (window_end > window_start),
  CHECK (active_candidate_id IS NOT NULL AND last_certified_candidate_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS improvement_rollouts_scope_idx ON improvement_rollouts (project_id, goal_id, status, created_at, rollout_id);
REVOKE ALL ON improvement_rollouts FROM PUBLIC;

CREATE TABLE IF NOT EXISTS improvement_rollout_events (
  event_id uuid PRIMARY KEY,
  rollout_id uuid NOT NULL REFERENCES improvement_rollouts(rollout_id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('started', 'observation', 'automatic_rollback', 'interrupted', 'reconciled')),
  details jsonb NOT NULL CHECK (jsonb_typeof(details) = 'object'),
  operation_ref text NOT NULL UNIQUE CHECK (btrim(operation_ref) <> '' AND length(operation_ref) <= 256 AND operation_ref !~ E'[\r\n]'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
CREATE INDEX IF NOT EXISTS improvement_rollout_events_rollout_idx ON improvement_rollout_events (rollout_id, created_at, event_id);
REVOKE ALL ON improvement_rollout_events FROM PUBLIC;

CREATE TABLE IF NOT EXISTS improvement_rollout_mutation_markers (
  transaction_id bigint PRIMARY KEY,
  token_hash char(64) NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$')
);
REVOKE ALL ON improvement_rollout_mutation_markers FROM PUBLIC;

DO $$
DECLARE schema_name text := quote_ident(current_schema());
BEGIN
  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION %1$s.authorize_improvement_rollout_marker_mutation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, %1$s
    AS $body$
    BEGIN
      IF TG_OP = 'INSERT' AND NEW.transaction_id = txid_current()
         AND NEW.token_hash = encode(public.digest(NULLIF(current_setting('maestro.improvement_rollout_token', true), ''), 'sha256'), 'hex') THEN RETURN NEW; END IF;
      IF TG_OP = 'DELETE' AND OLD.transaction_id = txid_current()
         AND OLD.token_hash = encode(public.digest(NULLIF(current_setting('maestro.improvement_rollout_token', true), ''), 'sha256'), 'hex') THEN RETURN OLD; END IF;
      RAISE EXCEPTION 'rollout mutation markers are secured and one-use';
    END;
    $body$;
  $fn$, schema_name);

  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION %1$s.authorize_improvement_rollout_write() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, %1$s
    AS $body$
    DECLARE token_hash_value char(64);
    BEGIN
      token_hash_value := encode(public.digest(NULLIF(current_setting('maestro.improvement_rollout_token', true), ''), 'sha256'), 'hex');
      IF NOT EXISTS (SELECT 1 FROM %1$s.improvement_rollout_mutation_markers WHERE transaction_id = txid_current() AND token_hash = token_hash_value) THEN
        RAISE EXCEPTION 'rollout write is not bound to secured authorization';
      END IF;
      DELETE FROM %1$s.improvement_rollout_mutation_markers WHERE transaction_id = txid_current() AND token_hash = token_hash_value;
      RETURN COALESCE(NEW, OLD);
    END;
    $body$;
  $fn$, schema_name);

  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION %1$s.reject_improvement_rollout_delete() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, %1$s
    AS $body$
    BEGIN RAISE EXCEPTION 'rollout records are append-only history'; END;
    $body$;
  $fn$, schema_name);
END $$;

DROP TRIGGER IF EXISTS improvement_rollout_enablement_guard ON improvement_class_enablements;
CREATE TRIGGER improvement_rollout_enablement_guard BEFORE INSERT OR UPDATE OR DELETE ON improvement_class_enablements FOR EACH ROW EXECUTE FUNCTION authorize_improvement_rollout_write();
DROP TRIGGER IF EXISTS improvement_rollout_guard ON improvement_rollouts;
CREATE TRIGGER improvement_rollout_guard BEFORE INSERT OR UPDATE ON improvement_rollouts FOR EACH ROW EXECUTE FUNCTION authorize_improvement_rollout_write();
DROP TRIGGER IF EXISTS improvement_rollout_delete_guard ON improvement_rollouts;
CREATE TRIGGER improvement_rollout_delete_guard BEFORE DELETE ON improvement_rollouts FOR EACH ROW EXECUTE FUNCTION reject_improvement_rollout_delete();
DROP TRIGGER IF EXISTS improvement_rollout_truncate_guard ON improvement_rollouts;
CREATE TRIGGER improvement_rollout_truncate_guard BEFORE TRUNCATE ON improvement_rollouts FOR EACH STATEMENT EXECUTE FUNCTION reject_unscoped_truncate();
DROP TRIGGER IF EXISTS improvement_rollout_event_guard ON improvement_rollout_events;
CREATE TRIGGER improvement_rollout_event_guard BEFORE INSERT ON improvement_rollout_events FOR EACH ROW EXECUTE FUNCTION authorize_improvement_rollout_write();
DROP TRIGGER IF EXISTS improvement_rollout_event_delete_guard ON improvement_rollout_events;
CREATE TRIGGER improvement_rollout_event_delete_guard BEFORE UPDATE OR DELETE ON improvement_rollout_events FOR EACH ROW EXECUTE FUNCTION reject_improvement_rollout_delete();
DROP TRIGGER IF EXISTS improvement_rollout_event_truncate_guard ON improvement_rollout_events;
CREATE TRIGGER improvement_rollout_event_truncate_guard BEFORE TRUNCATE ON improvement_rollout_events FOR EACH STATEMENT EXECUTE FUNCTION reject_unscoped_truncate();
DROP TRIGGER IF EXISTS improvement_rollout_marker_guard ON improvement_rollout_mutation_markers;
CREATE TRIGGER improvement_rollout_marker_guard BEFORE INSERT OR UPDATE OR DELETE ON improvement_rollout_mutation_markers FOR EACH ROW EXECUTE FUNCTION authorize_improvement_rollout_marker_mutation();
DROP TRIGGER IF EXISTS improvement_rollout_enablement_truncate_guard ON improvement_class_enablements;
CREATE TRIGGER improvement_rollout_enablement_truncate_guard BEFORE TRUNCATE ON improvement_class_enablements FOR EACH STATEMENT EXECUTE FUNCTION reject_unscoped_truncate();

REVOKE EXECUTE ON FUNCTION authorize_improvement_rollout_marker_mutation() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION authorize_improvement_rollout_write() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reject_improvement_rollout_delete() FROM PUBLIC;
