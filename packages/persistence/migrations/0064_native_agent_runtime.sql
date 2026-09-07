-- Durable native Maestro conversations and replayable event cursors.
CREATE TABLE IF NOT EXISTS conversations (
  conversation_id uuid PRIMARY KEY,
  operator_id text NOT NULL CHECK (btrim(operator_id) <> '' AND length(operator_id) <= 256),
  project_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  model_provider text NOT NULL CHECK (btrim(model_provider) <> '' AND length(model_provider) <= 64),
  model_id text NOT NULL CHECK (btrim(model_id) <> '' AND length(model_id) <= 256),
  status text NOT NULL CHECK (status IN ('active', 'running', 'succeeded', 'failed', 'cancelled', 'unknown')),
  version integer NOT NULL CHECK (version > 0),
  binding jsonb NOT NULL CHECK (jsonb_typeof(binding) = 'object' AND pg_column_size(binding) <= 16384),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (conversation_id, project_id)
);
CREATE OR REPLACE FUNCTION validate_conversation_goal_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM goals WHERE goal_id = NEW.goal_id AND project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'Conversation Goal/project binding is invalid';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS conversations_goal_binding ON conversations;
CREATE TRIGGER conversations_goal_binding BEFORE INSERT OR UPDATE OF goal_id, project_id ON conversations
  FOR EACH ROW EXECUTE FUNCTION validate_conversation_goal_binding();
CREATE INDEX IF NOT EXISTS conversations_project_idx ON conversations (project_id, created_at, conversation_id);
CREATE TABLE IF NOT EXISTS conversation_events (
  cursor bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE,
  conversation_id uuid NOT NULL,
  project_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('conversation_created', 'turn_started', 'turn_completed', 'turn_failed', 'turn_cancelled', 'turn_unknown')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND pg_column_size(payload) <= 65536),
  occurred_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  FOREIGN KEY (conversation_id, project_id) REFERENCES conversations(conversation_id, project_id)
);
CREATE INDEX IF NOT EXISTS conversation_events_cursor_idx ON conversation_events (conversation_id, project_id, cursor);
CREATE TABLE IF NOT EXISTS conversation_turns (
  turn_id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL,
  project_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content text NOT NULL CHECK (length(content) <= 64000),
  status text NOT NULL CHECK (status IN ('accepted', 'completed', 'failed', 'cancelled', 'unknown')),
  cursor bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  FOREIGN KEY (conversation_id, project_id) REFERENCES conversations(conversation_id, project_id)
);
CREATE INDEX IF NOT EXISTS conversation_turns_order_idx ON conversation_turns (conversation_id, created_at, turn_id);

DO $$
DECLARE conversation_schema text := current_schema();
BEGIN
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.validate_conversation_goal_binding() SET search_path = pg_catalog, %I', conversation_schema, conversation_schema);
END;
$$;
