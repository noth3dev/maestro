-- Phase 4 work-sequence step 5: Goal-scoped device grants and a short-lived
-- capability/command-result channel. A grant is bound to exactly one Goal
-- and one already-enrolled device; it never widens beyond its explicit
-- scope, and it is issued only while the Goal lease is held and the Goal's
-- control latch is open. The capability the worker receives is an opaque
-- token whose SHA-256 hash (never the plaintext) lives here, matching
-- plan/phase4.md's "hashes and scope live in PostgreSQL" technical choice.
CREATE TABLE IF NOT EXISTS device_grants (
  grant_id uuid PRIMARY KEY,
  goal_id uuid NOT NULL REFERENCES goals(goal_id),
  device_id uuid NOT NULL REFERENCES devices(device_id),
  action_types jsonb NOT NULL CHECK (jsonb_typeof(action_types) = 'array'),
  project_paths jsonb NOT NULL CHECK (jsonb_typeof(project_paths) = 'array'),
  applications jsonb NOT NULL CHECK (jsonb_typeof(applications) = 'array'),
  data_scope jsonb NOT NULL CHECK (jsonb_typeof(data_scope) = 'array'),
  network_scope jsonb NOT NULL CHECK (jsonb_typeof(network_scope) = 'array'),
  ceo_approved boolean NOT NULL DEFAULT false,
  capability_token_hash char(64) NOT NULL CHECK (capability_token_hash ~ '^[0-9a-f]{64}$'),
  issued_by text NOT NULL CHECK (btrim(issued_by) <> ''),
  issued_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  expires_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('active', 'expired', 'revoked', 'closed')),
  revoked_at timestamptz,
  highest_sequence integer NOT NULL DEFAULT 0 CHECK (highest_sequence >= 0),
  retention retention_class NOT NULL DEFAULT 'project_lifetime',
  UNIQUE (capability_token_hash),
  CHECK ((state = 'revoked') = (revoked_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS device_grants_goal_idx ON device_grants (goal_id, state);
CREATE INDEX IF NOT EXISTS device_grants_device_idx ON device_grants (device_id, state);

CREATE OR REPLACE FUNCTION reject_device_grant_identity_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.grant_id IS DISTINCT FROM OLD.grant_id
    OR NEW.goal_id IS DISTINCT FROM OLD.goal_id
    OR NEW.device_id IS DISTINCT FROM OLD.device_id
    OR NEW.action_types IS DISTINCT FROM OLD.action_types
    OR NEW.project_paths IS DISTINCT FROM OLD.project_paths
    OR NEW.applications IS DISTINCT FROM OLD.applications
    OR NEW.data_scope IS DISTINCT FROM OLD.data_scope
    OR NEW.network_scope IS DISTINCT FROM OLD.network_scope
    OR NEW.ceo_approved IS DISTINCT FROM OLD.ceo_approved
    OR NEW.capability_token_hash IS DISTINCT FROM OLD.capability_token_hash
    OR NEW.issued_by IS DISTINCT FROM OLD.issued_by
    OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'Device grant scope and identity are immutable';
  END IF;
  IF OLD.state IN ('revoked', 'closed') AND NEW.state <> OLD.state THEN
    RAISE EXCEPTION 'Device grant revocation and closure are final';
  END IF;
  IF NEW.highest_sequence < OLD.highest_sequence THEN
    RAISE EXCEPTION 'Device grant fencing sequence cannot move backward';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS device_grants_identity_immutable ON device_grants;
CREATE TRIGGER device_grants_identity_immutable BEFORE UPDATE ON device_grants
  FOR EACH ROW EXECUTE FUNCTION reject_device_grant_identity_mutation();

CREATE OR REPLACE FUNCTION reject_device_grant_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Device grants are append-only';
END;
$$;
DROP TRIGGER IF EXISTS device_grants_append_only ON device_grants;
CREATE TRIGGER device_grants_append_only BEFORE DELETE ON device_grants
  FOR EACH ROW EXECUTE FUNCTION reject_device_grant_deletion();

-- One durable, sequenced, bounded-summary result per executed command. The
-- (grant_id, sequence) fencing pair rejects a result that arrives after a
-- successor has already used a later sequence for the same grant.
CREATE TABLE IF NOT EXISTS device_command_results (
  result_id uuid PRIMARY KEY,
  grant_id uuid NOT NULL REFERENCES device_grants(grant_id),
  command_id text NOT NULL CHECK (btrim(command_id) <> ''),
  action text NOT NULL CHECK (btrim(action) <> ''),
  target text NOT NULL CHECK (btrim(target) <> ''),
  sequence integer NOT NULL CHECK (sequence > 0),
  result_summary text NOT NULL,
  executed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime',
  UNIQUE (grant_id, sequence),
  UNIQUE (grant_id, command_id)
);
CREATE INDEX IF NOT EXISTS device_command_results_grant_idx ON device_command_results (grant_id, sequence);

CREATE OR REPLACE FUNCTION reject_device_command_result_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Device command results are append-only';
END;
$$;
DROP TRIGGER IF EXISTS device_command_results_immutable_update ON device_command_results;
DROP TRIGGER IF EXISTS device_command_results_immutable_delete ON device_command_results;
CREATE TRIGGER device_command_results_immutable_update BEFORE UPDATE ON device_command_results
  FOR EACH ROW EXECUTE FUNCTION reject_device_command_result_mutation();
CREATE TRIGGER device_command_results_immutable_delete BEFORE DELETE ON device_command_results
  FOR EACH ROW EXECUTE FUNCTION reject_device_command_result_mutation();
