CREATE OR REPLACE FUNCTION persona_goal_evidence_overlay_valid(value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE axis text; axes constant text[] := ARRAY['agreeableness','extraversion','imagination','realism','conscientiousness','caution','initiative','empathy','adaptability','sociability'];
BEGIN
  IF jsonb_typeof(value) <> 'object' THEN RETURN false; END IF;
  FOR axis IN SELECT jsonb_object_keys(value) LOOP
    IF NOT (axis = ANY(axes)) OR jsonb_typeof(value -> axis) <> 'number' OR (value ->> axis)::numeric < -0.15 OR (value ->> axis)::numeric > 0.15 THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION persona_goal_evidence_payload_valid(value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE field text;
  expected constant text[] := ARRAY['projectId','goalId','roleId','taskClass','taskContractVersion','activeProfileVersion','missionOverlay','modelRef','skills','tools','contextSizeTokens','budgetCents','collaboratorSet','qualityFindings','securityFindings','safetyFindings','finalCertification','reworkCount','retryCount','planRevisionCount','escapedDefectCount','timeToFirstUsefulOutputMs','timeToCertifiedCompletionMs','tokenCost','monetaryCostCents','usefulMessageCount','unnecessaryMessageCount','scopeViolationCount','authorityDenialCount','safePauseCount','falsePositivePauseCount','dissentQuality','dissentChangedOutcome','userCorrections','explicitFeedback','comparedProfileVersions'];
  text_fields constant text[] := ARRAY['projectId','goalId','roleId','taskClass','modelRef','finalCertification','dissentQuality'];
  list_fields constant text[] := ARRAY['skills','tools','collaboratorSet','qualityFindings','securityFindings','safetyFindings','userCorrections','comparedProfileVersions'];
  numeric_fields constant text[] := ARRAY['taskContractVersion','activeProfileVersion','contextSizeTokens','budgetCents','reworkCount','retryCount','planRevisionCount','escapedDefectCount','timeToFirstUsefulOutputMs','timeToCertifiedCompletionMs','tokenCost','monetaryCostCents','usefulMessageCount','unnecessaryMessageCount','scopeViolationCount','authorityDenialCount','safePauseCount','falsePositivePauseCount'];
BEGIN
  IF jsonb_typeof(value) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(value)) <> cardinality(expected) THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(value) AS candidate_key WHERE NOT (candidate_key = ANY(expected))) THEN RETURN false; END IF;
  FOREACH field IN ARRAY expected LOOP IF NOT (value ? field) THEN RETURN false; END IF; END LOOP;
  FOREACH field IN ARRAY text_fields LOOP IF jsonb_typeof(value -> field) <> 'string' OR btrim(value ->> field) = '' THEN RETURN false; END IF; END LOOP;
  IF jsonb_typeof(value -> 'explicitFeedback') <> 'string' OR (value ->> 'explicitFeedback') ~ '[\r\n]' THEN RETURN false; END IF;
  FOREACH field IN ARRAY list_fields LOOP
    IF jsonb_typeof(value -> field) <> 'array' OR EXISTS (SELECT 1 FROM jsonb_array_elements(value -> field) item WHERE jsonb_typeof(item) <> 'string' OR btrim(item #>> '{}') = '' OR (item #>> '{}') ~ '[\r\n]') THEN RETURN false; END IF;
  END LOOP;
  FOREACH field IN ARRAY numeric_fields LOOP IF jsonb_typeof(value -> field) <> 'number' OR (value ->> field)::numeric < 0 THEN RETURN false; END IF; END LOOP;
  IF jsonb_typeof(value -> 'dissentChangedOutcome') <> 'boolean' OR NOT persona_goal_evidence_overlay_valid(value -> 'missionOverlay') THEN RETURN false; END IF;
  RETURN true;
END;
$$;

CREATE TABLE IF NOT EXISTS persona_goal_evidence (
  evidence_id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  goal_id uuid NOT NULL REFERENCES goals(goal_id),
  role_id text NOT NULL REFERENCES permanent_roles(role_id),
  task_class text NOT NULL CHECK (btrim(task_class) <> '' AND task_class !~ '[\r\n]'),
  task_contract_version integer NOT NULL CHECK (task_contract_version >= 0),
  active_profile_version integer NOT NULL CHECK (active_profile_version > 0),
  mission_overlay jsonb NOT NULL CHECK (persona_goal_evidence_overlay_valid(mission_overlay)),
  payload jsonb NOT NULL CHECK (persona_goal_evidence_payload_valid(payload)),
  CHECK (payload -> 'missionOverlay' = mission_overlay),
  CHECK ((payload ->> 'projectId')::uuid = project_id),
  CHECK ((payload ->> 'goalId')::uuid = goal_id),
  CHECK (payload ->> 'roleId' = role_id),
  CHECK (payload ->> 'taskClass' = task_class),
  CHECK ((payload ->> 'taskContractVersion')::integer = task_contract_version),
  CHECK ((payload ->> 'activeProfileVersion')::integer = active_profile_version),
  payload_hash bytea NOT NULL CHECK (octet_length(payload_hash) = 32),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime',
  UNIQUE (goal_id, role_id, task_class, payload_hash)
);
CREATE INDEX IF NOT EXISTS persona_goal_evidence_goal_idx ON persona_goal_evidence (goal_id, created_at, evidence_id);

CREATE OR REPLACE FUNCTION reject_persona_goal_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'persona Goal evidence is append-only';
END;
$$;
DROP TRIGGER IF EXISTS persona_goal_evidence_immutable ON persona_goal_evidence;
CREATE TRIGGER persona_goal_evidence_immutable
BEFORE UPDATE OR DELETE ON persona_goal_evidence
FOR EACH ROW EXECUTE FUNCTION reject_persona_goal_evidence_mutation();
