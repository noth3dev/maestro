-- Plan 5 §S4 remediation: additive integrity hardening for Portfolio Council packets.
-- 0085 is immutable after application; all checksum-sensitive changes live here.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Do not let unrelated test/control-plane Goal truncation cascade into this audit table.
-- Goal/project integrity is enforced by the append-only trigger below.
ALTER TABLE portfolio_execution_fences DROP CONSTRAINT IF EXISTS portfolio_execution_fences_goal_id_fkey;

ALTER TABLE portfolio_council_rounds
  ADD COLUMN IF NOT EXISTS project_ids uuid[];
UPDATE portfolio_council_rounds
SET project_ids = ARRAY[project_id]
WHERE project_ids IS NULL;
ALTER TABLE portfolio_council_rounds
  ALTER COLUMN project_ids SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portfolio_council_rounds_project_ids_nonempty') THEN
    ALTER TABLE portfolio_council_rounds ADD CONSTRAINT portfolio_council_rounds_project_ids_nonempty CHECK (cardinality(project_ids) > 0);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION portfolio_canonical_json(value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE jsonb_typeof(value)
    WHEN 'object' THEN '{' || COALESCE((
      SELECT string_agg(to_jsonb(key)::text || ':' || portfolio_canonical_json(item), ',' ORDER BY key COLLATE "C")
      FROM jsonb_each(value) AS entries(key, item)
    ), '') || '}'
    WHEN 'array' THEN '[' || COALESCE((
      SELECT string_agg(portfolio_canonical_json(item), ',' ORDER BY ordinal)
      FROM jsonb_array_elements(value) WITH ORDINALITY AS entries(item, ordinal)
    ), '') || ']'
    WHEN 'string' THEN to_jsonb(value #>> '{}')::text
    WHEN 'null' THEN 'null'
    ELSE value #>> '{}'
  END
$$;

CREATE OR REPLACE FUNCTION validate_portfolio_council_round() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  goal_entry jsonb;
  action_entry jsonb;
  evidence_ref text;
  goal_uuid uuid;
  evidence_uuid uuid;
  goal_count integer;
  action_count integer;
  project_count integer;
  seen_goal_ids text[] := ARRAY[]::text[];
  action_goal_id text;
  action_disposition text;
  allocation jsonb;
  fence jsonb;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN RAISE EXCEPTION 'Portfolio Council rounds are append-only'; END IF;
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Portfolio Council rounds are append-only'; END IF;
  IF NEW.project_id <> ALL(NEW.project_ids) THEN RAISE EXCEPTION 'Portfolio Council primary project is not captured'; END IF;
  IF NEW.decision->>'schemaVersion' IS DISTINCT FROM '1'
     OR jsonb_typeof(NEW.decision->'evidenceReferences') <> 'array'
     OR jsonb_array_length(NEW.decision->'evidenceReferences') = 0
     OR jsonb_typeof(NEW.decision->'dissent') <> 'array'
     OR jsonb_typeof(NEW.decision->'reconsiderationTriggers') <> 'array'
     OR jsonb_typeof(NEW.decision->'routingEscalations') <> 'array' THEN
    RAISE EXCEPTION 'Portfolio Council decision packet schema is invalid';
  END IF;
  IF (NEW.confidence <> 0 AND NEW.confidence < 0.000001)
     OR (NEW.decision->'discordPreemption'->>'confidence') IS NOT NULL
        AND (NEW.decision->'discordPreemption'->>'confidence')::numeric <> 0
        AND (NEW.decision->'discordPreemption'->>'confidence')::numeric < 0.000001 THEN
    RAISE EXCEPTION 'Portfolio Council probabilities below 0.000001 are not serializable';
  END IF;
  IF encode(digest(convert_to(portfolio_canonical_json(NEW.decision), 'UTF8'), 'sha256'), 'hex') <> NEW.content_hash THEN
    RAISE EXCEPTION 'Portfolio Council content hash does not match its decision packet';
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
  SELECT jsonb_array_length(NEW.decision->'goals') INTO goal_count;
  SELECT count(DISTINCT (entry->>'projectId')::uuid) INTO project_count FROM jsonb_array_elements(NEW.decision->'goals') entry;
  IF project_count <> cardinality(NEW.project_ids)
     OR EXISTS (SELECT 1 FROM unnest(NEW.project_ids) p WHERE p NOT IN (SELECT DISTINCT (entry->>'projectId')::uuid FROM jsonb_array_elements(NEW.decision->'goals') entry)) THEN
    RAISE EXCEPTION 'Portfolio Council project bindings are incomplete or contain unrelated projects';
  END IF;
  FOR goal_entry IN SELECT value FROM jsonb_array_elements(NEW.decision->'goals') LOOP
    BEGIN goal_uuid := (goal_entry->>'goalId')::uuid; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Portfolio Council Goal identity is invalid'; END;
    IF NOT EXISTS (SELECT 1 FROM goals WHERE goal_id = goal_uuid AND project_id = (goal_entry->>'projectId')::uuid) THEN
      RAISE EXCEPTION 'Portfolio Council Goal is outside the project boundary';
    END IF;
  END LOOP;
  action_count := jsonb_array_length(COALESCE(NEW.decision->'actions', '[]'::jsonb));
  IF (NEW.status = 'decided' AND action_count <> goal_count)
     OR (NEW.status = 'escalated' AND action_count NOT IN (0, goal_count)) THEN
    RAISE EXCEPTION 'Portfolio Council action completeness is invalid';
  END IF;
  FOR action_entry IN SELECT value FROM jsonb_array_elements(COALESCE(NEW.decision->'actions', '[]'::jsonb)) LOOP
    action_goal_id := action_entry->>'goalId';
    IF action_goal_id IS NULL OR action_goal_id = ANY(seen_goal_ids) THEN RAISE EXCEPTION 'Portfolio Council actions must name each Goal once'; END IF;
    seen_goal_ids := array_append(seen_goal_ids, action_goal_id);
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.decision->'goals') captured WHERE captured->>'goalId' = action_goal_id) THEN
      RAISE EXCEPTION 'Portfolio Council action names an uncaptured Goal';
    END IF;
    IF action_entry->>'disposition' IS NULL OR NOT (action_entry->>'disposition' = ANY(ARRAY['continue', 'queue', 'pause', 'preempt']))
       OR jsonb_typeof(action_entry->'order') <> 'number'
       OR (action_entry->>'order')::numeric < 0
       OR floor((action_entry->>'order')::numeric) <> (action_entry->>'order')::numeric
       OR btrim(action_entry->>'rationale') = '' THEN
      RAISE EXCEPTION 'Portfolio Council action fields are invalid';
    END IF;
    allocation := action_entry->'allocation';
    IF jsonb_typeof(allocation) <> 'object'
       OR allocation->>'providerRate' IS NULL OR allocation->>'spendCents' IS NULL OR allocation->>'workerSlots' IS NULL
       OR (allocation->>'providerRate')::numeric < 0 OR floor((allocation->>'providerRate')::numeric) <> (allocation->>'providerRate')::numeric
       OR (allocation->>'spendCents')::numeric < 0 OR floor((allocation->>'spendCents')::numeric) <> (allocation->>'spendCents')::numeric
       OR (allocation->>'workerSlots')::numeric < 0 OR floor((allocation->>'workerSlots')::numeric) <> (allocation->>'workerSlots')::numeric THEN
      RAISE EXCEPTION 'Portfolio Council action allocation is invalid';
    END IF;
    action_disposition := action_entry->>'disposition';
    fence := action_entry->'executionFence';
    IF action_disposition IN ('pause', 'preempt') AND jsonb_typeof(fence) <> 'object' THEN RAISE EXCEPTION 'Portfolio Council pause/preempt action requires an execution fence'; END IF;
    IF action_disposition IN ('pause', 'preempt') AND ((allocation->>'providerRate')::numeric <> 0 OR (allocation->>'spendCents')::numeric <> 0 OR (allocation->>'workerSlots')::numeric <> 0) THEN
      RAISE EXCEPTION 'Portfolio Council pause/preempt action must release allocation';
    END IF;
    IF jsonb_typeof(fence) = 'object' AND (
      fence->>'previousExecutionRef' IS NULL OR btrim(fence->>'previousExecutionRef') = ''
      OR fence->>'previousFencingToken' IS NULL OR fence->>'nextFencingToken' IS NULL
      OR fence->>'previousFencingToken' !~ '^[1-9][0-9]*$' OR fence->>'nextFencingToken' !~ '^[1-9][0-9]*$'
      OR length(fence->>'previousFencingToken') > 19 OR length(fence->>'nextFencingToken') > 19
      OR NOT (length(fence->>'nextFencingToken') > length(fence->>'previousFencingToken')
        OR (length(fence->>'nextFencingToken') = length(fence->>'previousFencingToken') AND fence->>'nextFencingToken' > fence->>'previousFencingToken'))
    ) THEN
      RAISE EXCEPTION 'Portfolio Council execution fence tokens are invalid';
    END IF;
  END LOOP;
  IF NEW.status = 'decided' AND action_count <> cardinality(seen_goal_ids) THEN RAISE EXCEPTION 'Portfolio Council decided packet is incomplete'; END IF;
  FOR evidence_ref IN SELECT value FROM jsonb_array_elements_text(NEW.decision->'evidenceReferences') LOOP
    BEGIN evidence_uuid := evidence_ref::uuid; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Portfolio Council evidence reference is not a UUID'; END;
    IF NOT EXISTS (
      SELECT 1 FROM evidence_records e
      WHERE e.evidence_id = evidence_uuid
        AND e.goal_id IN (SELECT (captured->>'goalId')::uuid FROM jsonb_array_elements(NEW.decision->'goals') captured)
        AND e.project_id = ANY(NEW.project_ids)
    ) THEN RAISE EXCEPTION 'Portfolio Council evidence reference is not durable or project-bound'; END IF;
  END LOOP;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION validate_portfolio_execution_fence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN RAISE EXCEPTION 'Portfolio execution fences are append-only'; END IF;
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Portfolio execution fences are append-only'; END IF;
  IF NEW.previous_fencing_token !~ '^[1-9][0-9]*$'
     OR NEW.next_fencing_token !~ '^[1-9][0-9]*$'
     OR length(NEW.previous_fencing_token) > 19 OR length(NEW.next_fencing_token) > 19
     OR (length(NEW.previous_fencing_token) = 19 AND NEW.previous_fencing_token > '9223372036854775807')
     OR (length(NEW.next_fencing_token) = 19 AND NEW.next_fencing_token > '9223372036854775807')
     OR NOT (length(NEW.next_fencing_token) > length(NEW.previous_fencing_token)
       OR (length(NEW.next_fencing_token) = length(NEW.previous_fencing_token) AND NEW.next_fencing_token > NEW.previous_fencing_token)) THEN
    RAISE EXCEPTION 'Portfolio execution fence tokens are invalid';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM goals WHERE goal_id = NEW.goal_id AND project_id = NEW.project_id) THEN RAISE EXCEPTION 'Portfolio execution fence Goal/project binding is invalid'; END IF;
  IF NOT EXISTS (SELECT 1 FROM portfolio_council_rounds WHERE round_id = NEW.round_id AND NEW.project_id = ANY(project_ids)) THEN RAISE EXCEPTION 'Portfolio execution fence round/project binding is invalid'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements((SELECT decision FROM portfolio_council_rounds WHERE round_id = NEW.round_id)->'actions') action
    WHERE action->>'goalId' = NEW.goal_id::text
      AND (action->'executionFence'->>'previousExecutionRef') = NEW.previous_execution_ref
      AND (action->'executionFence'->>'previousFencingToken') = NEW.previous_fencing_token
      AND (action->'executionFence'->>'nextFencingToken') = NEW.next_fencing_token
  ) THEN RAISE EXCEPTION 'Portfolio execution fence is not declared by its decision'; END IF;
  RETURN NEW;
END; $$;
