-- Plan 6 S10: persist replay/synthetic evaluation evidence before Council judgement.
-- Judged transitions consume these records instead of trusting a request payload.

CREATE TABLE IF NOT EXISTS routing_candidate_evaluations (
  evaluation_id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES improvement_candidates(candidate_id) ON DELETE RESTRICT,
  candidate_version integer NOT NULL CHECK (candidate_version >= 1),
  candidate_content_hash char(64) NOT NULL CHECK (candidate_content_hash ~ '^[0-9a-f]{64}$'),
  project_id uuid NOT NULL,
  goal_id uuid NOT NULL REFERENCES goals(goal_id),
  scenario_suite_hash char(64) NOT NULL CHECK (scenario_suite_hash ~ '^[0-9a-f]{64}$'),
  evaluation_hash char(64) NOT NULL CHECK (evaluation_hash ~ '^[0-9a-f]{64}$'),
  replay_payload jsonb NOT NULL CHECK (jsonb_typeof(replay_payload) = 'object' AND replay_payload->>'status' = 'compared'),
  synthetic_payload jsonb NOT NULL CHECK (jsonb_typeof(synthetic_payload) = 'object' AND synthetic_payload->>'status' = 'completed'),
  operation_ref text NOT NULL UNIQUE CHECK (btrim(operation_ref) <> '' AND length(operation_ref) <= 256 AND operation_ref !~ E'[\r\n]'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime' CHECK (retention = 'project_lifetime'),
  UNIQUE (candidate_id, candidate_version, candidate_content_hash)
);
CREATE INDEX IF NOT EXISTS routing_candidate_evaluations_scope_idx ON routing_candidate_evaluations (project_id, goal_id, created_at);
REVOKE ALL ON routing_candidate_evaluations FROM PUBLIC;

ALTER TABLE routing_candidate_approvals
  ADD COLUMN IF NOT EXISTS evaluation_id uuid REFERENCES routing_candidate_evaluations(evaluation_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS council_judgment_payload jsonb;

CREATE TABLE IF NOT EXISTS routing_candidate_evaluation_mutation_markers (
  transaction_id bigint PRIMARY KEY,
  token_hash char(64) NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$')
);
REVOKE ALL ON routing_candidate_evaluation_mutation_markers FROM PUBLIC;

DO $$
DECLARE schema_name text := quote_ident(current_schema());
BEGIN
  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION %1$s.authorize_routing_candidate_evaluation_marker_mutation()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, %1$s AS $body$
    BEGIN
      IF TG_OP = 'INSERT' AND NEW.transaction_id = txid_current()
         AND NEW.token_hash = encode(public.digest(NULLIF(current_setting('maestro.routing_candidate_evaluation_token', true), ''), 'sha256'), 'hex') THEN RETURN NEW; END IF;
      IF TG_OP = 'DELETE' AND OLD.transaction_id = txid_current()
         AND OLD.token_hash = encode(public.digest(NULLIF(current_setting('maestro.routing_candidate_evaluation_token', true), ''), 'sha256'), 'hex') THEN RETURN OLD; END IF;
      RAISE EXCEPTION 'routing candidate evaluation markers are secured and one-use';
    END;
    $body$;
  $fn$, schema_name);

  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION %1$s.authorize_routing_candidate_evaluation_write()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, %1$s AS $body$
    DECLARE token_hash_value char(64);
    BEGIN
      token_hash_value := encode(public.digest(NULLIF(current_setting('maestro.routing_candidate_evaluation_token', true), ''), 'sha256'), 'hex');
      IF NOT EXISTS (SELECT 1 FROM %1$s.routing_candidate_evaluation_mutation_markers WHERE transaction_id = txid_current() AND token_hash = token_hash_value) THEN
        RAISE EXCEPTION 'routing candidate evaluation write is not bound to secured authorization';
      END IF;
      DELETE FROM %1$s.routing_candidate_evaluation_mutation_markers WHERE transaction_id = txid_current() AND token_hash = token_hash_value;
      RETURN NEW;
    END;
    $body$;
  $fn$, schema_name);

  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION %1$s.reject_routing_candidate_evaluation_mutation()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, %1$s AS $body$
    BEGIN
      RAISE EXCEPTION 'routing candidate evaluations are append-only evidence';
    END;
    $body$;
  $fn$, schema_name);
END $$;

DROP TRIGGER IF EXISTS routing_candidate_evaluation_marker_guard ON routing_candidate_evaluation_mutation_markers;
CREATE TRIGGER routing_candidate_evaluation_marker_guard BEFORE INSERT OR UPDATE OR DELETE ON routing_candidate_evaluation_mutation_markers FOR EACH ROW EXECUTE FUNCTION authorize_routing_candidate_evaluation_marker_mutation();
DROP TRIGGER IF EXISTS routing_candidate_evaluation_guard ON routing_candidate_evaluations;
CREATE TRIGGER routing_candidate_evaluation_guard BEFORE INSERT ON routing_candidate_evaluations FOR EACH ROW EXECUTE FUNCTION authorize_routing_candidate_evaluation_write();
DROP TRIGGER IF EXISTS routing_candidate_evaluation_immutable ON routing_candidate_evaluations;
CREATE TRIGGER routing_candidate_evaluation_immutable BEFORE UPDATE OR DELETE ON routing_candidate_evaluations FOR EACH ROW EXECUTE FUNCTION reject_routing_candidate_evaluation_mutation();
DROP TRIGGER IF EXISTS routing_candidate_evaluation_no_truncate ON routing_candidate_evaluations;
CREATE TRIGGER routing_candidate_evaluation_no_truncate BEFORE TRUNCATE ON routing_candidate_evaluations FOR EACH STATEMENT EXECUTE FUNCTION reject_unscoped_truncate();

REVOKE EXECUTE ON FUNCTION authorize_routing_candidate_evaluation_marker_mutation() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION authorize_routing_candidate_evaluation_write() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reject_routing_candidate_evaluation_mutation() FROM PUBLIC;
