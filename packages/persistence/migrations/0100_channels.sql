DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'goals'::regclass AND conname = 'goals_goal_project_unique'
  ) THEN
    ALTER TABLE goals ADD CONSTRAINT goals_goal_project_unique UNIQUE (goal_id, project_id);
  END IF;
END;
$$;

-- Plan 7-c §S1: one Goal-bound schema for Department, organization, and Encore channels.
-- Channel membership is intentionally not stored. Reads derive active Heads and
-- nonterminal Workers from the live Goal roster.
CREATE TABLE IF NOT EXISTS channels (
  channel_id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  scope_kind text NOT NULL CHECK (scope_kind IN ('department', 'organization', 'encore')),
  scope_id text NOT NULL CHECK (btrim(scope_id) <> ''),
  department_id text REFERENCES departments(department_id),
  display_name text NOT NULL CHECK (btrim(display_name) <> ''),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (project_id, goal_id, scope_kind, scope_id),
  FOREIGN KEY (goal_id, project_id) REFERENCES goals(goal_id, project_id),
  CHECK ((scope_kind = 'department') = (department_id IS NOT NULL)),
  CHECK (scope_kind <> 'department' OR scope_id = department_id),
  CHECK ((scope_kind = 'organization' AND scope_id IN ('general', 'head-council'))
      OR (scope_kind = 'encore' AND scope_id IN ('encore-council', 'metronome'))
      OR (scope_kind = 'department'))
);
CREATE INDEX IF NOT EXISTS channels_goal_scope_idx ON channels (goal_id, scope_kind, scope_id);

CREATE TABLE IF NOT EXISTS channel_messages (
  message_id uuid PRIMARY KEY,
  message_sequence bigint GENERATED ALWAYS AS IDENTITY,
  channel_id uuid NOT NULL REFERENCES channels(channel_id),
  author_kind text NOT NULL CHECK (author_kind IN ('operator', 'head', 'worker', 'role')),
  author_id text NOT NULL CHECK (btrim(author_id) <> ''),
  content text NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 64000),
  idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime',
  UNIQUE (channel_id, idempotency_key),
  UNIQUE (message_sequence)
);
CREATE INDEX IF NOT EXISTS channel_messages_order_idx ON channel_messages (channel_id, message_sequence);

CREATE OR REPLACE FUNCTION assert_channel_goal_project_binding()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM goals WHERE goal_id = NEW.goal_id AND project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'Channel Goal and project identities must match';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS channels_goal_project_binding ON channels;
CREATE TRIGGER channels_goal_project_binding
BEFORE INSERT OR UPDATE OF goal_id, project_id ON channels
FOR EACH ROW EXECUTE FUNCTION assert_channel_goal_project_binding();

CREATE OR REPLACE FUNCTION assert_channel_message_author()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE channel_project uuid;
DECLARE channel_goal uuid;
DECLARE channel_scope_kind text;
DECLARE channel_scope_id text;
BEGIN
  SELECT project_id, goal_id, scope_kind, scope_id INTO channel_project, channel_goal, channel_scope_kind, channel_scope_id
    FROM channels WHERE channel_id = NEW.channel_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Channel message must reference an existing channel'; END IF;
  IF EXISTS (SELECT 1 FROM goals WHERE goal_id = channel_goal AND state IN ('stopped', 'succeeded', 'failed')) THEN
    RAISE EXCEPTION 'Channel is closed because its Goal has ended';
  END IF;
  IF NEW.author_kind = 'operator' AND NOT EXISTS (
    SELECT 1
      FROM local_operators o
      JOIN operator_project_memberships m ON m.operator_id = o.operator_id AND m.project_id = channel_project AND m.active = true
      JOIN operator_project_roles r ON r.operator_id = o.operator_id AND r.project_id = channel_project AND r.active = true
     WHERE o.operator_id::text = NEW.author_id
       AND o.active = true
       AND (
         (channel_scope_kind = 'department' AND r.role_id IN ('concertmaster', 'head-' || channel_scope_id))
         OR (channel_scope_kind = 'organization' AND channel_scope_id = 'general' AND r.role_id = 'concertmaster')
         OR (channel_scope_kind = 'organization' AND channel_scope_id = 'head-council' AND (r.role_id = 'concertmaster' OR EXISTS (SELECT 1 FROM departments d WHERE r.role_id = 'head-' || d.department_id)))
         OR (channel_scope_kind = 'encore' AND channel_scope_id = 'metronome' AND r.role_id IN ('concertmaster', 'encore-metronome'))
         OR (channel_scope_kind = 'encore' AND channel_scope_id = 'encore-council' AND r.role_id IN ('concertmaster', 'encore-council-1', 'encore-council-2', 'encore-council-3'))
       )
     FOR SHARE
  ) THEN RAISE EXCEPTION 'Channel message operator author must have active project membership and channel role'; END IF;
  IF NEW.author_kind = 'head' AND NOT EXISTS (
    SELECT 1 FROM goal_head_participations
    WHERE goal_id = channel_goal AND head_role_id = NEW.author_id AND status = 'active' AND active_session_ref IS NOT NULL
      AND ((channel_scope_kind = 'department' AND department_id = channel_scope_id) OR channel_scope_kind = 'organization')
  ) THEN RAISE EXCEPTION 'Channel message Head author must be active in the channel scope'; END IF;
  IF NEW.author_kind = 'worker' AND NOT EXISTS (
    SELECT 1 FROM workers w JOIN head_councils hc ON hc.council_id = w.council_id
    WHERE hc.goal_id = channel_goal AND w.worker_id::text = NEW.author_id AND w.status IN ('spawned', 'running', 'awaiting_repair', 'unknown')
      AND ((channel_scope_kind = 'department' AND w.department_id = channel_scope_id) OR (channel_scope_kind = 'organization' AND channel_scope_id = 'general'))
  ) THEN RAISE EXCEPTION 'Channel message Worker author must be active in the channel scope'; END IF;
  IF NEW.author_kind = 'role' AND NOT EXISTS (
    SELECT 1 FROM permanent_roles
    WHERE role_id = NEW.author_id AND status = 'standing'
      AND ((channel_scope_kind = 'organization' AND channel_scope_id = 'general' AND role_id = 'concertmaster')
        OR (channel_scope_kind = 'organization' AND channel_scope_id = 'head-council' AND role_id = 'concertmaster')
        OR (channel_scope_kind = 'encore' AND channel_scope_id = 'encore-council' AND role_id IN ('encore-council-1', 'encore-council-2', 'encore-council-3'))
        OR (channel_scope_kind = 'encore' AND channel_scope_id = 'metronome' AND role_id = 'encore-metronome'))
  ) THEN RAISE EXCEPTION 'Channel message role author is outside the channel scope'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS channel_messages_author_binding ON channel_messages;
