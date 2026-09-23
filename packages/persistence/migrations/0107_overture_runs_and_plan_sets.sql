-- E5 Task 14: goal-less, project-scoped Overture Crew runs and append-only plan sets.
-- Overture intentionally binds to the existing conversation composite identity;
-- this repository has no standalone projects table.

CREATE TABLE IF NOT EXISTS overture_runs (
  run_id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL,
  project_id uuid NOT NULL,
  goal_id uuid NULL CHECK (goal_id IS NULL),
  execution_phase text NOT NULL DEFAULT 'overture' CHECK (execution_phase = 'overture'),
  task_contract_ref jsonb NULL CHECK (task_contract_ref IS NULL OR (jsonb_typeof(task_contract_ref) = 'object' AND task_contract_ref ? 'planId' AND task_contract_ref ? 'version' AND task_contract_ref ? 'manifestHash')),
  state text NOT NULL CHECK (state IN ('collecting', 'waiting_for_operator', 'synthesizing', 'review', 'blocked', 'launched', 'cancelled')),
  version bigint NOT NULL CHECK (version > 0),
  role_taxonomy_version smallint NOT NULL CHECK (role_taxonomy_version = 2),
  plan_manifest_hash char(64) NULL CHECK (plan_manifest_hash IS NULL OR plan_manifest_hash ~ '^[0-9a-f]{64}$'),
  create_command_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (run_id, project_id),
  UNIQUE (run_id, project_id, conversation_id),
  UNIQUE (conversation_id, project_id),
  FOREIGN KEY (conversation_id, project_id) REFERENCES conversations(conversation_id, project_id)
);
CREATE INDEX IF NOT EXISTS overture_runs_project_idx ON overture_runs (project_id, created_at, run_id);

CREATE TABLE IF NOT EXISTS overture_role_assignments (
  run_id uuid NOT NULL,
  project_id uuid NOT NULL,
  role_id text NOT NULL CHECK (role_id IN ('conversation-lead', 'architecture-analyst', 'external-research-scout', 'security-evaluator', 'design-mock-specialist', 'task-editor')),
  status text NOT NULL CHECK (status IN ('queued', 'active', 'paused', 'completed', 'failed')),
  model_ref text NULL CHECK (model_ref IS NULL OR (btrim(model_ref) <> '' AND model_ref !~ E'[\r\n]')),
  assigned_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (run_id, project_id, role_id),
  FOREIGN KEY (run_id, project_id) REFERENCES overture_runs(run_id, project_id)
);

CREATE TABLE IF NOT EXISTS overture_messages (
  message_id uuid PRIMARY KEY,
  message_sequence bigint GENERATED ALWAYS AS IDENTITY,
  message_cursor bigint NOT NULL CHECK (message_cursor > 0),
  turn_id uuid NOT NULL REFERENCES conversation_turns(turn_id),
  run_id uuid NOT NULL,
  project_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('operator', 'concertmaster', 'role')),
  actor_id text NOT NULL CHECK (btrim(actor_id) <> '' AND length(actor_id) <= 256),
  model_ref text NULL CHECK (model_ref IS NULL OR (btrim(model_ref) <> '' AND model_ref !~ E'[\r\n]')),
  content text NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 60000),
  command_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (message_sequence),
  UNIQUE (run_id, project_id, message_cursor),
  UNIQUE (run_id, command_id),
  FOREIGN KEY (run_id, project_id, conversation_id) REFERENCES overture_runs(run_id, project_id, conversation_id),
  FOREIGN KEY (run_id, project_id) REFERENCES overture_runs(run_id, project_id),
  FOREIGN KEY (conversation_id, project_id) REFERENCES conversations(conversation_id, project_id)
);
CREATE INDEX IF NOT EXISTS overture_messages_order_idx ON overture_messages (run_id, message_sequence);

CREATE TABLE IF NOT EXISTS overture_clarifications (
  clarification_id uuid PRIMARY KEY,
  run_id uuid NOT NULL,
  project_id uuid NOT NULL,
  question text NOT NULL CHECK (length(btrim(question)) BETWEEN 1 AND 60000),
  answer_command_id uuid NULL,
  answer text NULL CHECK (answer IS NULL OR length(btrim(answer)) BETWEEN 1 AND 60000),
  status text NOT NULL CHECK (status IN ('open', 'answered', 'cancelled')),
  command_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  answered_at timestamptz NULL,
  UNIQUE (run_id, command_id),
  UNIQUE (run_id, answer_command_id),
  FOREIGN KEY (run_id, project_id) REFERENCES overture_runs(run_id, project_id)
);
CREATE INDEX IF NOT EXISTS overture_clarifications_open_idx ON overture_clarifications (run_id, status, created_at);

