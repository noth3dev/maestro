-- Plan 6 S1: append-only, source-bound organizational knowledge.
-- A proposal is never made durable by the worker that authored it. Promotion
-- appends a revision, preserving every prior state and its provenance.
CREATE TABLE IF NOT EXISTS organizational_knowledge (
  knowledge_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  source_project_id uuid NOT NULL,
  project_id uuid,
  source_goal_id uuid NOT NULL REFERENCES goals(goal_id),
  department_id text NOT NULL REFERENCES departments(department_id),
  scope text NOT NULL CHECK (scope IN ('worker_proposed', 'project_department', 'global')),
  status text NOT NULL CHECK (status IN ('proposed', 'active', 'unsupported', 'contradicted', 'retired')),
  statement text NOT NULL CHECK (btrim(statement) <> '' AND length(statement) <= 4096),
  rationale text NOT NULL CHECK (btrim(rationale) <> '' AND length(rationale) <= 4096),
  source_evidence_ids jsonb NOT NULL CHECK (jsonb_typeof(source_evidence_ids) = 'array' AND jsonb_array_length(source_evidence_ids) <= 32),
  source_digest_ids jsonb NOT NULL CHECK (jsonb_typeof(source_digest_ids) = 'array' AND jsonb_array_length(source_digest_ids) <= 32),
  episode_ids jsonb NOT NULL CHECK (jsonb_typeof(episode_ids) = 'array' AND jsonb_array_length(episode_ids) BETWEEN 1 AND 32),
  confidence double precision NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  freshness double precision NOT NULL CHECK (freshness >= 0 AND freshness <= 1),
  generalized boolean NOT NULL DEFAULT false,
  council_round_id uuid,
  generalized_statement text,
  curator_role_id text,
  promotion_marker text NOT NULL,
  reason text CHECK (reason IS NULL OR (btrim(reason) <> '' AND length(reason) <= 1024)),
  created_by text NOT NULL CHECK (btrim(created_by) <> '' AND length(created_by) <= 256),
  source_session_ref text NOT NULL CHECK (btrim(source_session_ref) <> '' AND length(source_session_ref) <= 256),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (knowledge_id, revision),
  CHECK ((scope = 'global' AND project_id IS NULL AND generalized AND council_round_id IS NOT NULL AND generalized_statement IS NOT NULL AND curator_role_id IS NOT NULL AND jsonb_array_length(episode_ids) >= 2)
      OR (scope <> 'global' AND project_id IS NOT NULL)),
  CHECK ((scope = 'worker_proposed' AND status IN ('proposed', 'unsupported')) OR (scope <> 'worker_proposed' AND status <> 'proposed')),
  CHECK ((status IN ('unsupported', 'contradicted', 'retired') AND reason IS NOT NULL) OR status IN ('proposed', 'active')),
  CHECK ((scope = 'worker_proposed' AND promotion_marker = 'worker-proposal') OR (scope = 'project_department' AND status = 'active' AND promotion_marker = 'department-promotion') OR (scope = 'global' AND status = 'active' AND promotion_marker = 'global-promotion') OR (status IN ('unsupported', 'contradicted', 'retired') AND promotion_marker IN ('source-loss', 'knowledge-decay', 'adjudication')))

);
CREATE INDEX IF NOT EXISTS organizational_knowledge_project_idx ON organizational_knowledge (project_id, department_id, created_at, knowledge_id, revision);
CREATE INDEX IF NOT EXISTS organizational_knowledge_global_idx ON organizational_knowledge (scope, department_id, created_at, knowledge_id, revision) WHERE scope = 'global';

