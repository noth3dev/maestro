-- Durable Head activation command identity. A command is reserved before a
-- provider root is spawned so retries cannot silently create a second session.
CREATE TABLE IF NOT EXISTS head_activation_commands (
  command_id uuid PRIMARY KEY,
  goal_id uuid NOT NULL REFERENCES goals(goal_id),
  department_id text NOT NULL REFERENCES departments(department_id),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('reserved', 'spawn_started', 'active')),
  active_session_ref text,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
CREATE INDEX IF NOT EXISTS head_activation_commands_binding_idx
  ON head_activation_commands (goal_id, department_id, status);
CREATE OR REPLACE FUNCTION head_activation_commands_immutable_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.command_id <> NEW.command_id OR OLD.goal_id <> NEW.goal_id OR OLD.department_id <> NEW.department_id OR OLD.request_hash <> NEW.request_hash THEN
    RAISE EXCEPTION 'Head activation command identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS head_activation_commands_identity ON head_activation_commands;
CREATE TRIGGER head_activation_commands_identity BEFORE UPDATE ON head_activation_commands
  FOR EACH ROW EXECUTE FUNCTION head_activation_commands_immutable_history();
