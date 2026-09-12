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
  retention retention_class NOT NULL DEFAULT 'project_lifetime',
  PRIMARY KEY (knowledge_id, revision),
  CHECK ((scope = 'global' AND project_id IS NULL AND generalized AND council_round_id IS NOT NULL AND generalized_statement IS NOT NULL AND curator_role_id IS NOT NULL AND jsonb_array_length(episode_ids) >= 2)
      OR (scope <> 'global' AND project_id IS NOT NULL)),
  CHECK ((scope = 'worker_proposed' AND status IN ('proposed', 'unsupported')) OR (scope <> 'worker_proposed' AND status <> 'proposed')),
  CHECK ((status IN ('unsupported', 'contradicted', 'retired') AND reason IS NOT NULL) OR status IN ('proposed', 'active')),
  CHECK ((scope = 'worker_proposed' AND promotion_marker = 'worker-proposal') OR (scope = 'project_department' AND status = 'active' AND promotion_marker = 'department-promotion') OR (scope = 'global' AND status = 'active' AND promotion_marker = 'global-promotion') OR (status IN ('unsupported', 'contradicted', 'retired') AND promotion_marker IN ('source-loss', 'knowledge-decay', 'adjudication')))

);
CREATE INDEX IF NOT EXISTS organizational_knowledge_project_idx ON organizational_knowledge (project_id, department_id, created_at, knowledge_id, revision);
CREATE INDEX IF NOT EXISTS organizational_knowledge_global_idx ON organizational_knowledge (scope, department_id, created_at, knowledge_id, revision) WHERE scope = 'global';
CREATE TABLE IF NOT EXISTS knowledge_promotion_authorizations (
  token_hash char(64) PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  knowledge_id uuid NOT NULL,
  revision integer NOT NULL,
  scope text NOT NULL CHECK (scope IN ('project_department', 'global')),
  role_id text NOT NULL,
  department_id text NOT NULL REFERENCES departments(department_id),
  operator_id uuid NOT NULL,
  goal_id uuid NOT NULL REFERENCES goals(goal_id),
  owner_id text NOT NULL,
  fencing_token bigint NOT NULL CHECK (fencing_token > 0),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime'
);