CREATE OR REPLACE FUNCTION validate_organizational_knowledge_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item jsonb; ref_id uuid; expected_revision integer;
BEGIN
  IF NEW.scope = 'global' AND (NEW.statement ILIKE '%' || NEW.source_project_id::text || '%' OR NEW.rationale ILIKE '%' || NEW.source_project_id::text || '%') THEN
    RAISE EXCEPTION 'global organizational knowledge cannot contain raw project identity';
  END IF;
  IF NEW.statement ~* '(authorization[[:space:]]*:[[:space:]]*bearer|password[[:space:]]*[:=]|secret[[:space:]]*[:=]|api[_-]?key[[:space:]]*[:=]|private[_-]?key|-----BEGIN.*PRIVATE KEY-----)' OR NEW.rationale ~* '(authorization[[:space:]]*:[[:space:]]*bearer|password[[:space:]]*[:=]|secret[[:space:]]*[:=]|api[_-]?key[[:space:]]*[:=]|private[_-]?key|-----BEGIN.*PRIVATE KEY-----)' THEN
    RAISE EXCEPTION 'organizational knowledge contains secret-like material';
  END IF;
  IF NEW.statement ~* '(^|[^a-z])(email|phone|telephone|ssn|social security|home address|personal information)([^a-z]|$)' OR NEW.rationale ~* '(^|[^a-z])(email|phone|telephone|ssn|social security|home address|personal information)([^a-z]|$)' THEN
    RAISE EXCEPTION 'organizational knowledge contains personal information';
  END IF;
  SELECT COALESCE(max(revision), 0) + 1 INTO expected_revision FROM organizational_knowledge WHERE knowledge_id = NEW.knowledge_id;
  IF NEW.revision <> expected_revision THEN RAISE EXCEPTION 'organizational knowledge revisions must be append-only and contiguous'; END IF;
  IF NEW.revision = 1 AND NEW.scope <> 'worker_proposed' THEN
    RAISE EXCEPTION 'organizational knowledge must be proposed before promotion';
  END IF;
  IF NEW.scope = 'project_department' AND NEW.status = 'active' AND NOT EXISTS (SELECT 1 FROM organizational_knowledge prior WHERE prior.knowledge_id = NEW.knowledge_id AND prior.revision = NEW.revision - 1 AND prior.scope = 'worker_proposed' AND prior.status = 'proposed') THEN
    RAISE EXCEPTION 'project organizational knowledge requires proposal-first lineage';
  END IF;
  IF NEW.scope = 'global' AND NEW.status = 'active' AND NOT EXISTS (SELECT 1 FROM organizational_knowledge prior WHERE prior.knowledge_id = NEW.knowledge_id AND prior.revision = NEW.revision - 1 AND prior.scope = 'project_department' AND prior.status = 'active') THEN
    RAISE EXCEPTION 'global organizational knowledge requires project promotion lineage';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM goals WHERE goal_id = NEW.source_goal_id AND project_id = NEW.source_project_id) THEN RAISE EXCEPTION 'organizational knowledge source Goal is outside source project'; END IF;
  IF NEW.project_id IS DISTINCT FROM NEW.source_project_id AND NEW.scope <> 'global' THEN RAISE EXCEPTION 'project organizational knowledge must retain source project scope'; END IF;
  IF jsonb_array_length(NEW.source_evidence_ids) = 0 AND jsonb_array_length(NEW.source_digest_ids) = 0 THEN RAISE EXCEPTION 'organizational knowledge requires source evidence'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(NEW.source_evidence_ids) LOOP
    IF jsonb_typeof(item) <> 'string' OR item #>> '{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'organizational knowledge evidence reference is malformed'; END IF;
    ref_id := (item #>> '{}')::uuid;
    IF NOT EXISTS (SELECT 1 FROM evidence_records WHERE evidence_id = ref_id AND project_id = NEW.source_project_id AND goal_id = NEW.source_goal_id) THEN RAISE EXCEPTION 'organizational knowledge evidence reference is missing or outside source project'; END IF;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(NEW.source_digest_ids) LOOP
    IF jsonb_typeof(item) <> 'string' OR item #>> '{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'organizational knowledge digest reference is malformed'; END IF;
    ref_id := (item #>> '{}')::uuid;
    IF NOT EXISTS (SELECT 1 FROM improvement_digests WHERE digest_id = ref_id AND project_id = NEW.source_project_id AND goal_id = NEW.source_goal_id) THEN RAISE EXCEPTION 'organizational knowledge digest reference is missing or outside source project'; END IF;
  END LOOP;
  IF NEW.scope = 'global' AND NEW.status = 'active' AND NOT EXISTS (SELECT 1 FROM encore_council_rounds r JOIN encore_council_syntheses s ON s.round_id = r.round_id WHERE r.round_id = NEW.council_round_id AND r.goal_id = NEW.source_goal_id AND s.final_verdict = 'proceed' AND s.same_model_only = false AND r.evidence_ids @> NEW.source_evidence_ids) THEN
    RAISE EXCEPTION 'global organizational knowledge requires an approved Encore Council round';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS organizational_knowledge_validate ON organizational_knowledge;
CREATE TRIGGER organizational_knowledge_validate BEFORE INSERT ON organizational_knowledge FOR EACH ROW EXECUTE FUNCTION validate_organizational_knowledge_insert();

CREATE OR REPLACE FUNCTION reject_organizational_knowledge_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'organizational knowledge is append-only; retire or supersede it with a new revision'; END;
$$;
DROP TRIGGER IF EXISTS organizational_knowledge_immutable ON organizational_knowledge;
CREATE TRIGGER organizational_knowledge_immutable BEFORE UPDATE OR DELETE ON organizational_knowledge FOR EACH ROW EXECUTE FUNCTION reject_organizational_knowledge_mutation();
DROP TRIGGER IF EXISTS organizational_knowledge_no_truncate ON organizational_knowledge;
CREATE TRIGGER organizational_knowledge_no_truncate BEFORE TRUNCATE ON organizational_knowledge FOR EACH STATEMENT EXECUTE FUNCTION reject_organizational_knowledge_mutation();

CREATE OR REPLACE FUNCTION current_organizational_knowledge(p_knowledge_id uuid) RETURNS SETOF organizational_knowledge LANGUAGE sql STABLE AS $$
  SELECT k.* FROM organizational_knowledge k WHERE k.knowledge_id = p_knowledge_id ORDER BY k.revision DESC LIMIT 1;
$$;


-- Evidence metadata is immutable during ordinary operation. An explicit
-- source-loss transition is the only supported delete path and first appends
-- an unsupported knowledge revision in the same transaction.
CREATE TABLE IF NOT EXISTS source_evidence_loss_events (
  event_id uuid PRIMARY KEY,
  evidence_id uuid NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> '' AND length(reason) <= 1024),
  recorded_by text NOT NULL CHECK (btrim(recorded_by) <> '' AND length(recorded_by) <= 256),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
CREATE OR REPLACE FUNCTION reject_source_evidence_loss_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'source evidence loss events are append-only'; END;
$$;
DROP TRIGGER IF EXISTS source_evidence_loss_events_immutable ON source_evidence_loss_events;
CREATE TRIGGER source_evidence_loss_events_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON source_evidence_loss_events FOR EACH STATEMENT EXECUTE FUNCTION reject_source_evidence_loss_event_mutation();

CREATE OR REPLACE FUNCTION propagate_organizational_knowledge_evidence_loss(p_evidence_id uuid, p_reason text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE k record;
BEGIN
  FOR k IN
    SELECT DISTINCT ON (knowledge_id) * FROM organizational_knowledge
     WHERE status NOT IN ('unsupported', 'retired')
       AND source_evidence_ids @> jsonb_build_array(p_evidence_id::text)
     ORDER BY knowledge_id, revision DESC
  LOOP
    INSERT INTO organizational_knowledge
      (knowledge_id, revision, schema_version, source_project_id, project_id, source_goal_id, department_id, scope, status, statement, rationale, source_evidence_ids, source_digest_ids, episode_ids, confidence, freshness, generalized, council_round_id, generalized_statement, curator_role_id, promotion_marker, reason, created_by, source_session_ref)
    VALUES
      (k.knowledge_id, k.revision + 1, k.schema_version, k.source_project_id, k.project_id, k.source_goal_id, k.department_id, k.scope, 'unsupported', k.statement, k.rationale, k.source_evidence_ids, k.source_digest_ids, k.episode_ids, k.confidence, k.freshness, k.generalized, k.council_round_id, k.generalized_statement, k.curator_role_id, 'source-loss', p_reason, 'evidence-source-loss', 'system:evidence-source-loss');
  END LOOP;
END;
$$;

-- Replace the original evidence immutability trigger function while retaining
-- its ordinary fail-closed behavior. The scoped GUC is set only by the
-- deleteEvidenceSource application boundary.
CREATE OR REPLACE FUNCTION reject_evidence_record_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('maestro.source_evidence_loss', true) = '1' THEN
    PERFORM propagate_organizational_knowledge_evidence_loss(OLD.evidence_id, COALESCE(current_setting('maestro.source_evidence_loss_reason', true), 'source evidence was lost'));
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'evidence records are immutable';
END;
$$;
