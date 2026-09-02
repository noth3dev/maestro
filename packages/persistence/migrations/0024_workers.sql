-- Phase 2 work-sequence step 8: Scout/Execution worker lifecycle through
-- Prime Agent's native hierarchy. A Worker binds one spawn attempt of a
-- Mission Bundle to an opaque execution-kernel invocation; no provider
-- identifier or type crosses this boundary (packages/prime-adapter already
-- enforces that at the SDK edge). Additive only.

CREATE TABLE IF NOT EXISTS workers (
  worker_id uuid PRIMARY KEY,
  council_id uuid NOT NULL,
  department_id text NOT NULL,
  plan_version integer NOT NULL,
  item_id text NOT NULL,
  bundle_content_hash char(64) NOT NULL CHECK (bundle_content_hash ~ '^[0-9a-f]{64}$'),
  attempt integer NOT NULL CHECK (attempt > 0),
  execution_ref text NOT NULL CHECK (btrim(execution_ref) <> ''),
  invocation_ref text NOT NULL CHECK (btrim(invocation_ref) <> ''),
  status text NOT NULL CHECK (status IN ('spawned', 'running', 'succeeded', 'failed', 'cancelled', 'unknown')),
  answer_text text,
  usage_total_tokens integer CHECK (usage_total_tokens IS NULL OR usage_total_tokens >= 0),
  spawned_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  observed_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime',
  FOREIGN KEY (council_id, department_id, plan_version, item_id) REFERENCES mission_bundles (council_id, department_id, plan_version, item_id),
  UNIQUE (council_id, department_id, plan_version, item_id, attempt)
);
CREATE INDEX IF NOT EXISTS workers_bundle_idx ON workers (council_id, department_id, plan_version, item_id);

-- A worker's status only ever advances toward a terminal outcome; once
-- terminal it is immutable (the application layer also enforces this, but
-- the database must not silently accept a direct contradiction).
CREATE OR REPLACE FUNCTION reject_worker_terminal_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('succeeded', 'failed', 'cancelled') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Worker status is immutable once terminal';
  END IF;
  IF NEW.council_id IS DISTINCT FROM OLD.council_id
     OR NEW.department_id IS DISTINCT FROM OLD.department_id
     OR NEW.plan_version IS DISTINCT FROM OLD.plan_version
     OR NEW.item_id IS DISTINCT FROM OLD.item_id
     OR NEW.bundle_content_hash IS DISTINCT FROM OLD.bundle_content_hash
     OR NEW.attempt IS DISTINCT FROM OLD.attempt
     OR NEW.execution_ref IS DISTINCT FROM OLD.execution_ref
     OR NEW.invocation_ref IS DISTINCT FROM OLD.invocation_ref
     OR NEW.spawned_at IS DISTINCT FROM OLD.spawned_at THEN
    RAISE EXCEPTION 'Worker identity/binding is immutable';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS workers_binding_immutable ON workers;
CREATE TRIGGER workers_binding_immutable
  BEFORE UPDATE ON workers
  FOR EACH ROW EXECUTE FUNCTION reject_worker_terminal_mutation();
