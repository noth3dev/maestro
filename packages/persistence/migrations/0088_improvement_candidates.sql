-- Plan 6 S2: one append-only lifecycle for persona and routing improvement candidates.
-- Each version has its own immutable candidate_id and points to the prior version.
CREATE TABLE IF NOT EXISTS improvement_candidates (
  candidate_id uuid PRIMARY KEY,
  lineage_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  parent_candidate_id uuid REFERENCES improvement_candidates(candidate_id) ON DELETE RESTRICT,
  schema_version integer NOT NULL CHECK (schema_version = 1),
  project_id uuid NOT NULL,
  goal_id uuid NOT NULL REFERENCES goals(goal_id),
  kind text NOT NULL CHECK (kind IN ('persona_axis', 'routing_capability_axis')),
  target jsonb NOT NULL CHECK (jsonb_typeof(target) = 'object'),
  changes jsonb NOT NULL CHECK (jsonb_typeof(changes) = 'array' AND jsonb_array_length(changes) BETWEEN 1 AND 2),
  source_evidence_ids jsonb NOT NULL CHECK (jsonb_typeof(source_evidence_ids) = 'array' AND jsonb_array_length(source_evidence_ids) BETWEEN 1 AND 32),
  evidence_pattern text NOT NULL CHECK (btrim(evidence_pattern) <> '' AND length(evidence_pattern) <= 4096),
  predicted_effect text NOT NULL CHECK (btrim(predicted_effect) <> '' AND length(predicted_effect) <= 4096),
  expected_metrics jsonb NOT NULL CHECK (jsonb_typeof(expected_metrics) = 'array' AND jsonb_array_length(expected_metrics) BETWEEN 1 AND 16),
  protected_metrics jsonb NOT NULL CHECK (jsonb_typeof(protected_metrics) = 'array' AND jsonb_array_length(protected_metrics) BETWEEN 1 AND 16),
  scenario_suite jsonb NOT NULL CHECK (jsonb_typeof(scenario_suite) = 'array' AND jsonb_array_length(scenario_suite) BETWEEN 1 AND 32),
  scenario_suite_hash char(64) NOT NULL CHECK (scenario_suite_hash ~ '^[0-9a-f]{64}$'),
  confidence double precision NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  data_sufficiency jsonb NOT NULL CHECK (jsonb_typeof(data_sufficiency) = 'object'),
  rollback_target jsonb NOT NULL CHECK (jsonb_typeof(rollback_target) = 'object'),
  state text NOT NULL CHECK (state IN ('candidate', 'evaluated', 'judged', 'applied', 'rejected', 'retained', 'rolled_back')),
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  author_id text NOT NULL CHECK (btrim(author_id) <> '' AND length(author_id) <= 256),
  author_operator_id uuid NOT NULL,
  author_role_id text NOT NULL CHECK (btrim(author_role_id) <> '' AND length(author_role_id) <= 256),
  session_ref text NOT NULL CHECK (btrim(session_ref) <> '' AND length(session_ref) <= 256),
  operation_ref text NOT NULL UNIQUE CHECK (btrim(operation_ref) <> '' AND length(operation_ref) <= 256),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime',
  UNIQUE (lineage_id, version),
  CHECK ((version = 1 AND parent_candidate_id IS NULL AND lineage_id = candidate_id) OR version > 1),
  CHECK (confidence = 0 OR confidence >= 0.000001)
);

CREATE INDEX IF NOT EXISTS improvement_candidates_project_idx ON improvement_candidates (project_id, goal_id, created_at, candidate_id);
CREATE INDEX IF NOT EXISTS improvement_candidates_lineage_idx ON improvement_candidates (lineage_id, version);
REVOKE ALL ON improvement_candidates FROM PUBLIC;

