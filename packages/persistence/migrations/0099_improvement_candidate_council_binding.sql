-- Plan 6 S11: generic persona evaluation and Council approval binding.
-- Routing candidates retain the stricter S10 approval table; this table closes
-- the corresponding lifecycle gap for persona candidates.

CREATE TABLE IF NOT EXISTS improvement_candidate_evaluations (
  evaluation_id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES improvement_candidates(candidate_id) ON DELETE RESTRICT,
  candidate_version integer NOT NULL CHECK (candidate_version >= 1),
  candidate_content_hash char(64) NOT NULL CHECK (candidate_content_hash ~ '^[0-9a-f]{64}$'),
  project_id uuid NOT NULL,
  goal_id uuid NOT NULL REFERENCES goals(goal_id),
  evaluation_hash char(64) NOT NULL CHECK (evaluation_hash ~ '^[0-9a-f]{64}$'),
  evidence_ids jsonb NOT NULL CHECK (jsonb_typeof(evidence_ids) = 'array' AND jsonb_array_length(evidence_ids) BETWEEN 1 AND 32),
  evaluation_payload jsonb NOT NULL CHECK (jsonb_typeof(evaluation_payload) = 'object'),
  operation_ref text NOT NULL UNIQUE CHECK (btrim(operation_ref) <> '' AND length(operation_ref) <= 256 AND operation_ref !~ E'[\r\n]'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime' CHECK (retention = 'project_lifetime'),
  UNIQUE (candidate_id, candidate_version, candidate_content_hash)
);
CREATE INDEX IF NOT EXISTS improvement_candidate_evaluations_scope_idx ON improvement_candidate_evaluations (project_id, goal_id, created_at);
REVOKE ALL ON improvement_candidate_evaluations FROM PUBLIC;

CREATE TABLE IF NOT EXISTS improvement_candidate_council_approvals (
  approval_id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES improvement_candidates(candidate_id) ON DELETE RESTRICT,
  candidate_version integer NOT NULL CHECK (candidate_version >= 1),
  candidate_content_hash char(64) NOT NULL CHECK (candidate_content_hash ~ '^[0-9a-f]{64}$'),
  project_id uuid NOT NULL,
  goal_id uuid NOT NULL REFERENCES goals(goal_id),
  evaluation_id uuid NOT NULL REFERENCES improvement_candidate_evaluations(evaluation_id) ON DELETE RESTRICT,
  evaluation_hash char(64) NOT NULL CHECK (evaluation_hash ~ '^[0-9a-f]{64}$'),
  council_round_id uuid NOT NULL REFERENCES encore_council_rounds(round_id) ON DELETE RESTRICT,
  council_evidence_ids jsonb NOT NULL CHECK (jsonb_typeof(council_evidence_ids) = 'array' AND jsonb_array_length(council_evidence_ids) BETWEEN 1 AND 32),
  source_evidence_ids jsonb NOT NULL CHECK (jsonb_typeof(source_evidence_ids) = 'array' AND jsonb_array_length(source_evidence_ids) BETWEEN 1 AND 32),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime' CHECK (retention = 'project_lifetime'),
  UNIQUE (candidate_id, candidate_version, candidate_content_hash)
);
CREATE INDEX IF NOT EXISTS improvement_candidate_council_approvals_scope_idx ON improvement_candidate_council_approvals (project_id, goal_id, created_at);
REVOKE ALL ON improvement_candidate_council_approvals FROM PUBLIC;

CREATE TABLE IF NOT EXISTS improvement_candidate_evaluation_mutation_markers (
  transaction_id bigint PRIMARY KEY,
  token_hash char(64) NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$')
);
CREATE TABLE IF NOT EXISTS improvement_candidate_council_approval_mutation_markers (
  transaction_id bigint PRIMARY KEY,
  token_hash char(64) NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$')
);
REVOKE ALL ON improvement_candidate_evaluation_mutation_markers FROM PUBLIC;
REVOKE ALL ON improvement_candidate_council_approval_mutation_markers FROM PUBLIC;

DO $$
DECLARE schema_name text := quote_ident(current_schema());
BEGIN
  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION %1$s.authorize_improvement_candidate_evaluation_marker_mutation()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, %1$s AS $body$
    BEGIN
      IF TG_OP = 'INSERT' AND NEW.transaction_id = txid_current()
         AND NEW.token_hash = encode(public.digest(NULLIF(current_setting('maestro.improvement_candidate_evaluation_token', true), ''), 'sha256'), 'hex') THEN RETURN NEW; END IF;
      IF TG_OP = 'DELETE' AND OLD.transaction_id = txid_current()
         AND OLD.token_hash = encode(public.digest(NULLIF(current_setting('maestro.improvement_candidate_evaluation_token', true), ''), 'sha256'), 'hex') THEN RETURN OLD; END IF;
      RAISE EXCEPTION 'improvement candidate evaluation markers are secured and one-use';
    END;
    $body$;
  $fn$, schema_name);
  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION %1$s.authorize_improvement_candidate_evaluation_write()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, %1$s AS $body$
    DECLARE token_hash_value char(64);
    BEGIN
      token_hash_value := encode(public.digest(NULLIF(current_setting('maestro.improvement_candidate_evaluation_token', true), ''), 'sha256'), 'hex');
      IF NOT EXISTS (SELECT 1 FROM %1$s.improvement_candidate_evaluation_mutation_markers WHERE transaction_id = txid_current() AND token_hash = token_hash_value) THEN
        RAISE EXCEPTION 'improvement candidate evaluation write is not bound to secured authorization';
      END IF;
      DELETE FROM %1$s.improvement_candidate_evaluation_mutation_markers WHERE transaction_id = txid_current() AND token_hash = token_hash_value;
      RETURN NEW;
    END;
    $body$;
  $fn$, schema_name);
  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION %1$s.authorize_improvement_candidate_council_approval_marker_mutation()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, %1$s AS $body$
    BEGIN
      IF TG_OP = 'INSERT' AND NEW.transaction_id = txid_current()
         AND NEW.token_hash = encode(public.digest(NULLIF(current_setting('maestro.improvement_candidate_council_approval_token', true), ''), 'sha256'), 'hex') THEN RETURN NEW; END IF;
      IF TG_OP = 'DELETE' AND OLD.transaction_id = txid_current()
         AND OLD.token_hash = encode(public.digest(NULLIF(current_setting('maestro.improvement_candidate_council_approval_token', true), ''), 'sha256'), 'hex') THEN RETURN OLD; END IF;
      RAISE EXCEPTION 'improvement candidate Council approval markers are secured and one-use';
    END;
    $body$;
  $fn$, schema_name);
  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION %1$s.authorize_improvement_candidate_council_approval_write()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, %1$s AS $body$
    DECLARE token_hash_value char(64);
    BEGIN
      token_hash_value := encode(public.digest(NULLIF(current_setting('maestro.improvement_candidate_council_approval_token', true), ''), 'sha256'), 'hex');
      IF NOT EXISTS (SELECT 1 FROM %1$s.improvement_candidate_council_approval_mutation_markers WHERE transaction_id = txid_current() AND token_hash = token_hash_value) THEN
        RAISE EXCEPTION 'improvement candidate Council approval write is not bound to secured authorization';
      END IF;
      DELETE FROM %1$s.improvement_candidate_council_approval_mutation_markers WHERE transaction_id = txid_current() AND token_hash = token_hash_value;
      RETURN NEW;
    END;
    $body$;
  $fn$, schema_name);