CREATE OR REPLACE FUNCTION validate_organizational_knowledge_insert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE item jsonb; ref_id uuid; expected_revision integer;
BEGIN
  IF NEW.scope = 'global' AND (NEW.statement ILIKE '%' || NEW.source_project_id::text || '%' OR NEW.rationale ILIKE '%' || NEW.source_project_id::text || '%' OR COALESCE(NEW.generalized_statement, '') ILIKE '%' || NEW.source_project_id::text || '%' OR COALESCE(NEW.generalized_statement, '') ILIKE '%' || NEW.source_goal_id::text || '%') THEN
    RAISE EXCEPTION 'global organizational knowledge cannot contain raw project identity';
  END IF;
  IF NEW.statement ~* '(authorization[[:space:]]*:[[:space:]]*bearer|password[[:space:]]*[:=]|secret[[:space:]]*[:=]|api[_-]?key[[:space:]]*[:=]|private[_-]?key|-----BEGIN.*PRIVATE KEY-----)' OR NEW.rationale ~* '(authorization[[:space:]]*:[[:space:]]*bearer|password[[:space:]]*[:=]|secret[[:space:]]*[:=]|api[_-]?key[[:space:]]*[:=]|private[_-]?key|-----BEGIN.*PRIVATE KEY-----)' OR COALESCE(NEW.generalized_statement, '') ~* '(authorization[[:space:]]*:[[:space:]]*bearer|password[[:space:]]*[:=]|secret[[:space:]]*[:=]|api[_-]?key[[:space:]]*[:=]|private[_-]?key|-----BEGIN.*PRIVATE KEY-----)' THEN
    RAISE EXCEPTION 'organizational knowledge contains secret-like material';
  END IF;
  IF NEW.statement ~* '(^|[^a-z])(email|phone|telephone|ssn|social security|home address|personal information)([^a-z]|$)' OR NEW.rationale ~* '(^|[^a-z])(email|phone|telephone|ssn|social security|home address|personal information)([^a-z]|$)' OR COALESCE(NEW.generalized_statement, '') ~* '(^|[^a-z])(email|phone|telephone|ssn|social security|home address|personal information)([^a-z]|$)' THEN
    RAISE EXCEPTION 'organizational knowledge contains personal information';
  END IF;
  IF NEW.generalized_statement IS NOT NULL AND (NEW.generalized_statement ~* '(authorization[[:space:]]*:[[:space:]]*bearer|password[[:space:]]*[:=]|secret[[:space:]]*[:=]|api[_-]?key[[:space:]]*[:=]|private[_-]?key|-----BEGIN.*PRIVATE KEY-----)' OR NEW.generalized_statement ~* '(^|[^a-z])(email|phone|telephone|ssn|social security|home address|personal information)([^a-z]|$)' OR NEW.generalized_statement ~* '\m(raw|project-specific|source project|private project)\M') THEN
    RAISE EXCEPTION 'generalized organizational knowledge contains unsafe material';
  END IF;
  IF NEW.scope = 'global' AND (NEW.statement ~* '\m(raw|project-specific|source project|private project)\M' OR NEW.rationale ~* '\m(raw|project-specific|source project|private project)\M' OR COALESCE(NEW.generalized_statement, '') ~* '\m(raw|project-specific|source project|private project)\M') THEN RAISE EXCEPTION 'global organizational knowledge contains raw project content'; END IF;
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
  IF NEW.scope = 'global' AND NEW.status = 'active' AND jsonb_array_length(NEW.source_evidence_ids) <> 0 THEN RAISE EXCEPTION 'global organizational knowledge cannot retain raw evidence references'; END IF;
  IF NEW.scope = 'global' AND NEW.status = 'active' AND NOT EXISTS (
    SELECT 1 FROM encore_council_rounds r JOIN encore_council_syntheses s ON s.round_id = r.round_id
     WHERE r.round_id = NEW.council_round_id AND r.goal_id = NEW.source_goal_id AND s.final_verdict = 'proceed' AND s.same_model_only = false
       AND (SELECT array_agg(value ORDER BY value) FROM jsonb_array_elements_text(r.evidence_ids)) = (SELECT array_agg(value ORDER BY value) FROM jsonb_array_elements_text(NEW.source_digest_ids))
       AND (SELECT count(*) FROM encore_council_judgments j WHERE j.round_id = r.round_id) = r.reviewer_count
       AND (SELECT count(DISTINCT j.reviewer_index) FROM encore_council_judgments j WHERE j.round_id = r.round_id) = r.reviewer_count
       AND (SELECT min(j.reviewer_index) FROM encore_council_judgments j WHERE j.round_id = r.round_id) = 0
       AND (SELECT max(j.reviewer_index) FROM encore_council_judgments j WHERE j.round_id = r.round_id) = r.reviewer_count - 1
       AND NOT EXISTS (SELECT 1 FROM encore_council_judgments j WHERE j.round_id = r.round_id AND j.verdict <> 'proceed')
       AND NOT EXISTS (SELECT 1 FROM encore_council_judgments j WHERE j.round_id = r.round_id AND (SELECT array_agg(value ORDER BY value) FROM jsonb_array_elements_text(j.cited_evidence_ids)) IS DISTINCT FROM (SELECT array_agg(value ORDER BY value) FROM jsonb_array_elements_text(NEW.source_digest_ids)))
       AND (SELECT count(DISTINCT (j.model_provider || ':' || j.model_id)) FROM encore_council_judgments j WHERE j.round_id = r.round_id) >= 2
       AND (SELECT count(DISTINCT j.judgment_id) FROM encore_council_judgments j JOIN native_execution_bindings b ON b.execution_ref = j.execution_ref AND b.invocation_ref = j.invocation_ref AND b.goal_id = r.goal_id AND b.project_id = NEW.source_project_id AND b.admission_kind = 'encore_reviewer' AND b.actual_model_provider = j.model_provider AND b.actual_model_id = j.model_id WHERE j.round_id = r.round_id) = r.reviewer_count
  ) THEN RAISE EXCEPTION 'global organizational knowledge requires exact durable Council review'; END IF;
  IF NEW.scope = 'worker_proposed' AND NOT EXISTS (SELECT 1 FROM knowledge_proposal_authorizations a WHERE a.knowledge_id = NEW.knowledge_id AND a.revision = NEW.revision AND a.project_id = NEW.source_project_id AND a.goal_id = NEW.source_goal_id AND a.actor_id = NEW.created_by AND a.session_ref = NEW.source_session_ref AND a.operator_id = current_setting('maestro.knowledge_proposal_operator', true)::uuid AND a.owner_id = current_setting('maestro.knowledge_proposal_owner', true) AND a.fencing_token = current_setting('maestro.knowledge_proposal_fence', true)::bigint AND a.token_hash = encode(public.digest(current_setting('maestro.knowledge_proposal_token', true), 'sha256'), 'hex')) THEN RAISE EXCEPTION 'organizational knowledge proposal authorization is missing or mismatched'; END IF;
  IF NEW.scope = 'worker_proposed' THEN DELETE FROM knowledge_proposal_authorizations WHERE knowledge_id = NEW.knowledge_id AND revision = NEW.revision; END IF;
  IF NEW.status = 'active' AND NEW.scope IN ('project_department', 'global') AND NOT EXISTS (SELECT 1 FROM permanent_roles WHERE role_id = NEW.created_by AND role_kind = 'department_head' AND department_id = NEW.department_id AND status = 'standing') THEN
    RAISE EXCEPTION 'active organizational knowledge requires a standing Department Head';
  END IF;
  IF NEW.status = 'active' AND NEW.scope IN ('project_department', 'global') AND NOT EXISTS (
    SELECT 1 FROM knowledge_promotion_authorizations a
     WHERE a.knowledge_id = NEW.knowledge_id AND a.revision = NEW.revision AND a.scope = NEW.scope
       AND a.role_id = NEW.created_by AND a.department_id = NEW.department_id
       AND a.operator_id = current_setting('maestro.knowledge_promotion_operator', true)::uuid
       AND a.goal_id = NEW.source_goal_id AND a.owner_id = current_setting('maestro.knowledge_promotion_owner', true)
       AND a.fencing_token = current_setting('maestro.knowledge_promotion_fence', true)::bigint
       AND a.token_hash = encode(public.digest(current_setting('maestro.knowledge_promotion_token', true), 'sha256'), 'hex')
  ) THEN RAISE EXCEPTION 'organizational knowledge promotion authorization is missing or mismatched'; END IF;
  IF NEW.status = 'active' AND NEW.scope IN ('project_department', 'global') THEN
    DELETE FROM knowledge_promotion_authorizations WHERE knowledge_id = NEW.knowledge_id AND revision = NEW.revision;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM goals WHERE goal_id = NEW.source_goal_id AND project_id = NEW.source_project_id) THEN RAISE EXCEPTION 'organizational knowledge source Goal is outside source project'; END IF;
  IF NEW.project_id IS DISTINCT FROM NEW.source_project_id AND NEW.scope <> 'global' THEN RAISE EXCEPTION 'project organizational knowledge must retain source project scope'; END IF;
  IF jsonb_array_length(NEW.source_evidence_ids) = 0 AND jsonb_array_length(NEW.source_digest_ids) = 0 THEN RAISE EXCEPTION 'organizational knowledge requires source evidence'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(NEW.source_evidence_ids) LOOP
    IF jsonb_typeof(item) <> 'string' OR item #>> '{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'organizational knowledge evidence reference is malformed'; END IF;
    ref_id := (item #>> '{}')::uuid;
    IF NOT EXISTS (SELECT 1 FROM evidence_records WHERE evidence_id = ref_id AND project_id = NEW.source_project_id AND goal_id = NEW.source_goal_id)
       AND (NEW.status IN ('proposed', 'active') OR NOT EXISTS (
         SELECT 1 FROM organizational_knowledge prior
          WHERE prior.knowledge_id = NEW.knowledge_id AND prior.revision = NEW.revision - 1
            AND prior.status = 'unsupported' AND prior.promotion_marker = 'source-loss'
            AND prior.source_project_id = NEW.source_project_id AND prior.source_goal_id = NEW.source_goal_id
            AND prior.source_evidence_ids = NEW.source_evidence_ids
       )) THEN RAISE EXCEPTION 'organizational knowledge evidence reference is missing or outside source project'; END IF;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(NEW.source_digest_ids) LOOP
    IF jsonb_typeof(item) <> 'string' OR item #>> '{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'organizational knowledge digest reference is malformed'; END IF;
    ref_id := (item #>> '{}')::uuid;
    IF NOT EXISTS (SELECT 1 FROM improvement_digests WHERE digest_id = ref_id AND project_id = NEW.source_project_id AND goal_id = NEW.source_goal_id) THEN RAISE EXCEPTION 'organizational knowledge digest reference is missing or outside source project'; END IF;
  END LOOP;
  IF NEW.scope = 'global' AND NEW.status = 'active' AND (jsonb_array_length(NEW.source_evidence_ids) <> 0 OR jsonb_array_length(NEW.source_digest_ids) < 2) THEN
    RAISE EXCEPTION 'global organizational knowledge requires two durable Improvement Digest sources';
  END IF;
  IF NEW.scope = 'global' AND NEW.status = 'active' AND (SELECT count(DISTINCT d.episode_id) FROM improvement_digests d WHERE d.digest_id::text IN (SELECT value #>> '{}' FROM jsonb_array_elements(NEW.source_digest_ids))) < 2 THEN
    RAISE EXCEPTION 'global organizational knowledge requires distinct durable digest episodes';
  END IF;
  IF NEW.scope = 'global' AND NEW.status = 'active' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(NEW.episode_ids) episode
     WHERE NOT EXISTS (SELECT 1 FROM improvement_digests d WHERE d.digest_id::text IN (SELECT value #>> '{}' FROM jsonb_array_elements(NEW.source_digest_ids)) AND d.goal_id = NEW.source_goal_id AND d.episode_id = episode)
  ) THEN RAISE EXCEPTION 'global organizational knowledge episode is not bound to a durable digest'; END IF;
  IF NEW.scope = 'global' AND NEW.status = 'active' AND jsonb_array_length(NEW.source_digest_ids) <> jsonb_array_length(NEW.episode_ids) THEN RAISE EXCEPTION 'global knowledge source and episode lists must have equal length'; END IF;
  IF NEW.scope = 'global' AND NEW.status = 'active' AND EXISTS (
    SELECT 1 FROM generate_series(0, jsonb_array_length(NEW.source_digest_ids) - 1) AS pair(ordinal)
     WHERE NOT EXISTS (SELECT 1 FROM improvement_digests d WHERE d.digest_id::text = NEW.source_digest_ids ->> pair.ordinal AND d.goal_id = NEW.source_goal_id AND d.episode_id = NEW.episode_ids ->> pair.ordinal)
  ) THEN RAISE EXCEPTION 'global knowledge source and episode pairing is invalid'; END IF;
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

-- Raw current-row SQL access is intentionally not exposed. Callers must use the
-- project-authorized application read API, which redacts global provenance.
DROP FUNCTION IF EXISTS current_organizational_knowledge(uuid);


-- Evidence metadata is immutable during ordinary operation. An explicit
-- source-loss transition is the only supported delete path and first appends
-- an unsupported knowledge revision in the same transaction.
CREATE TABLE IF NOT EXISTS source_evidence_loss_events (
  event_id uuid PRIMARY KEY,
  evidence_id uuid NOT NULL,
  goal_id uuid NOT NULL REFERENCES goals(goal_id),
  project_id uuid NOT NULL,
  owner_id text NOT NULL CHECK (btrim(owner_id) <> '' AND length(owner_id) <= 256),
  fencing_token bigint NOT NULL CHECK (fencing_token > 0),
  reason text NOT NULL CHECK (btrim(reason) <> '' AND length(reason) <= 1024),
  recorded_by text NOT NULL CHECK (btrim(recorded_by) <> '' AND length(recorded_by) <= 256),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime'
);
CREATE OR REPLACE FUNCTION validate_source_evidence_loss_event_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM evidence_records e JOIN goals g ON g.goal_id = e.goal_id WHERE e.evidence_id = NEW.evidence_id AND e.goal_id = NEW.goal_id AND e.project_id = NEW.project_id AND g.project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'source evidence loss event Goal/project binding is invalid';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM local_operators WHERE operator_id = NEW.recorded_by::uuid AND active = true) THEN RAISE EXCEPTION 'source evidence loss event operator is inactive'; END IF;
  IF NOT EXISTS (SELECT 1 FROM goal_leases WHERE goal_id = NEW.goal_id AND owner_id = NEW.owner_id AND fencing_token = NEW.fencing_token AND expires_at > clock_timestamp()) THEN RAISE EXCEPTION 'source evidence loss event lease is missing or stale'; END IF;
  IF NOT EXISTS (SELECT 1 FROM source_evidence_loss_authorizations a WHERE a.evidence_id = NEW.evidence_id AND a.goal_id = NEW.goal_id AND a.project_id = NEW.project_id AND a.owner_id = NEW.owner_id AND a.fencing_token = NEW.fencing_token AND a.recorded_by = NEW.recorded_by AND a.reason = NEW.reason AND a.token_hash = encode(public.digest(current_setting('maestro.source_evidence_loss_token', true), 'sha256'), 'hex')) THEN
    RAISE EXCEPTION 'source evidence loss event authorization is missing or mismatched';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS source_evidence_loss_events_binding ON source_evidence_loss_events;
CREATE TRIGGER source_evidence_loss_events_binding BEFORE INSERT ON source_evidence_loss_events FOR EACH ROW EXECUTE FUNCTION validate_source_evidence_loss_event_binding();

CREATE OR REPLACE FUNCTION reject_source_evidence_loss_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'source evidence loss events are append-only'; END;
$$;
DROP TRIGGER IF EXISTS source_evidence_loss_events_immutable ON source_evidence_loss_events;
CREATE TRIGGER source_evidence_loss_events_immutable BEFORE UPDATE OR DELETE ON source_evidence_loss_events FOR EACH STATEMENT EXECUTE FUNCTION reject_source_evidence_loss_event_mutation();
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON source_evidence_loss_events FROM PUBLIC;

CREATE OR REPLACE FUNCTION propagate_organizational_knowledge_evidence_loss(p_evidence_id uuid, p_reason text, p_actor text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE k record;
BEGIN
  FOR k IN
    SELECT current.* FROM organizational_knowledge current
     WHERE current.status NOT IN ('unsupported', 'retired')
       AND current.source_evidence_ids @> jsonb_build_array(p_evidence_id::text)
       AND current.revision = (SELECT max(latest.revision) FROM organizational_knowledge latest WHERE latest.knowledge_id = current.knowledge_id)
     FOR UPDATE
  LOOP
    INSERT INTO organizational_knowledge
      (knowledge_id, revision, schema_version, source_project_id, project_id, source_goal_id, department_id, scope, status, statement, rationale, source_evidence_ids, source_digest_ids, episode_ids, confidence, freshness, generalized, council_round_id, generalized_statement, curator_role_id, promotion_marker, reason, created_by, source_session_ref)
    VALUES
      (k.knowledge_id, k.revision + 1, k.schema_version, k.source_project_id, k.project_id, k.source_goal_id, k.department_id, k.scope, 'unsupported', k.statement, k.rationale, k.source_evidence_ids, k.source_digest_ids, k.episode_ids, k.confidence, k.freshness, k.generalized, k.council_round_id, k.generalized_statement, k.curator_role_id, 'source-loss', p_reason, p_actor, 'evidence:' || p_evidence_id::text);
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION propagate_organizational_knowledge_evidence_loss(uuid, text, text) FROM PUBLIC;


-- Replace the original evidence immutability trigger function while retaining
-- its ordinary fail-closed behavior. The scoped GUC is set only by the
-- deleteEvidenceSource application boundary.

CREATE TABLE IF NOT EXISTS source_evidence_loss_authorizations (
  token_hash char(64) PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  evidence_id uuid NOT NULL,
  goal_id uuid NOT NULL REFERENCES goals(goal_id),
  project_id uuid NOT NULL,
  owner_id text NOT NULL CHECK (btrim(owner_id) <> '' AND length(owner_id) <= 256),
  fencing_token bigint NOT NULL CHECK (fencing_token > 0),
  reason text NOT NULL CHECK (btrim(reason) <> '' AND length(reason) <= 1024),
  recorded_by text NOT NULL CHECK (btrim(recorded_by) <> '' AND length(recorded_by) <= 256),
  role_id text NOT NULL CHECK (btrim(role_id) <> '' AND length(role_id) <= 256),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime'
);

CREATE OR REPLACE FUNCTION validate_source_evidence_loss_authorization_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM evidence_records e JOIN goals g ON g.goal_id = e.goal_id WHERE e.evidence_id = NEW.evidence_id AND e.goal_id = NEW.goal_id AND e.project_id = NEW.project_id AND g.project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'source evidence loss authorization Goal/project binding is invalid';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM local_operators WHERE operator_id = NEW.recorded_by::uuid AND active = true) OR NOT EXISTS (SELECT 1 FROM operator_project_roles r JOIN operator_project_memberships m ON m.operator_id = r.operator_id AND m.project_id = r.project_id AND m.active = true WHERE r.operator_id = NEW.recorded_by::uuid AND r.project_id = NEW.project_id AND r.role_id = NEW.role_id AND r.active = true) OR NOT EXISTS (SELECT 1 FROM goal_leases WHERE goal_id = NEW.goal_id AND owner_id = NEW.owner_id AND fencing_token = NEW.fencing_token AND expires_at > clock_timestamp()) THEN RAISE EXCEPTION 'source evidence loss authorization actor/lease is invalid'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS source_evidence_loss_authorizations_binding ON source_evidence_loss_authorizations;
CREATE TRIGGER source_evidence_loss_authorizations_binding BEFORE INSERT ON source_evidence_loss_authorizations FOR EACH ROW EXECUTE FUNCTION validate_source_evidence_loss_authorization_binding();

CREATE OR REPLACE FUNCTION reject_source_evidence_loss_authorization_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.token_hash = encode(public.digest(current_setting('maestro.source_evidence_loss_token', true), 'sha256'), 'hex') THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'source evidence loss authorizations are one-use';
END;
$$;
DROP TRIGGER IF EXISTS source_evidence_loss_authorizations_immutable ON source_evidence_loss_authorizations;
CREATE TRIGGER source_evidence_loss_authorizations_immutable BEFORE UPDATE OR DELETE ON source_evidence_loss_authorizations FOR EACH ROW EXECUTE FUNCTION reject_source_evidence_loss_authorization_mutation();



CREATE OR REPLACE FUNCTION reject_knowledge_promotion_authorization_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.token_hash = encode(public.digest(current_setting('maestro.knowledge_promotion_token', true), 'sha256'), 'hex') THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'knowledge promotion authorizations are one-use';
END;
$$;
DROP TRIGGER IF EXISTS knowledge_promotion_authorizations_immutable ON knowledge_promotion_authorizations;
CREATE TRIGGER knowledge_promotion_authorizations_immutable BEFORE UPDATE OR DELETE ON knowledge_promotion_authorizations FOR EACH ROW EXECUTE FUNCTION reject_knowledge_promotion_authorization_mutation();

CREATE TABLE IF NOT EXISTS knowledge_proposal_authorizations (
  token_hash char(64) PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  knowledge_id uuid NOT NULL, revision integer NOT NULL CHECK (revision = 1),
  project_id uuid NOT NULL, goal_id uuid NOT NULL REFERENCES goals(goal_id),
  operator_id uuid NOT NULL, role_id text NOT NULL, owner_id text NOT NULL,
  fencing_token bigint NOT NULL CHECK (fencing_token > 0), actor_id text NOT NULL, session_ref text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(), retention retention_class NOT NULL DEFAULT 'project_lifetime'
);

CREATE OR REPLACE FUNCTION authorize_knowledge_proposal(p_token text, p_knowledge_id uuid, p_project_id uuid, p_goal_id uuid, p_operator_id uuid, p_role_id text, p_owner_id text, p_fencing_token bigint, p_actor_id text, p_session_ref text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF btrim(p_token) = '' OR p_actor_id <> p_owner_id OR NOT EXISTS (SELECT 1 FROM local_operators WHERE operator_id = p_operator_id AND active = true) OR NOT EXISTS (SELECT 1 FROM operator_project_roles r JOIN operator_project_memberships m ON m.operator_id = r.operator_id AND m.project_id = r.project_id AND m.active = true WHERE r.operator_id = p_operator_id AND r.project_id = p_project_id AND r.role_id = p_role_id AND r.active = true) OR NOT EXISTS (SELECT 1 FROM goals WHERE goal_id = p_goal_id AND project_id = p_project_id) OR NOT EXISTS (SELECT 1 FROM goal_leases WHERE goal_id = p_goal_id AND owner_id = p_owner_id AND fencing_token = p_fencing_token AND expires_at > clock_timestamp()) THEN RAISE EXCEPTION 'knowledge proposal authorization context is invalid'; END IF;
  INSERT INTO knowledge_proposal_authorizations (token_hash, knowledge_id, project_id, goal_id, operator_id, role_id, owner_id, fencing_token, actor_id, session_ref) VALUES (encode(public.digest(p_token, 'sha256'), 'hex'), p_knowledge_id, p_project_id, p_goal_id, p_operator_id, p_role_id, p_owner_id, p_fencing_token, p_actor_id, p_session_ref);
  PERFORM set_config('maestro.knowledge_proposal_token', p_token, true); PERFORM set_config('maestro.knowledge_proposal_operator', p_operator_id::text, true); PERFORM set_config('maestro.knowledge_proposal_owner', p_owner_id, true); PERFORM set_config('maestro.knowledge_proposal_fence', p_fencing_token::text, true);
END;
$$;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON knowledge_proposal_authorizations FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION authorize_knowledge_proposal(text, uuid, uuid, uuid, uuid, text, text, bigint, text, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION reject_knowledge_proposal_authorization_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.token_hash = encode(public.digest(current_setting('maestro.knowledge_proposal_token', true), 'sha256'), 'hex') THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'knowledge proposal authorizations are one-use';
END;
$$;
DROP TRIGGER IF EXISTS knowledge_proposal_authorizations_immutable ON knowledge_proposal_authorizations;
CREATE TRIGGER knowledge_proposal_authorizations_immutable BEFORE UPDATE OR DELETE ON knowledge_proposal_authorizations FOR EACH ROW EXECUTE FUNCTION reject_knowledge_proposal_authorization_mutation();

CREATE OR REPLACE FUNCTION authorize_knowledge_promotion(p_token text, p_knowledge_id uuid, p_revision integer, p_scope text, p_role_id text, p_department_id text, p_operator_id uuid, p_project_id uuid, p_goal_id uuid, p_owner_id text, p_fencing_token bigint) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF btrim(p_token) = '' OR NOT EXISTS (SELECT 1 FROM local_operators WHERE operator_id = p_operator_id AND active = true) OR NOT EXISTS (SELECT 1 FROM operator_project_roles r JOIN operator_project_memberships m ON m.operator_id = r.operator_id AND m.project_id = r.project_id AND m.active = true WHERE r.operator_id = p_operator_id AND r.project_id = p_project_id AND r.role_id = p_role_id AND r.active = true) OR NOT EXISTS (SELECT 1 FROM goal_leases WHERE goal_id = p_goal_id AND owner_id = p_owner_id AND fencing_token = p_fencing_token AND expires_at > clock_timestamp()) OR NOT EXISTS (SELECT 1 FROM organizational_knowledge WHERE knowledge_id = p_knowledge_id AND revision = p_revision - 1 AND source_project_id = p_project_id AND source_goal_id = p_goal_id) THEN RAISE EXCEPTION 'knowledge promotion authorization context is invalid'; END IF;
  INSERT INTO knowledge_promotion_authorizations (token_hash, knowledge_id, revision, scope, role_id, department_id, operator_id, goal_id, owner_id, fencing_token) VALUES (encode(public.digest(p_token, 'sha256'), 'hex'), p_knowledge_id, p_revision, p_scope, p_role_id, p_department_id, p_operator_id, p_goal_id, p_owner_id, p_fencing_token);
  PERFORM set_config('maestro.knowledge_promotion_token', p_token, true); PERFORM set_config('maestro.knowledge_promotion_operator', p_operator_id::text, true); PERFORM set_config('maestro.knowledge_promotion_goal', p_goal_id::text, true); PERFORM set_config('maestro.knowledge_promotion_owner', p_owner_id, true); PERFORM set_config('maestro.knowledge_promotion_fence', p_fencing_token::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION authorize_source_evidence_loss(p_token text, p_evidence_id uuid, p_goal_id uuid, p_project_id uuid, p_owner_id text, p_fencing_token bigint, p_reason text, p_recorded_by uuid, p_role_id text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF btrim(p_token) = '' OR NOT EXISTS (SELECT 1 FROM local_operators WHERE operator_id = p_recorded_by AND active = true) OR NOT EXISTS (SELECT 1 FROM operator_project_roles r JOIN operator_project_memberships m ON m.operator_id = r.operator_id AND m.project_id = r.project_id AND m.active = true WHERE r.operator_id = p_recorded_by AND r.project_id = p_project_id AND r.role_id = p_role_id AND r.active = true) OR NOT EXISTS (SELECT 1 FROM goal_leases WHERE goal_id = p_goal_id AND owner_id = p_owner_id AND fencing_token = p_fencing_token AND expires_at > clock_timestamp()) OR NOT EXISTS (SELECT 1 FROM evidence_records e JOIN goals g ON g.goal_id = e.goal_id WHERE e.evidence_id = p_evidence_id AND e.goal_id = p_goal_id AND e.project_id = p_project_id AND g.project_id = p_project_id) THEN RAISE EXCEPTION 'source evidence loss authorization context is invalid'; END IF;
  INSERT INTO source_evidence_loss_authorizations (token_hash, evidence_id, goal_id, project_id, owner_id, fencing_token, reason, recorded_by, role_id) VALUES (encode(public.digest(p_token, 'sha256'), 'hex'), p_evidence_id, p_goal_id, p_project_id, p_owner_id, p_fencing_token, p_reason, p_recorded_by::text, p_role_id);
  PERFORM set_config('maestro.source_evidence_loss_token', p_token, true); PERFORM set_config('maestro.source_loss_owner', p_owner_id, true); PERFORM set_config('maestro.source_loss_fence', p_fencing_token::text, true);
END;
$$;

-- Marker rows are not an application-role write surface. Promotion code runs as the migration owner; deployed app roles must use a narrowly scoped DB function or equivalent owner boundary.
REVOKE TRUNCATE ON goals, evidence_records, organizational_knowledge, source_evidence_loss_events, source_evidence_loss_authorizations, knowledge_promotion_authorizations FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON knowledge_promotion_authorizations FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON source_evidence_loss_authorizations FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION authorize_knowledge_promotion(text, uuid, integer, text, text, text, uuid, uuid, uuid, text, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION authorize_source_evidence_loss(text, uuid, uuid, uuid, text, bigint, text, uuid, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION reject_evidence_record_mutation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1 FROM source_evidence_loss_authorizations a
     WHERE a.evidence_id = OLD.evidence_id AND a.goal_id = OLD.goal_id AND a.project_id = OLD.project_id
       AND a.owner_id = current_setting('maestro.source_loss_owner', true)
       AND a.fencing_token = current_setting('maestro.source_loss_fence', true)::bigint
       AND a.token_hash = encode(public.digest(current_setting('maestro.source_evidence_loss_token', true), 'sha256'), 'hex')
       AND EXISTS (SELECT 1 FROM source_evidence_loss_events e WHERE e.evidence_id = OLD.evidence_id AND e.goal_id = OLD.goal_id AND e.project_id = OLD.project_id AND e.owner_id = a.owner_id AND e.fencing_token = a.fencing_token AND e.reason = a.reason AND e.recorded_by = a.recorded_by)
  ) THEN
    PERFORM propagate_organizational_knowledge_evidence_loss(OLD.evidence_id, (SELECT a.reason FROM source_evidence_loss_authorizations a WHERE a.evidence_id = OLD.evidence_id AND a.token_hash = encode(public.digest(current_setting('maestro.source_evidence_loss_token', true), 'sha256'), 'hex')), (SELECT a.recorded_by FROM source_evidence_loss_authorizations a WHERE a.evidence_id = OLD.evidence_id AND a.token_hash = encode(public.digest(current_setting('maestro.source_evidence_loss_token', true), 'sha256'), 'hex')));
    DELETE FROM source_evidence_loss_authorizations WHERE evidence_id = OLD.evidence_id AND token_hash = encode(public.digest(current_setting('maestro.source_evidence_loss_token', true), 'sha256'), 'hex');
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'evidence records are immutable';
END;
$$;

CREATE OR REPLACE FUNCTION maestro_goal_truncate_reset() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF session_user <> (SELECT tableowner FROM pg_catalog.pg_tables WHERE schemaname = TG_TABLE_SCHEMA AND tablename = TG_TABLE_NAME) THEN RAISE EXCEPTION 'schema cleanup reset requires the goals table owner'; END IF;
  PERFORM set_config('maestro.schema_cleanup_reset', '1', true);
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS maestro_goal_truncate_reset ON goals;
CREATE TRIGGER maestro_goal_truncate_reset BEFORE TRUNCATE ON goals FOR EACH STATEMENT EXECUTE FUNCTION maestro_goal_truncate_reset();

CREATE OR REPLACE FUNCTION reject_unscoped_truncate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF current_setting('maestro.schema_cleanup_reset', true) IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'direct table truncation is forbidden; truncate goals CASCADE for test reset'; END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS organizational_knowledge_no_truncate ON organizational_knowledge;
CREATE TRIGGER organizational_knowledge_no_truncate BEFORE TRUNCATE ON organizational_knowledge FOR EACH STATEMENT EXECUTE FUNCTION reject_unscoped_truncate();
DROP TRIGGER IF EXISTS evidence_records_no_truncate ON evidence_records;
CREATE TRIGGER evidence_records_no_truncate BEFORE TRUNCATE ON evidence_records FOR EACH STATEMENT EXECUTE FUNCTION reject_unscoped_truncate();
DROP TRIGGER IF EXISTS source_evidence_loss_events_no_truncate ON source_evidence_loss_events;
CREATE TRIGGER source_evidence_loss_events_no_truncate BEFORE TRUNCATE ON source_evidence_loss_events FOR EACH STATEMENT EXECUTE FUNCTION reject_unscoped_truncate();
DROP TRIGGER IF EXISTS source_evidence_loss_authorizations_no_truncate ON source_evidence_loss_authorizations;
CREATE TRIGGER source_evidence_loss_authorizations_no_truncate BEFORE TRUNCATE ON source_evidence_loss_authorizations FOR EACH STATEMENT EXECUTE FUNCTION reject_unscoped_truncate();
DROP TRIGGER IF EXISTS knowledge_promotion_authorizations_no_truncate ON knowledge_promotion_authorizations;
CREATE TRIGGER knowledge_promotion_authorizations_no_truncate BEFORE TRUNCATE ON knowledge_promotion_authorizations FOR EACH STATEMENT EXECUTE FUNCTION reject_unscoped_truncate();
DROP TRIGGER IF EXISTS knowledge_proposal_authorizations_no_truncate ON knowledge_proposal_authorizations;
CREATE TRIGGER knowledge_proposal_authorizations_no_truncate BEFORE TRUNCATE ON knowledge_proposal_authorizations FOR EACH STATEMENT EXECUTE FUNCTION reject_unscoped_truncate();

DO $$
DECLARE knowledge_schema text := current_schema();
BEGIN
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.validate_organizational_knowledge_insert() SET search_path = pg_catalog, %I', knowledge_schema, knowledge_schema);
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.reject_organizational_knowledge_mutation() SET search_path = pg_catalog, %I', knowledge_schema, knowledge_schema);
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.reject_source_evidence_loss_event_mutation() SET search_path = pg_catalog, %I', knowledge_schema, knowledge_schema);
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.propagate_organizational_knowledge_evidence_loss(uuid, text, text) SET search_path = pg_catalog, %I', knowledge_schema, knowledge_schema);
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.reject_evidence_record_mutation() SET search_path = pg_catalog, %I', knowledge_schema, knowledge_schema);
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.validate_source_evidence_loss_event_binding() SET search_path = pg_catalog, %I', knowledge_schema, knowledge_schema);
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.validate_source_evidence_loss_authorization_binding() SET search_path = pg_catalog, %I', knowledge_schema, knowledge_schema);
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.reject_source_evidence_loss_authorization_mutation() SET search_path = pg_catalog, %I', knowledge_schema, knowledge_schema);
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.reject_knowledge_promotion_authorization_mutation() SET search_path = pg_catalog, %I', knowledge_schema, knowledge_schema);
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.maestro_goal_truncate_reset() SET search_path = pg_catalog, %I', knowledge_schema, knowledge_schema);
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.reject_unscoped_truncate() SET search_path = pg_catalog, %I', knowledge_schema, knowledge_schema);
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.authorize_knowledge_promotion(text, uuid, integer, text, text, text, uuid, uuid, uuid, text, bigint) SET search_path = pg_catalog, %I', knowledge_schema, knowledge_schema);
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.authorize_source_evidence_loss(text, uuid, uuid, uuid, text, bigint, text, uuid, text) SET search_path = pg_catalog, %I', knowledge_schema, knowledge_schema);
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.authorize_knowledge_proposal(text, uuid, uuid, uuid, uuid, text, text, bigint, text, text) SET search_path = pg_catalog, %I', knowledge_schema, knowledge_schema);
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.reject_knowledge_proposal_authorization_mutation() SET search_path = pg_catalog, %I', knowledge_schema, knowledge_schema);
END;
$$;