CREATE TABLE IF NOT EXISTS overture_artifacts (
  artifact_id uuid PRIMARY KEY,
  run_id uuid NOT NULL,
  project_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('research', 'security_finding', 'design_mock', 'decision')),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 256),
  content text NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 60000),
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  source_refs jsonb NOT NULL CHECK (jsonb_typeof(source_refs) = 'array' AND jsonb_array_length(source_refs) <= 128),
  command_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (run_id, command_id),
  FOREIGN KEY (run_id, project_id) REFERENCES overture_runs(run_id, project_id)
);
CREATE INDEX IF NOT EXISTS overture_artifacts_run_idx ON overture_artifacts (run_id, created_at, artifact_id);

CREATE TABLE IF NOT EXISTS overture_plan_documents (
  document_id uuid PRIMARY KEY,
  run_id uuid NOT NULL,
  project_id uuid NOT NULL,
  path text NOT NULL CHECK (path ~ '^plan00\.md$' OR path ~ '^plan(?:0[1-9]|[1-9][0-9]+)\.md$' OR path ~ '^plan(?:0[1-9]|[1-9][0-9]+)-slice(?:0[1-9]|[1-9][0-9]+)\.md$'),
  kind text NOT NULL CHECK (kind IN ('project', 'phase', 'slice')),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (run_id, path),
  UNIQUE (document_id, run_id, project_id),
  CHECK ((kind = 'project' AND path = 'plan00.md') OR (kind = 'phase' AND path ~ '^plan(?:0[1-9]|[1-9][0-9]+)\.md$') OR (kind = 'slice' AND path ~ '^plan(?:0[1-9]|[1-9][0-9]+)-slice(?:0[1-9]|[1-9][0-9]+)\.md$')),
  FOREIGN KEY (run_id, project_id) REFERENCES overture_runs(run_id, project_id)
);

CREATE TABLE IF NOT EXISTS overture_plan_revisions (
  revision_id uuid PRIMARY KEY,
  document_id uuid NOT NULL,
  run_id uuid NOT NULL,
  project_id uuid NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  content text NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 60000),
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  source_refs jsonb NOT NULL CHECK (jsonb_typeof(source_refs) = 'array' AND jsonb_array_length(source_refs) <= 128),
  dependencies jsonb NOT NULL CHECK (jsonb_typeof(dependencies) = 'array' AND jsonb_array_length(dependencies) <= 256),
  command_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (document_id, version),
  UNIQUE (run_id, command_id),
  FOREIGN KEY (document_id, run_id, project_id) REFERENCES overture_plan_documents(document_id, run_id, project_id),
  FOREIGN KEY (run_id, project_id) REFERENCES overture_runs(run_id, project_id)
);
CREATE INDEX IF NOT EXISTS overture_plan_revisions_latest_idx ON overture_plan_revisions (document_id, version DESC);

CREATE TABLE IF NOT EXISTS overture_manifest_revisions (
  manifest_revision_id uuid PRIMARY KEY,
  run_id uuid NOT NULL,
  project_id uuid NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  documents jsonb NOT NULL CHECK (jsonb_typeof(documents) = 'array' AND jsonb_array_length(documents) >= 1 AND jsonb_array_length(documents) <= 512),
  manifest_hash char(64) NOT NULL CHECK (manifest_hash ~ '^[0-9a-f]{64}$'),
  command_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (run_id, version),
  UNIQUE (run_id, command_id),
  FOREIGN KEY (run_id, project_id) REFERENCES overture_runs(run_id, project_id)
);
CREATE INDEX IF NOT EXISTS overture_manifest_revisions_latest_idx ON overture_manifest_revisions (run_id, version DESC);

CREATE TABLE IF NOT EXISTS overture_events (
  cursor bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE,
  run_id uuid NOT NULL,
  project_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('run_created', 'role_activated', 'message_appended', 'clarification_opened', 'clarification_answered', 'artifact_created', 'artifact_revision_created', 'plan_revision_created', 'manifest_revision_created', 'synthesis_started', 'review_ready', 'launch_ready', 'run_state_changed')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND pg_column_size(payload) <= 65536),
  command_id uuid NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  FOREIGN KEY (run_id, project_id) REFERENCES overture_runs(run_id, project_id)
);
CREATE INDEX IF NOT EXISTS overture_events_cursor_idx ON overture_events (run_id, project_id, cursor);

