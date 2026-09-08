-- Additive hardening for the IPython session journal. This file is separate
-- from 0075 so production migration checksums remain immutable while existing
-- installations can remove the original Goal foreign key and gain the durable
-- lifecycle fences.
DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT c.conname
      FROM pg_constraint c
     WHERE c.conrelid = 'ipython_session_journal'::regclass
       AND c.contype = 'f'
       AND pg_get_constraintdef(c.oid) ILIKE '%REFERENCES%goals%'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.ipython_session_journal DROP CONSTRAINT %I',
      current_schema(), constraint_name
    );
  END LOOP;
END;
$$;

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
DECLARE
  first_row ipython_session_journal%ROWTYPE;
  has_started boolean;
  has_orphaned boolean;
  has_terminal boolean;
BEGIN
  -- Serialize lifecycle decisions for one generation. Without this lock,
  -- concurrent writers could each observe an empty/incomplete history and
  -- commit cross-bound identities or terminal-before-start rows.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.process_ref, 0));

  -- The application uses ON CONFLICT DO NOTHING and re-reads the existing
  -- event to make retries idempotent. A BEFORE trigger runs before PostgreSQL
  -- checks that conflict, so let an existing same-event row win first. This
  -- also lets reconciliation finish after Goal cleanup removed the binding.
  IF EXISTS (
    SELECT 1 FROM ipython_session_journal
     WHERE process_ref = NEW.process_ref AND event = NEW.event
  ) THEN
    RETURN NULL;
  END IF;

  IF NEW.event = 'started' AND NOT EXISTS (
    SELECT 1 FROM goals
     WHERE goal_id = NEW.goal_id AND project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'IPython session journal Goal/project binding is invalid';
  END IF;
  IF NEW.event <> 'started' AND NEW.reason IS NULL THEN
    RAISE EXCEPTION 'IPython session journal non-start event requires a reason';
  END IF;

  SELECT * INTO first_row
    FROM ipython_session_journal
   WHERE process_ref = NEW.process_ref
   ORDER BY journal_position
   LIMIT 1;

  IF NOT FOUND THEN
    IF NEW.event <> 'started' THEN
      RAISE EXCEPTION 'IPython session journal lifecycle must start with started evidence';
    END IF;
    RETURN NEW;
  END IF;

  -- A process_ref names one immutable process generation. Every lifecycle
  -- event must retain the same session, Goal, process identity, and captured
  -- process-group identity as its first durable event.
  IF NEW.session_id IS DISTINCT FROM first_row.session_id
     OR NEW.project_id IS DISTINCT FROM first_row.project_id
     OR NEW.goal_id IS DISTINCT FROM first_row.goal_id
     OR NEW.process_pid IS DISTINCT FROM first_row.process_pid
     OR NEW.parent_pid IS DISTINCT FROM first_row.parent_pid
     OR NEW.details->>'process_group_id' IS DISTINCT FROM first_row.details->>'process_group_id'
     OR NEW.details->>'process_session_id' IS DISTINCT FROM first_row.details->>'process_session_id'
     OR NEW.details->>'process_start_time' IS DISTINCT FROM first_row.details->>'process_start_time' THEN
    RAISE EXCEPTION 'IPython session journal process generation identity changed';
  END IF;

  SELECT EXISTS (SELECT 1 FROM ipython_session_journal WHERE process_ref = NEW.process_ref AND event = 'started') INTO has_started;
  SELECT EXISTS (SELECT 1 FROM ipython_session_journal WHERE process_ref = NEW.process_ref AND event = 'orphaned') INTO has_orphaned;
  SELECT EXISTS (SELECT 1 FROM ipython_session_journal WHERE process_ref = NEW.process_ref AND event IN ('reaped', 'completed', 'failed', 'cancelled', 'unknown')) INTO has_terminal;

  IF has_terminal THEN
    -- A concurrent terminal decision may have won with a different terminal
    -- event. Return NULL so the adapter can re-read and report a typed
    -- idempotency conflict instead of leaking a trigger ordering error.
    IF NEW.event IN ('reaped', 'completed', 'failed', 'cancelled', 'unknown') THEN
      RETURN NULL;
    END IF;
    RAISE EXCEPTION 'IPython session journal lifecycle is already terminal';
  END IF;
  IF NEW.event = 'started' THEN
    RAISE EXCEPTION 'IPython session journal started evidence already exists';
  END IF;
  IF NEW.event = 'orphaned' AND (NOT has_started OR has_orphaned) THEN
    RAISE EXCEPTION 'IPython session journal orphan evidence is out of order';
  END IF;
  IF NEW.event IN ('reaped', 'completed', 'failed', 'cancelled', 'unknown') AND (NOT has_started OR NOT has_orphaned) THEN
    RAISE EXCEPTION 'IPython session journal terminal evidence requires orphan evidence';
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
DROP TRIGGER IF EXISTS ipython_session_journal_no_truncate ON ipython_session_journal;
CREATE TRIGGER ipython_session_journal_no_truncate
BEFORE TRUNCATE ON ipython_session_journal
FOR EACH STATEMENT EXECUTE FUNCTION reject_ipython_session_journal_mutation();

DO $$
DECLARE journal_schema text := current_schema();
BEGIN
  EXECUTE pg_catalog.format(
    'ALTER FUNCTION %I.validate_ipython_session_journal_scope() SET search_path = pg_catalog, %I',
    journal_schema, journal_schema
  );
END;
$$;
