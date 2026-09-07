CREATE TABLE IF NOT EXISTS provider_account_login_sessions (
  login_id uuid PRIMARY KEY,
  request_id text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 256),
  operator_id text NOT NULL CHECK (length(operator_id) BETWEEN 1 AND 256),
  owner_id text NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 256),
  provider_id text NOT NULL CHECK (provider_id = 'openai-codex'),
  provider_login_id text CHECK (provider_login_id IS NULL OR length(provider_login_id) BETWEEN 1 AND 256),
  auth_url text CHECK (auth_url IS NULL OR auth_url ~ '^https://(chatgpt\.com|auth\.openai\.com)(/|$)'),
  state text NOT NULL CHECK (state IN ('starting', 'pending', 'succeeded', 'failed', 'cancelled', 'unknown')),
  message text CHECK (message IS NULL OR length(message) BETWEEN 1 AND 512),
  operation text CHECK (operation IS NULL OR operation IN ('status', 'cancel')),
  operation_owner text CHECK (operation_owner IS NULL OR length(operation_owner) BETWEEN 1 AND 256),
  operation_token uuid,
  operation_started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CHECK ((state IN ('starting', 'failed', 'unknown') AND provider_login_id IS NULL AND auth_url IS NULL) OR
         (state IN ('pending', 'succeeded', 'cancelled', 'unknown') AND provider_login_id IS NOT NULL AND auth_url IS NOT NULL) OR
         (state = 'failed' AND provider_login_id IS NOT NULL AND auth_url IS NOT NULL)),
  CHECK (state NOT IN ('succeeded', 'failed', 'cancelled', 'unknown') OR message IS NULL OR length(trim(message)) > 0),
  CHECK ((operation IS NULL AND operation_owner IS NULL AND operation_token IS NULL AND operation_started_at IS NULL)
      OR (state = 'pending' AND operation IS NOT NULL AND operation_owner IS NOT NULL AND operation_token IS NOT NULL AND operation_started_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS provider_account_login_request_identity
  ON provider_account_login_sessions (operator_id, request_id);
CREATE UNIQUE INDEX IF NOT EXISTS provider_account_login_provider_identity
  ON provider_account_login_sessions (provider_login_id)
  WHERE provider_login_id IS NOT NULL;

CREATE OR REPLACE FUNCTION protect_provider_account_login_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.login_id IS DISTINCT FROM OLD.login_id
    OR NEW.request_id IS DISTINCT FROM OLD.request_id
    OR NEW.operator_id IS DISTINCT FROM OLD.operator_id
    OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
    OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR (OLD.provider_login_id IS NOT NULL AND NEW.provider_login_id IS DISTINCT FROM OLD.provider_login_id)
    OR (OLD.auth_url IS NOT NULL AND NEW.auth_url IS DISTINCT FROM OLD.auth_url) THEN
    RAISE EXCEPTION 'provider account login identity is immutable';
  END IF;
  IF OLD.state IN ('succeeded', 'failed', 'cancelled', 'unknown') AND (NEW.state <> OLD.state OR NEW.message IS DISTINCT FROM OLD.message) THEN
    RAISE EXCEPTION 'provider account login state is terminal';
  END IF;
  IF OLD.state = 'starting' AND NEW.state NOT IN ('starting', 'pending', 'failed', 'cancelled', 'unknown') THEN
    RAISE EXCEPTION 'invalid provider account login state transition';
  END IF;
  IF OLD.state = 'pending' AND NEW.state NOT IN ('pending', 'succeeded', 'failed', 'cancelled', 'unknown') THEN
    RAISE EXCEPTION 'invalid provider account login state transition';
  END IF;
  NEW.updated_at = transaction_timestamp();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS provider_account_login_state_guard ON provider_account_login_sessions;
CREATE TRIGGER provider_account_login_state_guard
  BEFORE UPDATE ON provider_account_login_sessions
  FOR EACH ROW EXECUTE FUNCTION protect_provider_account_login_state();


CREATE OR REPLACE FUNCTION reject_provider_account_login_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'provider account login sessions are append-only';
END;
$$;
DROP TRIGGER IF EXISTS provider_account_login_append_only ON provider_account_login_sessions;
CREATE TRIGGER provider_account_login_append_only
  BEFORE DELETE ON provider_account_login_sessions
  FOR EACH ROW EXECUTE FUNCTION reject_provider_account_login_delete();
