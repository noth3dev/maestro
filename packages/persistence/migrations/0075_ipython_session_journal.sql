-- Phase 2 IPython process/session lifecycle evidence.
-- Each row is an immutable lifecycle event. Terminal state is represented by
-- exactly one terminal event per process generation, so a restart can append a
-- reaped or unknown decision without rewriting history.
CREATE TABLE IF NOT EXISTS ipython_session_journal (
  journal_id uuid PRIMARY KEY,
  journal_position bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  session_id text NOT NULL CHECK (btrim(session_id) <> '' AND length(session_id) <= 512),
  process_ref text NOT NULL CHECK (btrim(process_ref) <> '' AND length(process_ref) <= 512),
  project_id uuid NOT NULL,
  goal_id uuid NOT NULL REFERENCES goals(goal_id),
  event text NOT NULL CHECK (event IN ('started', 'orphaned', 'reaped', 'completed', 'failed', 'cancelled', 'unknown')),
  reason text CHECK (reason IS NULL OR (btrim(reason) <> '' AND length(reason) <= 1024)),
  process_pid integer CHECK (process_pid IS NULL OR process_pid > 1),
  parent_pid integer CHECK (parent_pid IS NULL OR parent_pid > 0),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object' AND pg_column_size(details) <= 16384),
  occurred_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime',
  UNIQUE (process_ref, event)
);

CREATE INDEX IF NOT EXISTS ipython_session_journal_session_idx
  ON ipython_session_journal (session_id, journal_position);
CREATE INDEX IF NOT EXISTS ipython_session_journal_goal_idx
  ON ipython_session_journal (project_id, goal_id, journal_position);
-- A process generation may not be both proven reaped/completed/cancelled and
-- unknown. This is the database-level exactly-once terminal fence used by
-- concurrent restart reconcilers.
CREATE UNIQUE INDEX IF NOT EXISTS ipython_session_journal_terminal_idx
  ON ipython_session_journal (process_ref)
  WHERE event IN ('reaped', 'completed', 'failed', 'cancelled', 'unknown');

CREATE OR REPLACE FUNCTION validate_ipython_session_journal_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM goals
     WHERE goal_id = NEW.goal_id AND project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'IPython session journal Goal/project binding is invalid';
  END IF;
  IF NEW.event <> 'started' AND NEW.reason IS NULL THEN
    RAISE EXCEPTION 'IPython session journal non-start event requires a reason';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS ipython_session_journal_scope ON ipython_session_journal;
CREATE TRIGGER ipython_session_journal_scope
BEFORE INSERT ON ipython_session_journal
FOR EACH ROW EXECUTE FUNCTION validate_ipython_session_journal_scope();

CREATE OR REPLACE FUNCTION reject_ipython_session_journal_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'IPython session journal is append-only';
END;
$$;
DROP TRIGGER IF EXISTS ipython_session_journal_append_only ON ipython_session_journal;
CREATE TRIGGER ipython_session_journal_append_only
BEFORE UPDATE OR DELETE ON ipython_session_journal
FOR EACH ROW EXECUTE FUNCTION reject_ipython_session_journal_mutation();

DO $$
DECLARE journal_schema text := current_schema();
BEGIN
  EXECUTE pg_catalog.format(
    'ALTER FUNCTION %I.validate_ipython_session_journal_scope() SET search_path = pg_catalog, %I',
    journal_schema, journal_schema
  );
END;
$$;
