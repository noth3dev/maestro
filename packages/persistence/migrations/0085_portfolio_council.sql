-- Plan 5 §S4: immutable Portfolio Council decisions and execution fences.
-- A round is a sealed decision packet. Reallocation fences are stored separately
-- so an old execution token can never be silently reused.
CREATE TABLE IF NOT EXISTS portfolio_council_rounds (
  round_id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  council_id uuid NOT NULL,
  command_id text NOT NULL CHECK (btrim(command_id) <> ''),
  trigger text NOT NULL CHECK (trigger IN ('capacity_conflict', 'incident_preemption', 'reconsideration')),
  status text NOT NULL CHECK (status IN ('decided', 'escalated')),
  execution_disposition text NOT NULL CHECK (execution_disposition IN ('executable', 'non_executable')),
  precedence text NOT NULL CHECK (precedence IN ('portfolio_council', 'discord_safety_preemption')),
  confidence numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  decision jsonb NOT NULL CHECK (jsonb_typeof(decision) = 'object'),
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  actor_id text NOT NULL CHECK (btrim(actor_id) <> ''),
  session_ref text NOT NULL CHECK (btrim(session_ref) <> ''),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (command_id)
);
CREATE INDEX IF NOT EXISTS portfolio_council_rounds_council_idx
  ON portfolio_council_rounds (council_id, created_at, round_id);
CREATE INDEX IF NOT EXISTS portfolio_council_rounds_project_idx
  ON portfolio_council_rounds (project_id, created_at, round_id);

CREATE TABLE IF NOT EXISTS portfolio_execution_fences (
  fence_id uuid PRIMARY KEY,
  round_id uuid NOT NULL REFERENCES portfolio_council_rounds(round_id),
  project_id uuid NOT NULL,
  goal_id uuid NOT NULL REFERENCES goals(goal_id),
  previous_execution_ref text NOT NULL CHECK (btrim(previous_execution_ref) <> ''),
  previous_fencing_token text NOT NULL CHECK (btrim(previous_fencing_token) <> ''),
  next_fencing_token text NOT NULL CHECK (btrim(next_fencing_token) <> ''),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (round_id, goal_id)
);
CREATE INDEX IF NOT EXISTS portfolio_execution_fences_goal_idx
  ON portfolio_execution_fences (goal_id, created_at, fence_id);

CREATE OR REPLACE FUNCTION validate_portfolio_council_round() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE goal_entry jsonb; action_entry jsonb; goal_uuid uuid;
BEGIN
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Portfolio Council rounds are append-only';
  END IF;
  IF NEW.decision->>'councilId' IS DISTINCT FROM NEW.council_id::text
     OR NEW.decision->>'commandId' IS DISTINCT FROM NEW.command_id
     OR NEW.decision->>'trigger' IS DISTINCT FROM NEW.trigger
     OR NEW.decision->>'status' IS DISTINCT FROM NEW.status
     OR NEW.decision->>'executionDisposition' IS DISTINCT FROM NEW.execution_disposition
     OR NEW.decision->>'precedence' IS DISTINCT FROM NEW.precedence
     OR (NEW.decision->>'confidence')::numeric IS DISTINCT FROM NEW.confidence THEN
    RAISE EXCEPTION 'Portfolio Council round projection does not match its decision packet';
  END IF;
  IF jsonb_typeof(NEW.decision->'goals') <> 'array' OR jsonb_array_length(NEW.decision->'goals') = 0 THEN
    RAISE EXCEPTION 'Portfolio Council decision must capture at least one Goal';
  END IF;
  FOR goal_entry IN SELECT value FROM jsonb_array_elements(NEW.decision->'goals') LOOP
    BEGIN goal_uuid := (goal_entry->>'goalId')::uuid; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Portfolio Council Goal identity is invalid'; END;
    IF goal_entry->>'projectId' IS DISTINCT FROM NEW.project_id::text THEN
      RAISE EXCEPTION 'Portfolio Council Goal project binding is invalid';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM goals WHERE goal_id = goal_uuid AND project_id = NEW.project_id) THEN
      RAISE EXCEPTION 'Portfolio Council Goal is outside the project boundary';
    END IF;
  END LOOP;
  FOR action_entry IN SELECT value FROM jsonb_array_elements(COALESCE(NEW.decision->'actions', '[]'::jsonb)) LOOP
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.decision->'goals') captured WHERE captured->>'goalId' = action_entry->>'goalId') THEN
      RAISE EXCEPTION 'Portfolio Council action names an uncaptured Goal';
    END IF;
  END LOOP;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS portfolio_council_round_guard ON portfolio_council_rounds;
CREATE TRIGGER portfolio_council_round_guard
  BEFORE INSERT OR UPDATE OR DELETE ON portfolio_council_rounds
  FOR EACH ROW EXECUTE FUNCTION validate_portfolio_council_round();

CREATE OR REPLACE FUNCTION validate_portfolio_execution_fence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Portfolio execution fences are append-only';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM goals WHERE goal_id = NEW.goal_id AND project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'Portfolio execution fence Goal/project binding is invalid';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM portfolio_council_rounds WHERE round_id = NEW.round_id AND project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'Portfolio execution fence round/project binding is invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements((SELECT decision FROM portfolio_council_rounds WHERE round_id = NEW.round_id)->'actions') action
    WHERE action->>'goalId' = NEW.goal_id::text
      AND (action->'executionFence'->>'previousExecutionRef') = NEW.previous_execution_ref
      AND (action->'executionFence'->>'previousFencingToken') = NEW.previous_fencing_token
      AND (action->'executionFence'->>'nextFencingToken') = NEW.next_fencing_token
  ) THEN RAISE EXCEPTION 'Portfolio execution fence is not declared by its decision'; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS portfolio_execution_fence_guard ON portfolio_execution_fences;
CREATE TRIGGER portfolio_execution_fence_guard
  BEFORE INSERT OR UPDATE OR DELETE ON portfolio_execution_fences
  FOR EACH ROW EXECUTE FUNCTION validate_portfolio_execution_fence();
