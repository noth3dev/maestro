-- Bound provider identity to one Head activation command and keep partial
-- bindings impossible. This is additive to 0058 so already-applied migration
-- checksums remain immutable in production.
ALTER TABLE head_activation_commands
  ADD CONSTRAINT head_activation_commands_provider_refs_pair_check
  CHECK ((provider_execution_ref IS NULL) = (provider_invocation_ref IS NULL));
ALTER TABLE head_activation_commands
  ADD CONSTRAINT head_activation_commands_provider_refs_nonempty_check
  CHECK ((provider_execution_ref IS NULL OR btrim(provider_execution_ref) <> '')
     AND (provider_invocation_ref IS NULL OR btrim(provider_invocation_ref) <> ''));
ALTER TABLE head_activation_commands
  ADD CONSTRAINT head_activation_commands_active_session_nonempty_check
  CHECK (active_session_ref IS NULL OR btrim(active_session_ref) <> '');
ALTER TABLE head_activation_commands
  ADD CONSTRAINT head_activation_commands_active_status_session_check
  CHECK ((status = 'active') = (active_session_ref IS NOT NULL));
ALTER TABLE head_activation_commands
  ADD CONSTRAINT head_activation_commands_active_provider_identity_check
  CHECK (status <> 'active' OR provider_execution_ref IS NULL OR active_session_ref = provider_execution_ref);
CREATE UNIQUE INDEX IF NOT EXISTS head_activation_commands_provider_execution_idx
  ON head_activation_commands (provider_execution_ref)
  WHERE provider_execution_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS head_activation_commands_provider_invocation_idx
  ON head_activation_commands (provider_invocation_ref)
  WHERE provider_invocation_ref IS NOT NULL;

CREATE OR REPLACE FUNCTION head_activation_commands_binding_lifecycle()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Provider identity is assigned only to a spawn_started command and cannot
  -- be swapped. Clearing it is reserved for a cancellation-confirmed reset
  -- (the command must return to retryable reserved state).
  IF OLD.provider_execution_ref IS NOT NULL AND NEW.provider_execution_ref IS NOT NULL
     AND (OLD.provider_execution_ref IS DISTINCT FROM NEW.provider_execution_ref
       OR OLD.provider_invocation_ref IS DISTINCT FROM NEW.provider_invocation_ref) THEN
    RAISE EXCEPTION 'Head activation provider binding is immutable';
  END IF;
  IF OLD.provider_execution_ref IS NULL AND NEW.provider_execution_ref IS NOT NULL
     AND (OLD.status <> 'spawn_started' OR NEW.status NOT IN ('spawn_started', 'active', 'orphaned')) THEN
    RAISE EXCEPTION 'Head activation provider binding requires a spawn_started command';
  END IF;
  IF OLD.provider_execution_ref IS NOT NULL AND NEW.provider_execution_ref IS NULL
     AND NEW.status <> 'reserved' THEN
    RAISE EXCEPTION 'Head activation provider binding can only be cleared by a reset';
  END IF;
  IF OLD.active_session_ref IS NOT NULL AND NEW.active_session_ref IS NOT NULL
     AND OLD.active_session_ref IS DISTINCT FROM NEW.active_session_ref THEN
    RAISE EXCEPTION 'Head activation active session binding is immutable';
  END IF;
  IF OLD.active_session_ref IS NULL AND NEW.active_session_ref IS NOT NULL AND NEW.status <> 'active' THEN
    RAISE EXCEPTION 'Head activation active session requires active status';
  END IF;
  IF OLD.active_session_ref IS NOT NULL AND NEW.active_session_ref IS NULL
     AND NEW.status NOT IN ('reserved', 'orphaned') THEN
    RAISE EXCEPTION 'Head activation active session can only be cleared by cleanup';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS head_activation_commands_binding_lifecycle ON head_activation_commands;
CREATE TRIGGER head_activation_commands_binding_lifecycle BEFORE UPDATE ON head_activation_commands
  FOR EACH ROW EXECUTE FUNCTION head_activation_commands_binding_lifecycle();
