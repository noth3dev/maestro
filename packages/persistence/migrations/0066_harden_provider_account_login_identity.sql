-- Harden provider account-login identity transitions after 0065.
-- The provider identity may be populated only by the dedicated completion
-- function, never by an arbitrary UPDATE against the table.

CREATE OR REPLACE FUNCTION protect_provider_account_login_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.login_id IS DISTINCT FROM OLD.login_id
    OR NEW.request_id IS DISTINCT FROM OLD.request_id
    OR NEW.operator_id IS DISTINCT FROM OLD.operator_id
    OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
    OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'provider account login identity is immutable';
  END IF;

  IF NEW.provider_login_id IS DISTINCT FROM OLD.provider_login_id
    OR NEW.auth_url IS DISTINCT FROM OLD.auth_url THEN
    IF NOT (
      OLD.state = 'starting'
      AND NEW.state = 'pending'
      AND OLD.provider_login_id IS NULL
      AND OLD.auth_url IS NULL
      AND NEW.provider_login_id IS NOT NULL
      AND NEW.auth_url IS NOT NULL
      AND current_setting('maestro.provider_account_login_completion', true) = OLD.login_id::text
    ) THEN
      RAISE EXCEPTION 'provider account login identity is immutable';
    END IF;
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

CREATE OR REPLACE FUNCTION complete_provider_account_login_start(
  p_login_id uuid,
  p_provider_login_id text,
  p_auth_url text
) RETURNS SETOF provider_account_login_sessions LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('maestro.provider_account_login_completion', p_login_id::text, true);
  RETURN QUERY
    UPDATE provider_account_login_sessions
       SET provider_login_id = p_provider_login_id,
           auth_url = p_auth_url,
           state = 'pending',
           message = NULL
     WHERE login_id = p_login_id
       AND state = 'starting'
     RETURNING *;
END;
$$;