CREATE TABLE IF NOT EXISTS overture_outbox (
  outbox_id uuid PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE REFERENCES overture_events(event_id),
  run_id uuid NOT NULL,
  project_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND pg_column_size(payload) <= 65536),
  status text NOT NULL CHECK (status IN ('pending', 'claimed', 'published', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  FOREIGN KEY (run_id, project_id) REFERENCES overture_runs(run_id, project_id)
);
CREATE INDEX IF NOT EXISTS overture_outbox_pending_idx ON overture_outbox (status, available_at, created_at);

CREATE OR REPLACE FUNCTION reject_overture_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Overture history is append-only';
END;
$$;
DROP TRIGGER IF EXISTS overture_messages_append_only ON overture_messages;
CREATE TRIGGER overture_messages_append_only BEFORE UPDATE OR DELETE ON overture_messages FOR EACH ROW EXECUTE FUNCTION reject_overture_append_only();
DROP TRIGGER IF EXISTS overture_artifacts_append_only ON overture_artifacts;
CREATE TRIGGER overture_artifacts_append_only BEFORE UPDATE OR DELETE ON overture_artifacts FOR EACH ROW EXECUTE FUNCTION reject_overture_append_only();
DROP TRIGGER IF EXISTS overture_plan_documents_append_only ON overture_plan_documents;
CREATE TRIGGER overture_plan_documents_append_only BEFORE UPDATE OR DELETE ON overture_plan_documents FOR EACH ROW EXECUTE FUNCTION reject_overture_append_only();
DROP TRIGGER IF EXISTS overture_plan_revisions_append_only ON overture_plan_revisions;
CREATE TRIGGER overture_plan_revisions_append_only BEFORE UPDATE OR DELETE ON overture_plan_revisions FOR EACH ROW EXECUTE FUNCTION reject_overture_append_only();
DROP TRIGGER IF EXISTS overture_manifest_revisions_append_only ON overture_manifest_revisions;
CREATE TRIGGER overture_manifest_revisions_append_only BEFORE UPDATE OR DELETE ON overture_manifest_revisions FOR EACH ROW EXECUTE FUNCTION reject_overture_append_only();
DROP TRIGGER IF EXISTS overture_events_append_only ON overture_events;
CREATE TRIGGER overture_events_append_only BEFORE UPDATE OR DELETE ON overture_events FOR EACH ROW EXECUTE FUNCTION reject_overture_append_only();

CREATE OR REPLACE FUNCTION reject_overture_sensitive_content()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog AS $$
BEGIN
  IF to_jsonb(NEW)::text ~* '(password[[:space:]]*[:=]|passwd[[:space:]]*[:=]|secret[[:space:]]*[:=]|api[_-]?key[[:space:]]*[:=]|access[_-]?token[[:space:]]*[:=]|refresh[_-]?token[[:space:]]*[:=]|private[ _-]?key[[:space:]]*[:=]|authorization[[:space:]]*:[[:space:]]*bearer|bearer[[:space:]]+|credential[[:space:]]*[:=]|-----BEGIN([[:space:]][A-Z]+)?[[:space:]]PRIVATE[[:space:]]KEY-----|(^|[^a-z0-9])(sk|pk)-[a-z0-9_-]{16,}([^a-z0-9]|$)|eyj[a-z0-9_-]+[.][a-z0-9_-]+[.][a-z0-9_-]+|AKIA[0-9A-Z]{16}|gh[pousr]_[a-z0-9]{20,}|AIza[0-9a-z_-]{20,}|xox[baprs]-[0-9a-z-]{20,}|hf_[0-9a-z]{20,}|<[/]?(thinking|analysis|tool_call|function_call)[[:space:]>]|tool[[:space:]]+arguments?[[:space:]]*[:=])' THEN
    RAISE EXCEPTION 'Overture content contains prohibited sensitive material';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS overture_messages_sensitive_content ON overture_messages;
CREATE TRIGGER overture_messages_sensitive_content BEFORE INSERT OR UPDATE ON overture_messages FOR EACH ROW EXECUTE FUNCTION reject_overture_sensitive_content();
DROP TRIGGER IF EXISTS overture_clarifications_sensitive_content ON overture_clarifications;
CREATE TRIGGER overture_clarifications_sensitive_content BEFORE INSERT OR UPDATE ON overture_clarifications FOR EACH ROW EXECUTE FUNCTION reject_overture_sensitive_content();
DROP TRIGGER IF EXISTS overture_artifacts_sensitive_content ON overture_artifacts;
CREATE TRIGGER overture_artifacts_sensitive_content BEFORE INSERT OR UPDATE ON overture_artifacts FOR EACH ROW EXECUTE FUNCTION reject_overture_sensitive_content();
DROP TRIGGER IF EXISTS overture_plan_revisions_sensitive_content ON overture_plan_revisions;
CREATE TRIGGER overture_plan_revisions_sensitive_content BEFORE INSERT OR UPDATE ON overture_plan_revisions FOR EACH ROW EXECUTE FUNCTION reject_overture_sensitive_content();

DO $$
DECLARE overture_schema text := current_schema();
BEGIN
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.reject_overture_append_only() SET search_path = pg_catalog, %I', overture_schema, overture_schema);
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.reject_overture_sensitive_content() SET search_path = pg_catalog, %I', overture_schema, overture_schema);
END;
$$;
