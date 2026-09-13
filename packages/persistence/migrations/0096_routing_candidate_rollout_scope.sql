-- Plan 6 S10: routing candidates must carry the exact role/task rollout scope
-- enforced by the bounded rollout controller. Existing installations receive
-- the same payload validation as fresh installations without rewriting rows.
DO $$
DECLARE
  schema_name text := quote_ident(current_schema());
BEGIN
  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION %1$s.validate_improvement_candidate_payload(value jsonb) RETURNS void
    LANGUAGE plpgsql SET search_path = pg_catalog, %1$s
    AS $body$
    DECLARE
      item jsonb;
      axis text;
      previous_axis text[] := ARRAY[]::text[];
      metric_name text;
      previous_metric_name text[] := ARRAY[]::text[];
      scenario_name text;
      previous_scenario_name text[] := ARRAY[]::text[];
      number_value double precision;
    BEGIN
      IF jsonb_typeof(value) <> 'object' OR value->>'schemaVersion' <> '1' OR value->>'kind' NOT IN ('persona_axis', 'routing_capability_axis') THEN RAISE EXCEPTION 'candidate payload shape is invalid'; END IF;
      IF jsonb_typeof(value->'target') <> 'object' THEN RAISE EXCEPTION 'candidate target shape is invalid'; END IF;
      IF value->>'kind' = 'persona_axis' THEN
        IF value->'target' ? 'routingTarget' OR NOT (value->'target' ? 'roleId' OR value->'target' ? 'taskClass') OR EXISTS (SELECT 1 FROM jsonb_object_keys(value->'target') AS fields(key) WHERE key NOT IN ('roleId','taskClass')) OR (SELECT count(*) FROM jsonb_object_keys(value->'target')) NOT BETWEEN 1 AND 2 THEN RAISE EXCEPTION 'persona candidate target shape is invalid'; END IF;
      ELSE
        IF NOT (value->'target' ? 'routingTarget') OR NOT (value->'target' ? 'roleId') OR NOT (value->'target' ? 'taskClass') OR (SELECT count(*) FROM jsonb_object_keys(value->'target')) <> 3 THEN RAISE EXCEPTION 'routing candidate target shape is invalid'; END IF;
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_each(value->'target') AS fields(key, val) WHERE jsonb_typeof(val) <> 'string' OR NOT coalesce(%1$s.improvement_candidate_text_is_safe(val #>> '{}', 256), false)) THEN RAISE EXCEPTION 'candidate target text is invalid'; END IF;
      IF jsonb_typeof(value->'changes') <> 'array' OR jsonb_array_length(value->'changes') NOT BETWEEN 1 AND 2 THEN RAISE EXCEPTION 'candidate changes shape is invalid'; END IF;
      FOR item IN SELECT change FROM jsonb_array_elements(value->'changes') AS changes(change) LOOP
        IF jsonb_typeof(item) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 3 OR NOT (item ? 'axis') OR jsonb_typeof(item->'axis') <> 'string' OR NOT (item ? 'currentValue') OR NOT (item ? 'proposedValue') OR jsonb_typeof(item->'currentValue') <> 'number' OR jsonb_typeof(item->'proposedValue') <> 'number' THEN RAISE EXCEPTION 'candidate change shape is invalid'; END IF;
        IF NOT coalesce(%1$s.improvement_candidate_text_is_safe(item->>'axis', 256), false) THEN RAISE EXCEPTION 'candidate change axis text is invalid'; END IF;
        axis := item->>'axis';
        IF axis = ANY(previous_axis) OR (value->>'kind' = 'persona_axis' AND axis NOT IN ('agreeableness','extraversion','imagination','realism','conscientiousness','caution','initiative','empathy','adaptability','sociability')) OR (value->>'kind' = 'routing_capability_axis' AND axis NOT IN ('reasoning','coding','verification','instruction-fidelity','tool-use','long-context','knowledge','refusal-calibration')) THEN RAISE EXCEPTION 'candidate change axis is invalid'; END IF;
        previous_axis := array_append(previous_axis, axis);
        number_value := (item->>'currentValue')::double precision;
        IF value->>'kind' = 'persona_axis' AND (number_value < 0 OR number_value > 1) THEN RAISE EXCEPTION 'persona candidate value is out of range'; END IF;
        IF value->>'kind' = 'routing_capability_axis' AND (number_value < 0 OR number_value > 200 OR item->>'currentValue' !~ '^[0-9]+$') THEN RAISE EXCEPTION 'routing candidate value is invalid'; END IF;
        number_value := (item->>'proposedValue')::double precision;
        IF value->>'kind' = 'persona_axis' AND (number_value < 0 OR number_value > 1) THEN RAISE EXCEPTION 'persona candidate value is out of range'; END IF;
        IF value->>'kind' = 'routing_capability_axis' AND (number_value < 0 OR number_value > 200 OR item->>'proposedValue' !~ '^[0-9]+$') THEN RAISE EXCEPTION 'routing candidate value is invalid'; END IF;
        IF item->>'currentValue' = item->>'proposedValue' THEN RAISE EXCEPTION 'candidate change must alter its axis'; END IF;
      END LOOP;
      IF jsonb_typeof(value->'sourceEvidenceIds') <> 'array' OR jsonb_array_length(value->'sourceEvidenceIds') NOT BETWEEN 1 AND 32 OR (SELECT count(*) FROM jsonb_array_elements_text(value->'sourceEvidenceIds')) <> (SELECT count(DISTINCT source_id) FROM jsonb_array_elements_text(value->'sourceEvidenceIds') AS sources(source_id)) THEN RAISE EXCEPTION 'candidate source evidence shape is invalid'; END IF;
      IF jsonb_typeof(value->'expectedMetrics') <> 'array' OR jsonb_array_length(value->'expectedMetrics') NOT BETWEEN 1 AND 16 THEN RAISE EXCEPTION 'candidate expected metrics shape is invalid'; END IF;
      FOR item IN SELECT metric FROM jsonb_array_elements(value->'expectedMetrics') AS metrics(metric) LOOP
        IF jsonb_typeof(item) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(item)) NOT BETWEEN 3 AND 4 OR EXISTS (SELECT 1 FROM jsonb_object_keys(item) AS fields(key) WHERE key NOT IN ('name','unit','direction','target')) OR NOT (item ? 'name') OR jsonb_typeof(item->'name') <> 'string' OR NOT (item ? 'unit') OR jsonb_typeof(item->'unit') <> 'string' OR NOT (item ? 'direction') OR jsonb_typeof(item->'direction') <> 'string' OR btrim(item->>'name') = '' OR length(item->>'name') > 128 OR btrim(item->>'unit') = '' OR length(item->>'unit') > 64 OR item->>'direction' NOT IN ('increase','decrease','maintain') OR (item ? 'target' AND jsonb_typeof(item->'target') <> 'number') THEN RAISE EXCEPTION 'candidate expected metric shape is invalid'; END IF;
        IF NOT coalesce(%1$s.improvement_candidate_text_is_safe(item->>'name', 128), false) OR NOT coalesce(%1$s.improvement_candidate_text_is_safe(item->>'unit', 64), false) THEN RAISE EXCEPTION 'candidate metric text is invalid'; END IF;
        metric_name := item->>'name';
        IF metric_name = ANY(previous_metric_name) THEN RAISE EXCEPTION 'candidate expected metric names must be unique'; END IF;
        previous_metric_name := array_append(previous_metric_name, metric_name);
      END LOOP;
      previous_metric_name := ARRAY[]::text[];
      IF jsonb_typeof(value->'protectedMetrics') <> 'array' OR jsonb_array_length(value->'protectedMetrics') NOT BETWEEN 1 AND 16 THEN RAISE EXCEPTION 'candidate protected metrics shape is invalid'; END IF;
      FOR item IN SELECT metric FROM jsonb_array_elements(value->'protectedMetrics') AS metrics(metric) LOOP
        IF jsonb_typeof(item) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(item)) NOT BETWEEN 3 AND 4 OR EXISTS (SELECT 1 FROM jsonb_object_keys(item) AS fields(key) WHERE key NOT IN ('name','unit','minimum','maximum')) OR NOT (item ? 'name') OR jsonb_typeof(item->'name') <> 'string' OR NOT (item ? 'unit') OR jsonb_typeof(item->'unit') <> 'string' OR btrim(item->>'name') = '' OR length(item->>'name') > 128 OR btrim(item->>'unit') = '' OR length(item->>'unit') > 64 OR NOT (item ? 'minimum' OR item ? 'maximum') OR (item ? 'minimum' AND jsonb_typeof(item->'minimum') <> 'number') OR (item ? 'maximum' AND jsonb_typeof(item->'maximum') <> 'number') OR (item ? 'minimum' AND item ? 'maximum' AND (item->>'minimum')::double precision > (item->>'maximum')::double precision) THEN RAISE EXCEPTION 'candidate protected metric shape is invalid'; END IF;
        IF NOT coalesce(%1$s.improvement_candidate_text_is_safe(item->>'name', 128), false) OR NOT coalesce(%1$s.improvement_candidate_text_is_safe(item->>'unit', 64), false) THEN RAISE EXCEPTION 'candidate metric text is invalid'; END IF;
        metric_name := item->>'name';
        IF metric_name = ANY(previous_metric_name) THEN RAISE EXCEPTION 'candidate metric names must be unique'; END IF;
        previous_metric_name := array_append(previous_metric_name, metric_name);
      END LOOP;
      IF jsonb_typeof(value->'scenarioSuite') <> 'array' OR jsonb_array_length(value->'scenarioSuite') NOT BETWEEN 1 AND 32 OR EXISTS (SELECT 1 FROM jsonb_array_elements(value->'scenarioSuite') AS scenarios(element) WHERE jsonb_typeof(element) <> 'string' OR NOT coalesce(%1$s.improvement_candidate_text_is_safe(element #>> '{}', 256), false)) OR (SELECT count(*) FROM jsonb_array_elements_text(value->'scenarioSuite')) <> (SELECT count(DISTINCT scenario_id) FROM jsonb_array_elements_text(value->'scenarioSuite') AS scenarios(scenario_id)) THEN RAISE EXCEPTION 'candidate scenario suite shape is invalid'; END IF;
      IF NOT coalesce(%1$s.improvement_candidate_text_is_safe(value->>'evidencePattern', 4096), false) OR NOT coalesce(%1$s.improvement_candidate_text_is_safe(value->>'predictedEffect', 4096), false) THEN RAISE EXCEPTION 'candidate evidence text is invalid'; END IF;
      IF jsonb_typeof(value->'confidence') <> 'number' OR (value->>'confidence')::double precision < 0 OR (value->>'confidence')::double precision > 1 THEN RAISE EXCEPTION 'candidate confidence is invalid'; END IF;
      IF jsonb_typeof(value->'dataSufficiency') <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(value->'dataSufficiency')) <> 2 OR NOT (value->'dataSufficiency' ? 'episodeCount') OR jsonb_typeof(value->'dataSufficiency'->'episodeCount') <> 'number' OR NOT (value->'dataSufficiency' ? 'comparableGoalCount') OR jsonb_typeof(value->'dataSufficiency'->'comparableGoalCount') <> 'number' OR value->'dataSufficiency'->>'episodeCount' !~ '^[1-9][0-9]*$' OR value->'dataSufficiency'->>'comparableGoalCount' !~ '^[1-9][0-9]*$' OR (value->'dataSufficiency'->>'comparableGoalCount')::numeric > (value->'dataSufficiency'->>'episodeCount')::numeric THEN RAISE EXCEPTION 'candidate data sufficiency is invalid'; END IF;
      IF jsonb_typeof(value->'rollbackTarget') <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(value->'rollbackTarget')) <> 3 OR NOT (value->'rollbackTarget' ? 'candidateId') OR jsonb_typeof(value->'rollbackTarget'->'candidateId') <> 'string' OR NOT (value->'rollbackTarget' ? 'version') OR jsonb_typeof(value->'rollbackTarget'->'version') <> 'number' OR NOT (value->'rollbackTarget' ? 'contentHash') OR jsonb_typeof(value->'rollbackTarget'->'contentHash') <> 'string' OR value->'rollbackTarget'->>'candidateId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR value->'rollbackTarget'->>'version' !~ '^[1-9][0-9]*$' OR value->'rollbackTarget'->>'contentHash' !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'candidate rollback target shape is invalid'; END IF;
    END;
    $body$;
  $fn$, schema_name);
END $$;

REVOKE EXECUTE ON FUNCTION validate_improvement_candidate_payload(jsonb) FROM PUBLIC;