END $$;

DROP TRIGGER IF EXISTS improvement_candidate_evaluation_marker_guard ON improvement_candidate_evaluation_mutation_markers;
CREATE TRIGGER improvement_candidate_evaluation_marker_guard BEFORE INSERT OR UPDATE OR DELETE ON improvement_candidate_evaluation_mutation_markers FOR EACH ROW EXECUTE FUNCTION authorize_improvement_candidate_evaluation_marker_mutation();
DROP TRIGGER IF EXISTS improvement_candidate_evaluation_guard ON improvement_candidate_evaluations;
CREATE TRIGGER improvement_candidate_evaluation_guard BEFORE INSERT ON improvement_candidate_evaluations FOR EACH ROW EXECUTE FUNCTION authorize_improvement_candidate_evaluation_write();
DROP TRIGGER IF EXISTS improvement_candidate_evaluation_immutable ON improvement_candidate_evaluations;
CREATE TRIGGER improvement_candidate_evaluation_immutable BEFORE UPDATE OR DELETE ON improvement_candidate_evaluations FOR EACH ROW EXECUTE FUNCTION reject_improvement_digest_mutation();
DROP TRIGGER IF EXISTS improvement_candidate_evaluation_no_truncate ON improvement_candidate_evaluations;
CREATE TRIGGER improvement_candidate_evaluation_no_truncate BEFORE TRUNCATE ON improvement_candidate_evaluations FOR EACH STATEMENT EXECUTE FUNCTION reject_unscoped_truncate();

DROP TRIGGER IF EXISTS improvement_candidate_council_approval_marker_guard ON improvement_candidate_council_approval_mutation_markers;
CREATE TRIGGER improvement_candidate_council_approval_marker_guard BEFORE INSERT OR UPDATE OR DELETE ON improvement_candidate_council_approval_mutation_markers FOR EACH ROW EXECUTE FUNCTION authorize_improvement_candidate_council_approval_marker_mutation();
DROP TRIGGER IF EXISTS improvement_candidate_council_approval_guard ON improvement_candidate_council_approvals;
CREATE TRIGGER improvement_candidate_council_approval_guard BEFORE INSERT ON improvement_candidate_council_approvals FOR EACH ROW EXECUTE FUNCTION authorize_improvement_candidate_council_approval_write();
DROP TRIGGER IF EXISTS improvement_candidate_council_approval_immutable ON improvement_candidate_council_approvals;
CREATE TRIGGER improvement_candidate_council_approval_immutable BEFORE UPDATE OR DELETE ON improvement_candidate_council_approvals FOR EACH ROW EXECUTE FUNCTION reject_improvement_digest_mutation();
DROP TRIGGER IF EXISTS improvement_candidate_council_approval_no_truncate ON improvement_candidate_council_approvals;
CREATE TRIGGER improvement_candidate_council_approval_no_truncate BEFORE TRUNCATE ON improvement_candidate_council_approvals FOR EACH STATEMENT EXECUTE FUNCTION reject_unscoped_truncate();

REVOKE EXECUTE ON FUNCTION authorize_improvement_candidate_evaluation_marker_mutation() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION authorize_improvement_candidate_evaluation_write() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION authorize_improvement_candidate_council_approval_marker_mutation() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION authorize_improvement_candidate_council_approval_write() FROM PUBLIC;