CREATE TRIGGER channel_messages_author_binding
BEFORE INSERT ON channel_messages
FOR EACH ROW EXECUTE FUNCTION assert_channel_message_author();

CREATE OR REPLACE FUNCTION reject_channel_message_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Channel messages are append-only';
END;
$$;
DROP TRIGGER IF EXISTS channel_messages_append_only ON channel_messages;
CREATE TRIGGER channel_messages_append_only
BEFORE UPDATE OR DELETE ON channel_messages
FOR EACH ROW EXECUTE FUNCTION reject_channel_message_mutation();
DROP TRIGGER IF EXISTS channel_messages_truncate_forbidden ON channel_messages;
CREATE TRIGGER channel_messages_truncate_forbidden
BEFORE TRUNCATE ON channel_messages
FOR EACH STATEMENT EXECUTE FUNCTION reject_unscoped_truncate();

CREATE OR REPLACE FUNCTION reject_channel_identity_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.channel_id IS DISTINCT FROM OLD.channel_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.goal_id IS DISTINCT FROM OLD.goal_id
     OR NEW.scope_kind IS DISTINCT FROM OLD.scope_kind
     OR NEW.scope_id IS DISTINCT FROM OLD.scope_id
     OR NEW.department_id IS DISTINCT FROM OLD.department_id
     OR NEW.display_name IS DISTINCT FROM OLD.display_name
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Channel identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS channels_identity_immutable ON channels;
CREATE TRIGGER channels_identity_immutable
BEFORE UPDATE ON channels
FOR EACH ROW EXECUTE FUNCTION reject_channel_identity_mutation();


CREATE OR REPLACE FUNCTION reject_channel_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Channels are append-only';
END;
$$;
DROP TRIGGER IF EXISTS channels_append_only ON channels;
CREATE TRIGGER channels_append_only
BEFORE DELETE ON channels
FOR EACH ROW EXECUTE FUNCTION reject_channel_mutation();
DROP TRIGGER IF EXISTS channels_truncate_forbidden ON channels;
CREATE TRIGGER channels_truncate_forbidden
BEFORE TRUNCATE ON channels
FOR EACH STATEMENT EXECUTE FUNCTION reject_unscoped_truncate();
-- Trigger functions must resolve the tables in the schema that owns the trigger.
-- Pin that schema explicitly instead of relying on public or caller-controlled
-- search_path; migrations are also applied into isolated test schemas.
DO $$
DECLARE channel_schema text := current_schema();
BEGIN
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.assert_channel_goal_project_binding() SET search_path = pg_catalog, %I', channel_schema, channel_schema);
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.assert_channel_message_author() SET search_path = pg_catalog, %I', channel_schema, channel_schema);
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.reject_channel_message_mutation() SET search_path = pg_catalog, %I', channel_schema, channel_schema);
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.reject_channel_identity_mutation() SET search_path = pg_catalog, %I', channel_schema, channel_schema);
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.reject_channel_mutation() SET search_path = pg_catalog, %I', channel_schema, channel_schema);
END;
$$;
