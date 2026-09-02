-- Phase 2 work-sequence step 7: Mission bundles (least-privilege capability
-- selection). A Mission Bundle binds one Scout/Execution mission to exactly
-- one active Department Plan item; every capability grant is explicit.
-- Additive only; no existing migration edited.

CREATE TABLE IF NOT EXISTS mission_bundles (
  bundle_id uuid PRIMARY KEY,
  council_id uuid NOT NULL,
  department_id text NOT NULL,
  plan_version integer NOT NULL,
  plan_content_hash char(64) NOT NULL CHECK (plan_content_hash ~ '^[0-9a-f]{64}$'),
  item_id text NOT NULL CHECK (btrim(item_id) <> ''),
  parent_ref text NOT NULL CHECK (btrim(parent_ref) <> ''),
  substance jsonb NOT NULL,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime',
  -- The Department Plan version this bundle derives from must actually be
  -- the plan's current row at bundle-creation time (enforced in the
  -- application transaction); the FK ties the bundle to a real plan.
  FOREIGN KEY (council_id, department_id) REFERENCES department_plans (council_id, department_id),
  UNIQUE (council_id, department_id, plan_version, item_id)
);
CREATE INDEX IF NOT EXISTS mission_bundles_plan_idx ON mission_bundles (council_id, department_id, plan_version);

CREATE OR REPLACE FUNCTION reject_mission_bundle_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Mission bundles are append-only once issued';
END;
$$;
DROP TRIGGER IF EXISTS mission_bundles_append_only ON mission_bundles;
CREATE TRIGGER mission_bundles_append_only
  BEFORE UPDATE OR DELETE ON mission_bundles
  FOR EACH ROW EXECUTE FUNCTION reject_mission_bundle_mutation();
