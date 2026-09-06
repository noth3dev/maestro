-- Phase 6 Slice 1: project-private, curated Improvement Digest snapshots.
-- Digests are evidence-linked summaries, not autonomous change instructions.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

-- Match the domain canonicalJson implementation for the fixed digest payload.
CREATE OR REPLACE FUNCTION improvement_digest_canonical_json(value jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  part record;
  encoded text;
BEGIN
  CASE jsonb_typeof(value)
    WHEN 'object' THEN
      SELECT COALESCE(string_agg(to_json(key)::text || ':' || improvement_digest_canonical_json(item), ',' ORDER BY key), '')
        INTO encoded FROM jsonb_each(value) AS entries(key, item);
      RETURN '{' || encoded || '}';
    WHEN 'array' THEN
      SELECT COALESCE(string_agg(improvement_digest_canonical_json(item), ',' ORDER BY ordinality), '')
        INTO encoded FROM jsonb_array_elements(value) WITH ORDINALITY AS entries(item, ordinality);
      RETURN '[' || encoded || ']';
    WHEN 'string' THEN RETURN to_json(value #>> '{}')::text;
    WHEN 'number' THEN RETURN to_jsonb((value #>> '{}')::double precision)::text;
    WHEN 'boolean' THEN RETURN value::text;
    WHEN 'null' THEN RETURN 'null';
    ELSE RAISE EXCEPTION 'Unsupported JSON type in Improvement Digest canonicalization';
  END CASE;
END;
$$;
CREATE OR REPLACE FUNCTION improvement_digest_contains_secret_like(value text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT value ~* '(authorization[[:space:]]*:[[:space:]]*bearer|bearer[[:space:]]+[[:graph:]]+|password[[:space:]]*[:=]|passwd[[:space:]]*[:=]|secret[[:space:]]*[:=]|api[_-]?key[[:space:]]*[:=]|access[_-]?token[[:space:]]*[:=]|refresh[_-]?token[[:space:]]*[:=]|private[_-]?key|credential[[:space:]]*[:=]|-----BEGIN.*PRIVATE KEY-----|(^|[^a-z0-9])(sk|pk)-[a-z0-9_-]{16,}([^a-z0-9]|$)|eyj[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+|AKIA[0-9A-Z]{16}|gh[pousr]_[a-z0-9]{20,}|AIza[0-9a-z_-]{20,}|xox[baprs]-[0-9a-z-]{20,}|hf_[0-9a-z]{20,})'::text;
$$;

CREATE TABLE IF NOT EXISTS improvement_digests (
  digest_id uuid PRIMARY KEY,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  project_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  episode_id text NOT NULL CHECK (btrim(episode_id) <> '' AND length(episode_id) <= 256 AND NOT improvement_digest_contains_secret_like(episode_id)),
  trigger text NOT NULL CHECK (trigger IN (
    'worker_completed', 'worker_failed', 'worker_cancelled', 'department_handoff',
    'council_decision', 'goal_completed', 'goal_failed', 'goal_rollback',
    'incident_closed', 'cost_threshold', 'quality_signal'
  )),
  situation text NOT NULL CHECK (btrim(situation) <> '' AND length(situation) <= 4096 AND NOT improvement_digest_contains_secret_like(situation)),
  selected_decision text NOT NULL CHECK (btrim(selected_decision) <> '' AND length(selected_decision) <= 4096 AND NOT improvement_digest_contains_secret_like(selected_decision)),
  rejected_alternatives jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(rejected_alternatives) = 'array' AND jsonb_array_length(rejected_alternatives) <= 16),
  observed_result text NOT NULL CHECK (btrim(observed_result) <> '' AND length(observed_result) <= 4096 AND NOT improvement_digest_contains_secret_like(observed_result)),
  metrics jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(metrics) = 'array' AND jsonb_array_length(metrics) <= 16 AND pg_column_size(metrics) <= 65536),
  confidence double precision NOT NULL CHECK (confidence >= 0 AND confidence <= 1 AND (confidence = 0 OR confidence >= 0.000001)),
  source_refs jsonb NOT NULL CHECK (jsonb_typeof(source_refs) = 'array' AND jsonb_array_length(source_refs) BETWEEN 1 AND 16 AND pg_column_size(source_refs) <= 65536),
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  author_id text NOT NULL CHECK (btrim(author_id) <> '' AND length(author_id) <= 256 AND NOT improvement_digest_contains_secret_like(author_id)),
  session_ref text NOT NULL CHECK (btrim(session_ref) <> '' AND length(session_ref) <= 256 AND NOT improvement_digest_contains_secret_like(session_ref)),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime',
  UNIQUE (project_id, goal_id, episode_id)
);
CREATE INDEX IF NOT EXISTS improvement_digests_project_idx ON improvement_digests (project_id, created_at, digest_id);
CREATE INDEX IF NOT EXISTS improvement_digests_goal_idx ON improvement_digests (goal_id, created_at, digest_id);

-- The application validates these links before insertion. This trigger repeats
-- the check for SQL writers so a direct table credential cannot create a
-- cross-project or fabricated source reference.
CREATE OR REPLACE FUNCTION validate_improvement_digest_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  source jsonb;
  source_kind text;
  source_id text;
  source_project uuid;
  source_goal uuid;
  incident_status text;
  alternative jsonb;
  metric jsonb;
  metric_name text;
  metric_unit text;
  metric_number numeric;
  goal_exists boolean;
  canonical_hash text;
BEGIN
  EXECUTE pg_catalog.format('SELECT EXISTS (SELECT 1 FROM %I.goals WHERE goal_id = $1 AND project_id = $2)', TG_TABLE_SCHEMA)
    INTO goal_exists USING NEW.goal_id, NEW.project_id;
  IF NOT goal_exists THEN
    RAISE EXCEPTION 'Improvement Digest Goal/project binding is invalid';
  END IF;
  IF jsonb_typeof(NEW.rejected_alternatives) <> 'array' OR jsonb_array_length(NEW.rejected_alternatives) > 16 THEN
    RAISE EXCEPTION 'Improvement Digest alternatives are malformed or unbounded';
  END IF;
  FOR alternative IN SELECT value FROM jsonb_array_elements(NEW.rejected_alternatives) LOOP
    IF jsonb_typeof(alternative) <> 'string' OR length(btrim(alternative #>> '{}')) = 0 OR length(alternative #>> '{}') > 4096 OR improvement_digest_contains_secret_like(alternative #>> '{}') THEN
      RAISE EXCEPTION 'Improvement Digest alternative is malformed or unsafe';
    END IF;
  END LOOP;
  IF jsonb_typeof(NEW.metrics) <> 'array' OR jsonb_array_length(NEW.metrics) > 16 THEN
    RAISE EXCEPTION 'Improvement Digest metrics are malformed or unbounded';
  END IF;
  FOR metric IN SELECT value FROM jsonb_array_elements(NEW.metrics) LOOP
    IF jsonb_typeof(metric) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(metric)) <> 3 OR NOT (metric ? 'name') OR NOT (metric ? 'value') OR NOT (metric ? 'unit')
       OR jsonb_typeof(metric->'name') <> 'string' OR jsonb_typeof(metric->'value') <> 'number' OR jsonb_typeof(metric->'unit') <> 'string' THEN
      RAISE EXCEPTION 'Improvement Digest metric is malformed';
    END IF;
    metric_name := metric->>'name'; metric_unit := metric->>'unit'; metric_number := (metric->>'value')::numeric;
    IF length(btrim(metric_name)) = 0 OR length(metric_name) > 128 OR length(btrim(metric_unit)) = 0 OR length(metric_unit) > 64
       OR (abs(metric_number) <> 0 AND (abs(metric_number) < 0.000001 OR abs(metric_number) >= 1000000000000000000000))
       OR improvement_digest_contains_secret_like(metric_name) OR improvement_digest_contains_secret_like(metric_unit)
       OR metric_name ~* '(^|[^a-z])(password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|credential)([^a-z]|$)'
       OR metric_unit ~* '(^|[^a-z])(password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|credential)([^a-z]|$)' THEN
      RAISE EXCEPTION 'Improvement Digest metric is unsafe or unbounded';
    END IF;
  END LOOP;
  IF jsonb_typeof(NEW.source_refs) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Improvement Digest source references are malformed or unbounded';
  END IF;
  IF jsonb_array_length(NEW.source_refs) < 1 OR jsonb_array_length(NEW.source_refs) > 16 THEN
    RAISE EXCEPTION 'Improvement Digest source references are malformed or unbounded';
  END IF;
  SELECT jsonb_agg(
    CASE
      WHEN jsonb_typeof(item) = 'object' AND jsonb_typeof(item->'sourceId') = 'string'
        THEN jsonb_set(item, '{sourceId}', to_jsonb(lower(item->>'sourceId')), false)
      ELSE item
    END ORDER BY ordinality
  ) INTO NEW.source_refs
  FROM jsonb_array_elements(NEW.source_refs) WITH ORDINALITY AS entries(item, ordinality);
  IF EXISTS (SELECT 1 FROM (SELECT value->>'kind' AS kind, value->>'sourceId' AS source_id, count(*) AS copies FROM jsonb_array_elements(NEW.source_refs) GROUP BY value->>'kind', value->>'sourceId' HAVING count(*) > 1) duplicate_sources) THEN
    RAISE EXCEPTION 'Improvement Digest source references must be unique';
  END IF;
  FOR source IN SELECT value FROM jsonb_array_elements(NEW.source_refs) LOOP
    IF jsonb_typeof(source) <> 'object' OR NOT (source ? 'kind') OR NOT (source ? 'sourceId')
       OR (SELECT count(*) FROM jsonb_object_keys(source)) <> 2 THEN
      RAISE EXCEPTION 'Improvement Digest source reference is malformed';
    END IF;
    source_kind := source->>'kind'; source_id := source->>'sourceId';
    source_project := NULL; source_goal := NULL; incident_status := NULL;
    IF source_id IS NULL OR source_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Improvement Digest source ID is not a UUID';
    END IF;
    CASE source_kind
      WHEN 'goal' THEN
        EXECUTE pg_catalog.format('SELECT g.project_id, g.goal_id FROM %I.goals g WHERE g.goal_id = $1', TG_TABLE_SCHEMA)
          INTO source_project, source_goal USING source_id::uuid;
      WHEN 'evidence_record' THEN
        EXECUTE pg_catalog.format('SELECT e.project_id, e.goal_id FROM %I.evidence_records e WHERE e.evidence_id = $1', TG_TABLE_SCHEMA)
          INTO source_project, source_goal USING source_id::uuid;
      WHEN 'evidence_bundle' THEN
        EXECUTE pg_catalog.format('SELECT g.project_id, b.goal_id FROM %I.evidence_bundles b JOIN %I.goals g ON g.goal_id = b.goal_id WHERE b.bundle_id = $1', TG_TABLE_SCHEMA, TG_TABLE_SCHEMA)
          INTO source_project, source_goal USING source_id::uuid;
      WHEN 'metronome_finding' THEN
        EXECUTE pg_catalog.format('SELECT g.project_id, f.goal_id FROM %I.metronome_findings f JOIN %I.goals g ON g.goal_id = f.goal_id WHERE f.finding_id = $1', TG_TABLE_SCHEMA, TG_TABLE_SCHEMA)
          INTO source_project, source_goal USING source_id::uuid;
      WHEN 'encore_round' THEN
        EXECUTE pg_catalog.format('SELECT g.project_id, r.goal_id FROM %I.encore_council_rounds r JOIN %I.goals g ON g.goal_id = r.goal_id WHERE r.round_id = $1', TG_TABLE_SCHEMA, TG_TABLE_SCHEMA)
          INTO source_project, source_goal USING source_id::uuid;
      WHEN 'discord_improvement_evidence' THEN
        EXECUTE pg_catalog.format('SELECT g.project_id, i.linked_goal_id, i.status FROM %I.discord_improvement_evidence e JOIN %I.discord_incidents i ON i.incident_id = e.incident_id JOIN %I.goals g ON g.goal_id = i.linked_goal_id WHERE e.evidence_id = $1', TG_TABLE_SCHEMA, TG_TABLE_SCHEMA, TG_TABLE_SCHEMA)
          INTO source_project, source_goal, incident_status USING source_id::uuid;
        IF incident_status IS NULL OR incident_status NOT IN ('resolved', 'false_positive') THEN
          RAISE EXCEPTION 'Discord Improvement Digest source is not closed evidence';
        END IF;
      ELSE RAISE EXCEPTION 'Improvement Digest source kind is not allowed';
    END CASE;
    IF source_goal IS NULL OR source_project IS DISTINCT FROM NEW.project_id OR source_goal IS DISTINCT FROM NEW.goal_id THEN
      RAISE EXCEPTION 'Improvement Digest source is missing or outside its Goal/project';
    END IF;
  END LOOP;
  EXECUTE pg_catalog.format('SELECT encode(public.digest(%I.improvement_digest_canonical_json($1), ''sha256''), ''hex'')', TG_TABLE_SCHEMA)
    INTO canonical_hash
    USING jsonb_build_object(
      'confidence', NEW.confidence, 'episodeId', NEW.episode_id, 'goalId', NEW.goal_id,
      'metrics', NEW.metrics, 'observedResult', NEW.observed_result, 'projectId', NEW.project_id,
      'rejectedAlternatives', NEW.rejected_alternatives, 'schemaVersion', NEW.schema_version,
      'selectedDecision', NEW.selected_decision, 'situation', NEW.situation, 'sourceRefs', NEW.source_refs,
      'trigger', NEW.trigger);
  IF canonical_hash <> NEW.content_hash THEN
    RAISE EXCEPTION 'Improvement Digest content hash is invalid';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS improvement_digests_binding ON improvement_digests;
CREATE TRIGGER improvement_digests_binding BEFORE INSERT ON improvement_digests
  FOR EACH ROW EXECUTE FUNCTION validate_improvement_digest_binding();

CREATE OR REPLACE FUNCTION reject_improvement_digest_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Improvement Digests are append-only';
END;
$$;
DROP TRIGGER IF EXISTS improvement_digests_append_only ON improvement_digests;
CREATE TRIGGER improvement_digests_append_only BEFORE UPDATE OR DELETE ON improvement_digests
  FOR EACH ROW EXECUTE FUNCTION reject_improvement_digest_mutation();
DROP TRIGGER IF EXISTS improvement_digests_no_truncate ON improvement_digests;
CREATE TRIGGER improvement_digests_no_truncate BEFORE TRUNCATE ON improvement_digests
  FOR EACH STATEMENT EXECUTE FUNCTION reject_improvement_digest_mutation();


-- A Goal's project is part of every project-private digest binding. Keep that
-- identity immutable so a later Goal move cannot invalidate old evidence scope.
CREATE OR REPLACE FUNCTION reject_goal_project_identity_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    RAISE EXCEPTION 'Goal project identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS goals_project_identity_immutable ON goals;
CREATE TRIGGER goals_project_identity_immutable
  BEFORE UPDATE OF project_id ON goals
  FOR EACH ROW EXECUTE FUNCTION reject_goal_project_identity_mutation();

-- Freeze function name resolution at creation-time schema plus trusted built-ins.
-- The active schema is included because scoped test/deployment databases install
-- this migration outside public; caller-provided search_path entries are not.
DO $$
DECLARE
  digest_schema text := current_schema();
BEGIN
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.improvement_digest_canonical_json(jsonb) SET search_path = pg_catalog, %I', digest_schema, digest_schema);
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.improvement_digest_contains_secret_like(text) SET search_path = pg_catalog, %I', digest_schema, digest_schema);
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.validate_improvement_digest_binding() SET search_path = pg_catalog, %I', digest_schema, digest_schema);
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.reject_improvement_digest_mutation() SET search_path = pg_catalog, %I', digest_schema, digest_schema);
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.reject_goal_project_identity_mutation() SET search_path = pg_catalog, %I', digest_schema, digest_schema);
END;
$$;