-- Profile/configuration baselines are registered by the owning profile store. A
-- candidate may point at either one of these immutable baselines or an already
-- persisted candidate version; both carry the project/Goal and content hash.
CREATE TABLE IF NOT EXISTS improvement_candidate_rollback_targets (
  target_candidate_id uuid NOT NULL,
  target_version integer NOT NULL CHECK (target_version >= 1),
  project_id uuid NOT NULL,
  goal_id uuid NOT NULL REFERENCES goals(goal_id),
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (target_candidate_id, target_version)
);
CREATE INDEX IF NOT EXISTS improvement_candidate_rollback_targets_scope_idx ON improvement_candidate_rollback_targets (project_id, goal_id);
REVOKE ALL ON improvement_candidate_rollback_targets FROM PUBLIC;

CREATE TABLE IF NOT EXISTS improvement_candidate_insert_authorizations (
  token_hash char(64) PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  candidate_id uuid NOT NULL,
  lineage_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  parent_candidate_id uuid,
  project_id uuid NOT NULL,
  goal_id uuid NOT NULL REFERENCES goals(goal_id),
  author_operator_id uuid NOT NULL,
  author_role_id text NOT NULL CHECK (btrim(author_role_id) <> '' AND length(author_role_id) <= 256),
  operation_ref text NOT NULL CHECK (btrim(operation_ref) <> '' AND length(operation_ref) <= 256),
  state text NOT NULL CHECK (state IN ('candidate', 'evaluated', 'judged', 'applied', 'rejected', 'retained', 'rolled_back')),
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
REVOKE ALL ON improvement_candidate_insert_authorizations FROM PUBLIC;

CREATE TABLE IF NOT EXISTS improvement_candidate_issuer_markers (
  transaction_id bigint PRIMARY KEY,
  token_hash char(64) NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
REVOKE ALL ON improvement_candidate_issuer_markers FROM PUBLIC;

DO $$
DECLARE
  schema_name text := quote_ident(current_schema());
BEGIN
  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION %1$s.improvement_candidate_json_numbers_stable(value jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = pg_catalog, %1$s
    AS $body$
    DECLARE
      item jsonb;
    BEGIN
      CASE jsonb_typeof(value)
        WHEN 'number' THEN
          RETURN value::numeric = 0 OR (abs(value::numeric) >= 0.000001 AND abs(value::numeric) < 1000000000000000000000);
        WHEN 'object' THEN
          FOR item IN SELECT val FROM jsonb_each(value) AS entries(key, val) LOOP
            IF NOT %1$s.improvement_candidate_json_numbers_stable(item) THEN RETURN false; END IF;
          END LOOP;
          RETURN true;
        WHEN 'array' THEN
          FOR item IN SELECT element FROM jsonb_array_elements(value) AS elements(element) LOOP
            IF NOT %1$s.improvement_candidate_json_numbers_stable(item) THEN RETURN false; END IF;
          END LOOP;
          RETURN true;
        ELSE
          RETURN true;
      END CASE;
    END;
    $body$;
  $fn$, schema_name);

  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION %1$s.improvement_candidate_text_is_safe(value text, maximum integer) RETURNS boolean
    LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog, %1$s
    AS $body$
      SELECT btrim(value) <> '' AND length(value) <= maximum AND value !~ E'[\r\n]' AND value !~* '(authorization[[:space:]]*:[[:space:]]*bearer|bearer[[:space:]]+|password[[:space:]]*[:=]|passwd[[:space:]]*[:=]|secret[[:space:]]*[:=]|api[_-]?key[[:space:]]*[:=]|access[_-]?token[[:space:]]*[:=]|private[_-]?key|credential[[:space:]]*[:=]|-----BEGIN|(^|[^a-z0-9])(sk|pk)-[a-z0-9_-]{16,}|eyj[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+|AKIA[0-9A-Z]{16}|gh[pousr]_[a-z0-9]{20,}|AIza[0-9a-z_-]{20,}|xox[baprs]-[0-9a-z-]{20,}|hf_[a-z0-9]{20,})';
    $body$;
  $fn$, schema_name);

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
        IF NOT (value->'target' ? 'routingTarget') OR (SELECT count(*) FROM jsonb_object_keys(value->'target')) <> 1 THEN RAISE EXCEPTION 'routing candidate target shape is invalid'; END IF;
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

  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION %1$s.improvement_candidate_canonical_json(value jsonb) RETURNS text
    LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = pg_catalog, %1$s
    AS $body$
    DECLARE
      members text;
      elements text;
    BEGIN
      CASE jsonb_typeof(value)
        WHEN 'object' THEN
          SELECT coalesce(string_agg(to_json(key)::text || ':' || %1$s.improvement_candidate_canonical_json(val), ',' ORDER BY key), '')
            INTO members FROM jsonb_each(value) AS object_items(key, val);
          RETURN '{' || members || '}';
        WHEN 'array' THEN
          SELECT coalesce(string_agg(%1$s.improvement_candidate_canonical_json(element), ',' ORDER BY ordinal), '')
            INTO elements FROM jsonb_array_elements(value) WITH ORDINALITY AS array_items(element, ordinal);
          RETURN '[' || elements || ']';
        ELSE
          RETURN value::text;
      END CASE;
    END;
    $body$;
  $fn$, schema_name);

  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION %1$s.reject_improvement_candidate_rollback_target_mutation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, %1$s
    AS $body$
    BEGIN
      RAISE EXCEPTION 'improvement candidate rollback targets are append-only';
    END;
    $body$;
  $fn$, schema_name);

  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION %1$s.reject_improvement_candidate_mutation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, %1$s
    AS $body$
    BEGIN
      RAISE EXCEPTION 'improvement candidates are append-only';
    END;
    $body$;
  $fn$, schema_name);

  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION %1$s.authorize_improvement_candidate_authorization_insert() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, %1$s
    AS $body$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM %1$s.improvement_candidate_issuer_markers m
         WHERE m.transaction_id = txid_current() AND m.token_hash = NEW.token_hash
      ) THEN
        RAISE EXCEPTION 'candidate authorization must be issued by secured function';
      END IF;
      DELETE FROM %1$s.improvement_candidate_issuer_markers
       WHERE transaction_id = txid_current() AND token_hash = NEW.token_hash;
      RETURN NEW;
    END;
    $body$;
  $fn$, schema_name);

  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION %1$s.authorize_improvement_candidate_marker_mutation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, %1$s
    AS $body$
    BEGIN
      IF TG_OP = 'INSERT' AND NEW.transaction_id = txid_current() AND NEW.token_hash = encode(public.digest(NULLIF(current_setting('maestro.improvement_candidate_token', true), ''), 'sha256'), 'hex') THEN
        RETURN NEW;
      END IF;
      IF TG_OP = 'DELETE' AND OLD.transaction_id = txid_current() AND OLD.token_hash = encode(public.digest(NULLIF(current_setting('maestro.improvement_candidate_token', true), ''), 'sha256'), 'hex') THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'candidate issuer markers are one-use';
    END;
    $body$;
  $fn$, schema_name);

  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION %1$s.reject_improvement_candidate_authorization_mutation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, %1$s
    AS $body$
    BEGIN
      IF TG_OP = 'DELETE' AND OLD.token_hash = encode(public.digest(NULLIF(current_setting('maestro.improvement_candidate_token', true), ''), 'sha256'), 'hex') THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'candidate authorizations are one-use';
    END;
    $body$;
  $fn$, schema_name);

  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION %1$s.validate_improvement_candidate_insert() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, %1$s
    AS $body$
    DECLARE
      token_hash_value char(64);
      expected_hash text;
      authorized %1$s.improvement_candidate_insert_authorizations%%ROWTYPE;
      source_id text;
      parent_row record;
    BEGIN
      token_hash_value := encode(public.digest(NULLIF(current_setting('maestro.improvement_candidate_token', true), ''), 'sha256'), 'hex');
      SELECT * INTO authorized FROM %1$s.improvement_candidate_insert_authorizations a WHERE a.token_hash = token_hash_value FOR UPDATE;
      IF NOT FOUND
         OR authorized.candidate_id IS DISTINCT FROM NEW.candidate_id
         OR authorized.lineage_id IS DISTINCT FROM NEW.lineage_id
         OR authorized.version IS DISTINCT FROM NEW.version
         OR authorized.parent_candidate_id IS DISTINCT FROM NEW.parent_candidate_id
         OR authorized.project_id IS DISTINCT FROM NEW.project_id
         OR authorized.goal_id IS DISTINCT FROM NEW.goal_id
         OR authorized.author_operator_id IS DISTINCT FROM NEW.author_operator_id
         OR authorized.author_role_id IS DISTINCT FROM NEW.author_role_id
         OR authorized.operation_ref IS DISTINCT FROM NEW.operation_ref
         OR authorized.state IS DISTINCT FROM NEW.state
         OR authorized.content_hash IS DISTINCT FROM NEW.content_hash
         OR authorized.payload IS DISTINCT FROM jsonb_build_object(
              'schemaVersion', NEW.schema_version, 'projectId', NEW.project_id, 'goalId', NEW.goal_id,
              'kind', NEW.kind, 'target', NEW.target, 'changes', NEW.changes, 'sourceEvidenceIds', NEW.source_evidence_ids,
              'evidencePattern', NEW.evidence_pattern, 'predictedEffect', NEW.predicted_effect,
              'expectedMetrics', NEW.expected_metrics, 'protectedMetrics', NEW.protected_metrics,
              'scenarioSuite', NEW.scenario_suite, 'scenarioSuiteHash', NEW.scenario_suite_hash,
              'confidence', NEW.confidence, 'dataSufficiency', NEW.data_sufficiency, 'rollbackTarget', NEW.rollback_target
            ) THEN
        RAISE EXCEPTION 'candidate insert is not bound to secured authorization';
      END IF;
      expected_hash := encode(public.digest(%1$s.improvement_candidate_canonical_json(authorized.payload), 'sha256'), 'hex');
      IF NEW.content_hash <> expected_hash THEN RAISE EXCEPTION 'candidate content hash is invalid'; END IF;
      IF NEW.version = 1 THEN
        IF NEW.parent_candidate_id IS NOT NULL OR NEW.lineage_id IS DISTINCT FROM NEW.candidate_id THEN RAISE EXCEPTION 'initial candidate lineage is invalid'; END IF;
      ELSE
        SELECT c.* INTO parent_row FROM %1$s.improvement_candidates c WHERE c.candidate_id = NEW.parent_candidate_id AND c.kind = NEW.kind FOR KEY SHARE;
        IF NOT FOUND OR parent_row.version + 1 <> NEW.version OR parent_row.lineage_id IS DISTINCT FROM NEW.lineage_id OR parent_row.project_id IS DISTINCT FROM NEW.project_id OR parent_row.goal_id IS DISTINCT FROM NEW.goal_id THEN
          RAISE EXCEPTION 'candidate parent lineage is invalid';
        END IF;
      END IF;
      IF jsonb_typeof(authorized.payload->'sourceEvidenceIds') <> 'array' OR jsonb_array_length(authorized.payload->'sourceEvidenceIds') = 0 THEN RAISE EXCEPTION 'candidate digest sources are required'; END IF;
      FOR source_id IN SELECT jsonb_array_elements_text(authorized.payload->'sourceEvidenceIds') LOOP
        IF source_id <> lower(source_id) OR NOT EXISTS (SELECT 1 FROM %1$s.improvement_digests d WHERE d.digest_id::text = source_id AND d.project_id = NEW.project_id AND d.goal_id = NEW.goal_id) THEN
          RAISE EXCEPTION 'candidate digest source is missing or outside the Goal';
        END IF;
      END LOOP;
      DELETE FROM %1$s.improvement_candidate_insert_authorizations WHERE token_hash = token_hash_value;
      RETURN NEW;
    END;
    $body$;
  $fn$, schema_name);

  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION %1$s.authorize_improvement_candidate_insert(
      p_token text, p_candidate_id uuid, p_lineage_id uuid, p_version integer, p_parent_candidate_id uuid,
      p_project_id uuid, p_goal_id uuid, p_author_operator_id uuid, p_author_role_id text, p_owner_id text,
      p_fencing_token bigint, p_operation_ref text, p_state text, p_content_hash text, p_payload jsonb
    ) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, %1$s
    AS $body$
    DECLARE
      canonical_hash text;
      field_name text;
    BEGIN
      IF btrim(coalesce(p_token, '')) = '' OR p_candidate_id IS NULL OR p_lineage_id IS NULL OR p_project_id IS NULL OR p_goal_id IS NULL
         OR p_version IS NULL OR p_version < 1 OR btrim(coalesce(p_owner_id, '')) = '' OR p_fencing_token IS NULL OR p_fencing_token <= 0
         OR btrim(coalesce(p_operation_ref, '')) = '' OR length(p_operation_ref) > 256 OR p_state IS NULL OR p_state NOT IN ('candidate', 'evaluated', 'judged', 'applied', 'rejected', 'retained', 'rolled_back') OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
        RAISE EXCEPTION 'candidate authorization context is invalid';
      END IF;
      canonical_hash := encode(public.digest(%1$s.improvement_candidate_canonical_json(p_payload), 'sha256'), 'hex');
      IF p_content_hash IS NULL OR p_content_hash <> canonical_hash THEN RAISE EXCEPTION 'candidate content hash is invalid'; END IF;
      FOREACH field_name IN ARRAY ARRAY['schemaVersion','projectId','goalId','kind','target','changes','sourceEvidenceIds','evidencePattern','predictedEffect','expectedMetrics','protectedMetrics','scenarioSuite','scenarioSuiteHash','confidence','dataSufficiency','rollbackTarget'] LOOP
        IF NOT (p_payload ? field_name) THEN RAISE EXCEPTION 'candidate payload is missing required field %%', field_name; END IF;
      END LOOP;
      PERFORM %1$s.validate_improvement_candidate_payload(p_payload);
      IF p_payload->>'projectId' <> lower(p_project_id::text) OR p_payload->>'goalId' <> lower(p_goal_id::text) THEN RAISE EXCEPTION 'candidate payload project or Goal is invalid'; END IF;
      IF p_payload->>'scenarioSuiteHash' <> encode(public.digest(%1$s.improvement_candidate_canonical_json(p_payload->'scenarioSuite'), 'sha256'), 'hex') THEN RAISE EXCEPTION 'candidate scenario suite hash is invalid'; END IF;
      IF NOT %1$s.improvement_candidate_json_numbers_stable(p_payload) THEN RAISE EXCEPTION 'candidate numeric values are outside the stable JSON range'; END IF;
      IF p_payload->>'kind' = 'routing_capability_axis' AND p_state = 'applied' THEN RAISE EXCEPTION 'routing capability candidates remain proposal-only'; END IF;
      IF NOT EXISTS (SELECT 1 FROM %1$s.goals g WHERE g.goal_id = p_goal_id AND g.project_id = p_project_id) THEN RAISE EXCEPTION 'candidate Goal/project binding is invalid'; END IF;
      IF NOT EXISTS (SELECT 1 FROM %1$s.local_operators o WHERE o.operator_id = p_author_operator_id AND o.active = true) THEN RAISE EXCEPTION 'candidate author operator is inactive'; END IF;
      IF NOT EXISTS (SELECT 1 FROM %1$s.operator_project_memberships m WHERE m.operator_id = p_author_operator_id AND m.project_id = p_project_id AND m.active = true) THEN RAISE EXCEPTION 'candidate author is not a project member'; END IF;
      IF NOT EXISTS (SELECT 1 FROM %1$s.operator_project_roles r WHERE r.operator_id = p_author_operator_id AND r.project_id = p_project_id AND r.role_id = p_author_role_id AND r.active = true) THEN RAISE EXCEPTION 'candidate author role is not active'; END IF;
      IF NOT EXISTS (SELECT 1 FROM %1$s.goal_leases l WHERE l.goal_id = p_goal_id AND l.owner_id = p_owner_id AND l.fencing_token = p_fencing_token AND l.expires_at > clock_timestamp()) THEN RAISE EXCEPTION 'candidate Goal lease proof is stale'; END IF;
      IF p_version = 1 THEN
        IF p_parent_candidate_id IS NOT NULL OR p_lineage_id <> p_candidate_id OR p_state <> 'candidate' THEN RAISE EXCEPTION 'initial candidate lineage or state is invalid'; END IF;
      ELSE
        IF NOT EXISTS (SELECT 1 FROM %1$s.improvement_candidates c WHERE c.candidate_id = p_parent_candidate_id AND c.version + 1 = p_version AND c.lineage_id = p_lineage_id AND c.project_id = p_project_id AND c.goal_id = p_goal_id AND c.kind = p_payload->>'kind') THEN RAISE EXCEPTION 'candidate parent lineage is invalid'; END IF;
        IF p_state <> 'candidate' AND NOT EXISTS (
          SELECT 1 FROM %1$s.improvement_candidates c
           WHERE c.candidate_id = p_parent_candidate_id AND (
             (c.state = 'candidate' AND p_state IN ('evaluated', 'rejected')) OR
             (c.state = 'evaluated' AND p_state IN ('judged', 'rejected')) OR
             (c.state = 'judged' AND p_state IN ('applied', 'rejected', 'retained')) OR
             (c.state = 'applied' AND p_state IN ('retained', 'rolled_back')) OR
             (c.state = 'rejected' AND p_state = 'retained') OR
             (c.state = 'retained' AND p_state = 'rolled_back')
           )
        ) THEN RAISE EXCEPTION 'candidate lifecycle transition is invalid'; END IF;
      END IF;
      IF jsonb_typeof(p_payload->'rollbackTarget') <> 'object' OR NOT (p_payload->'rollbackTarget' ? 'candidateId') OR NOT (p_payload->'rollbackTarget' ? 'version') OR NOT (p_payload->'rollbackTarget' ? 'contentHash') THEN RAISE EXCEPTION 'candidate rollback target is invalid'; END IF;
      IF NOT EXISTS (
        SELECT 1 FROM %1$s.improvement_candidate_rollback_targets b
         WHERE b.target_candidate_id = (p_payload->'rollbackTarget'->>'candidateId')::uuid
           AND b.target_version = (p_payload->'rollbackTarget'->>'version')::integer
           AND b.project_id = p_project_id AND b.goal_id = p_goal_id
           AND b.content_hash = p_payload->'rollbackTarget'->>'contentHash'
      ) AND NOT EXISTS (
        SELECT 1 FROM %1$s.improvement_candidates c
         WHERE c.candidate_id = (p_payload->'rollbackTarget'->>'candidateId')::uuid
           AND c.version = (p_payload->'rollbackTarget'->>'version')::integer
           AND c.project_id = p_project_id AND c.goal_id = p_goal_id
           AND c.content_hash = p_payload->'rollbackTarget'->>'contentHash'
      ) THEN RAISE EXCEPTION 'candidate rollback target is not a registered project/Goal version'; END IF;
      IF jsonb_typeof(p_payload->'sourceEvidenceIds') <> 'array' OR jsonb_array_length(p_payload->'sourceEvidenceIds') NOT BETWEEN 1 AND 32 THEN RAISE EXCEPTION 'candidate digest sources are invalid'; END IF;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_payload->'sourceEvidenceIds') ref WHERE ref <> lower(ref) OR NOT EXISTS (SELECT 1 FROM %1$s.improvement_digests d WHERE d.digest_id::text = ref AND d.project_id = p_project_id AND d.goal_id = p_goal_id)) THEN RAISE EXCEPTION 'candidate digest source is missing or outside the Goal'; END IF;
      PERFORM pg_advisory_xact_lock(hashtextextended(p_operation_ref, 88));
      PERFORM set_config('maestro.improvement_candidate_token', p_token, true);
      INSERT INTO %1$s.improvement_candidate_issuer_markers (transaction_id, token_hash) VALUES (txid_current(), encode(public.digest(p_token, 'sha256'), 'hex')) ON CONFLICT DO NOTHING;
      INSERT INTO %1$s.improvement_candidate_insert_authorizations (token_hash, candidate_id, lineage_id, version, parent_candidate_id, project_id, goal_id, author_operator_id, author_role_id, operation_ref, state, content_hash, payload)
        VALUES (encode(public.digest(p_token, 'sha256'), 'hex'), p_candidate_id, p_lineage_id, p_version, p_parent_candidate_id, p_project_id, p_goal_id, p_author_operator_id, p_author_role_id, p_operation_ref, p_state, canonical_hash, p_payload);
      RETURN canonical_hash;
    END;
    $body$;
  $fn$, schema_name);
