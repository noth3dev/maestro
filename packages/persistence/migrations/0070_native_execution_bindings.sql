-- Durable, identity-only evidence for native Model Gateway admissions.
-- Provider credentials, prompts, tool results, and OAuth material never enter this table.
CREATE TABLE IF NOT EXISTS native_execution_bindings (
  binding_id uuid PRIMARY KEY,
  execution_ref text NOT NULL CHECK (btrim(execution_ref) <> '' AND length(execution_ref) <= 512),
  invocation_ref text NOT NULL CHECK (btrim(invocation_ref) <> '' AND length(invocation_ref) <= 512),
  worker_id uuid REFERENCES workers(worker_id),
  goal_id uuid NOT NULL REFERENCES goals(goal_id),
  project_id uuid NOT NULL,
  admission_kind text NOT NULL CHECK (admission_kind IN ('conversation', 'worker', 'head', 'semantic_review', 'encore_reviewer', 'team_lead_helper')),
  operator_id text NOT NULL CHECK (btrim(operator_id) <> '' AND length(operator_id) <= 256),
  mission_bundle_id text NOT NULL CHECK (btrim(mission_bundle_id) <> '' AND length(mission_bundle_id) <= 256),
  policy_version text NOT NULL CHECK (btrim(policy_version) <> '' AND length(policy_version) <= 256),
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> '' AND length(idempotency_key) <= 512),
  fencing_token bigint CHECK (fencing_token IS NULL OR fencing_token > 0),
  selected_model_provider text NOT NULL CHECK (btrim(selected_model_provider) <> '' AND length(selected_model_provider) <= 64),
  selected_model_id text NOT NULL CHECK (btrim(selected_model_id) <> '' AND length(selected_model_id) <= 256),
  actual_model_provider text NOT NULL CHECK (btrim(actual_model_provider) <> '' AND length(actual_model_provider) <= 64),
  actual_model_id text NOT NULL CHECK (btrim(actual_model_id) <> '' AND length(actual_model_id) <= 256),
  account_ref text CHECK (account_ref IS NULL OR (btrim(account_ref) <> '' AND length(account_ref) <= 256)),
  gateway_instance_id text CHECK (gateway_instance_id IS NULL OR (btrim(gateway_instance_id) <> '' AND length(gateway_instance_id) <= 256)),
  gateway_binding_id text CHECK (gateway_binding_id IS NULL OR (btrim(gateway_binding_id) <> '' AND length(gateway_binding_id) <= 256)),
  data_policy_hash text CHECK (data_policy_hash IS NULL OR (btrim(data_policy_hash) <> '' AND length(data_policy_hash) <= 256)),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (execution_ref),
  UNIQUE (invocation_ref),
  UNIQUE (admission_kind, idempotency_key),
  CHECK ((selected_model_provider = actual_model_provider) AND (selected_model_id = actual_model_id))
);
CREATE INDEX IF NOT EXISTS native_execution_bindings_goal_idx ON native_execution_bindings (project_id, goal_id, created_at);
CREATE INDEX IF NOT EXISTS native_execution_bindings_worker_idx ON native_execution_bindings (worker_id, created_at);

CREATE OR REPLACE FUNCTION validate_native_execution_binding_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM goals WHERE goal_id = NEW.goal_id AND project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'Native execution binding Goal/project binding is invalid';
  END IF;
  IF NEW.worker_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM workers w JOIN head_councils hc ON hc.council_id = w.council_id
    WHERE w.worker_id = NEW.worker_id AND hc.goal_id = NEW.goal_id
  ) THEN
    RAISE EXCEPTION 'Native execution binding worker/Goal binding is invalid';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS native_execution_bindings_scope ON native_execution_bindings;
CREATE TRIGGER native_execution_bindings_scope BEFORE INSERT ON native_execution_bindings
  FOR EACH ROW EXECUTE FUNCTION validate_native_execution_binding_scope();

CREATE OR REPLACE FUNCTION reject_native_execution_binding_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Native execution bindings are append-only';
END;
$$;
DROP TRIGGER IF EXISTS native_execution_bindings_immutable ON native_execution_bindings;
CREATE TRIGGER native_execution_bindings_immutable BEFORE UPDATE OR DELETE ON native_execution_bindings
  FOR EACH ROW EXECUTE FUNCTION reject_native_execution_binding_mutation();
