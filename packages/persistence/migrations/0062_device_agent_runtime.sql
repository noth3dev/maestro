-- Phase 5 Track B1-B2: authenticated device-agent sessions and durable
-- pre-effect command claims. No private keys, capability plaintext, challenge
-- plaintext, or command result bytes are stored here.
CREATE TABLE IF NOT EXISTS device_agent_sessions (
  session_id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES devices(device_id),
  identity_fingerprint char(64) NOT NULL CHECK (identity_fingerprint ~ '^[0-9a-f]{64}$'),
  connected_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  disconnected_at timestamptz,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'disconnected')),
  retention retention_class NOT NULL DEFAULT 'project_lifetime',
  CHECK ((state = 'active' AND disconnected_at IS NULL) OR (state = 'disconnected' AND disconnected_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS device_agent_sessions_device_idx ON device_agent_sessions (device_id, state, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS device_command_claims (
  command_id text PRIMARY KEY CHECK (btrim(command_id) <> ''),
  grant_id uuid NOT NULL REFERENCES device_grants(grant_id),
  session_id uuid NOT NULL REFERENCES device_agent_sessions(session_id),
  goal_id uuid NOT NULL REFERENCES goals(goal_id),
  project_id uuid NOT NULL,
  device_id uuid NOT NULL REFERENCES devices(device_id),
  action text NOT NULL CHECK (btrim(action) <> ''),
  target text NOT NULL CHECK (btrim(target) <> ''),
  application text NOT NULL CHECK (btrim(application) <> ''),
  data_resource text NOT NULL CHECK (btrim(data_resource) <> ''),
  network_target text NOT NULL CHECK (btrim(network_target) <> ''),
  policy_version integer NOT NULL CHECK (policy_version > 0),
  goal_fencing_token bigint NOT NULL CHECK (goal_fencing_token > 0),
  sequence integer NOT NULL CHECK (sequence > 0),
  claimed_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  state text NOT NULL DEFAULT 'claimed' CHECK (state IN ('claimed', 'completed', 'unknown')),
  completed_at timestamptz,
  unknown_at timestamptz,
  recovery_reason text,
  retention retention_class NOT NULL DEFAULT 'project_lifetime',
  UNIQUE (grant_id, sequence),
  CHECK ((state = 'claimed' AND completed_at IS NULL AND unknown_at IS NULL AND recovery_reason IS NULL)
      OR (state = 'completed' AND completed_at IS NOT NULL AND unknown_at IS NULL AND recovery_reason IS NULL)
      OR (state = 'unknown' AND completed_at IS NULL AND unknown_at IS NOT NULL AND btrim(recovery_reason) <> ''))
);
CREATE INDEX IF NOT EXISTS device_command_claims_grant_idx ON device_command_claims (grant_id, sequence);

CREATE OR REPLACE FUNCTION reject_device_session_identity_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.session_id IS DISTINCT FROM OLD.session_id
    OR NEW.device_id IS DISTINCT FROM OLD.device_id
    OR NEW.identity_fingerprint IS DISTINCT FROM OLD.identity_fingerprint
    OR NEW.connected_at IS DISTINCT FROM OLD.connected_at
    OR NEW.retention IS DISTINCT FROM OLD.retention THEN
    RAISE EXCEPTION 'Device agent session identity is immutable';
  END IF;
  IF OLD.state = 'disconnected' AND (NEW.state <> OLD.state OR NEW.disconnected_at IS DISTINCT FROM OLD.disconnected_at OR NEW.retention IS DISTINCT FROM OLD.retention) THEN
    RAISE EXCEPTION 'Device agent session disconnection is final';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS device_agent_sessions_identity_immutable ON device_agent_sessions;
CREATE TRIGGER device_agent_sessions_identity_immutable BEFORE UPDATE ON device_agent_sessions
  FOR EACH ROW EXECUTE FUNCTION reject_device_session_identity_mutation();

CREATE OR REPLACE FUNCTION reject_device_command_claim_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.command_id IS DISTINCT FROM OLD.command_id
    OR NEW.grant_id IS DISTINCT FROM OLD.grant_id
    OR NEW.session_id IS DISTINCT FROM OLD.session_id
    OR NEW.goal_id IS DISTINCT FROM OLD.goal_id
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.device_id IS DISTINCT FROM OLD.device_id
    OR NEW.action IS DISTINCT FROM OLD.action
    OR NEW.target IS DISTINCT FROM OLD.target
    OR NEW.application IS DISTINCT FROM OLD.application
    OR NEW.data_resource IS DISTINCT FROM OLD.data_resource
    OR NEW.network_target IS DISTINCT FROM OLD.network_target
    OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
    OR NEW.goal_fencing_token IS DISTINCT FROM OLD.goal_fencing_token
    OR NEW.sequence IS DISTINCT FROM OLD.sequence
    OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at
    OR NEW.retention IS DISTINCT FROM OLD.retention THEN
    RAISE EXCEPTION 'Device command claim identity is immutable';
  END IF;
  IF OLD.state = 'claimed' AND (NEW.state = 'claimed' OR NEW.state NOT IN ('completed', 'unknown')) THEN
    RAISE EXCEPTION 'Device command claim can only transition to completed or unknown';
  END IF;
  IF OLD.state = 'completed' AND (NEW.state <> OLD.state OR NEW.completed_at IS DISTINCT FROM OLD.completed_at OR NEW.retention IS DISTINCT FROM OLD.retention) THEN
    RAISE EXCEPTION 'Device command claim completion is final';
  END IF;
  IF OLD.state = 'unknown' AND (NEW.state <> OLD.state OR NEW.unknown_at IS DISTINCT FROM OLD.unknown_at OR NEW.recovery_reason IS DISTINCT FROM OLD.recovery_reason OR NEW.retention IS DISTINCT FROM OLD.retention) THEN
    RAISE EXCEPTION 'Unknown device command claim is final';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS device_command_claims_immutable ON device_command_claims;
CREATE TRIGGER device_command_claims_immutable BEFORE UPDATE ON device_command_claims
  FOR EACH ROW EXECUTE FUNCTION reject_device_command_claim_mutation();
CREATE OR REPLACE FUNCTION reject_device_command_claim_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Device command claims are append-only'; END;
$$;
DROP TRIGGER IF EXISTS device_command_claims_append_only ON device_command_claims;
CREATE TRIGGER device_command_claims_append_only BEFORE DELETE ON device_command_claims
  FOR EACH ROW EXECUTE FUNCTION reject_device_command_claim_delete();