END $$;

DROP TRIGGER IF EXISTS improvement_candidates_append_only ON improvement_candidates;
CREATE TRIGGER improvement_candidates_append_only BEFORE UPDATE OR DELETE ON improvement_candidates FOR EACH STATEMENT EXECUTE FUNCTION reject_improvement_candidate_mutation();
DROP TRIGGER IF EXISTS improvement_candidates_no_truncate ON improvement_candidates;
CREATE TRIGGER improvement_candidates_no_truncate BEFORE TRUNCATE ON improvement_candidates FOR EACH STATEMENT EXECUTE FUNCTION reject_unscoped_truncate();
DROP TRIGGER IF EXISTS improvement_candidate_rollback_targets_append_only ON improvement_candidate_rollback_targets;
CREATE TRIGGER improvement_candidate_rollback_targets_append_only BEFORE UPDATE OR DELETE ON improvement_candidate_rollback_targets FOR EACH STATEMENT EXECUTE FUNCTION reject_improvement_candidate_rollback_target_mutation();
DROP TRIGGER IF EXISTS improvement_candidate_rollback_targets_no_truncate ON improvement_candidate_rollback_targets;
CREATE TRIGGER improvement_candidate_rollback_targets_no_truncate BEFORE TRUNCATE ON improvement_candidate_rollback_targets FOR EACH STATEMENT EXECUTE FUNCTION reject_unscoped_truncate();
DROP TRIGGER IF EXISTS improvement_candidate_authorization_issuer ON improvement_candidate_insert_authorizations;
CREATE TRIGGER improvement_candidate_authorization_issuer BEFORE INSERT ON improvement_candidate_insert_authorizations FOR EACH ROW EXECUTE FUNCTION authorize_improvement_candidate_authorization_insert();
DROP TRIGGER IF EXISTS improvement_candidate_authorization_immutable ON improvement_candidate_insert_authorizations;
CREATE TRIGGER improvement_candidate_authorization_immutable BEFORE UPDATE OR DELETE ON improvement_candidate_insert_authorizations FOR EACH ROW EXECUTE FUNCTION reject_improvement_candidate_authorization_mutation();
DROP TRIGGER IF EXISTS improvement_candidate_insert_binding ON improvement_candidates;
CREATE TRIGGER improvement_candidate_insert_binding BEFORE INSERT ON improvement_candidates FOR EACH ROW EXECUTE FUNCTION validate_improvement_candidate_insert();
DROP TRIGGER IF EXISTS improvement_candidate_marker_guard ON improvement_candidate_issuer_markers;
CREATE TRIGGER improvement_candidate_marker_guard BEFORE INSERT OR UPDATE OR DELETE ON improvement_candidate_issuer_markers FOR EACH ROW EXECUTE FUNCTION authorize_improvement_candidate_marker_mutation();
REVOKE EXECUTE ON FUNCTION improvement_candidate_canonical_json(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION validate_improvement_candidate_payload(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION improvement_candidate_json_numbers_stable(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reject_improvement_candidate_mutation() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reject_improvement_candidate_rollback_target_mutation() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION authorize_improvement_candidate_authorization_insert() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION authorize_improvement_candidate_marker_mutation() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reject_improvement_candidate_authorization_mutation() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION validate_improvement_candidate_insert() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION authorize_improvement_candidate_insert(text, uuid, uuid, integer, uuid, uuid, uuid, uuid, text, text, bigint, text, text, text, jsonb) FROM PUBLIC;

