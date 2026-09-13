CREATE OR REPLACE FUNCTION persona_profile_shape_valid(profile jsonb, rationale jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  axis text;
  field text;
  value jsonb;
  axes constant text[] := ARRAY['agreeableness', 'extraversion', 'imagination', 'realism', 'conscientiousness', 'caution', 'initiative', 'empathy', 'adaptability', 'sociability'];
BEGIN
  IF jsonb_typeof(profile) <> 'object' OR (SELECT count(*) FROM jsonb_each(profile)) <> 10 THEN RETURN false; END IF;
  IF jsonb_typeof(rationale) <> 'object' OR (SELECT count(*) FROM jsonb_each(rationale)) <> 10 THEN RETURN false; END IF;
  FOREACH axis IN ARRAY axes LOOP
    IF NOT (profile ? axis) OR jsonb_typeof(profile -> axis) <> 'number' THEN RETURN false; END IF;
    IF (profile ->> axis)::numeric < 0 OR (profile ->> axis)::numeric > 1 THEN RETURN false; END IF;
    IF NOT (rationale ? axis) OR jsonb_typeof(rationale -> axis) <> 'object' OR (SELECT count(*) FROM jsonb_each(rationale -> axis)) <> 4 THEN RETURN false; END IF;
    FOREACH field IN ARRAY ARRAY['reason', 'low', 'current', 'high'] LOOP
      value := rationale -> axis -> field;
      IF NOT (rationale -> axis ? field) OR jsonb_typeof(value) <> 'string' OR btrim(value #>> '{}') = '' OR position(E'\n' in value #>> '{}') > 0 OR position(E'\r' in value #>> '{}') > 0 THEN RETURN false; END IF;
    END LOOP;
  END LOOP;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION persona_task_delta_valid(delta jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  axis text;
  axes constant text[] := ARRAY['agreeableness', 'extraversion', 'imagination', 'realism', 'conscientiousness', 'caution', 'initiative', 'empathy', 'adaptability', 'sociability'];
BEGIN
  IF jsonb_typeof(delta) <> 'object' OR (SELECT count(*) FROM jsonb_each(delta)) > 2 THEN RETURN false; END IF;
  FOR axis IN SELECT jsonb_object_keys(delta) LOOP
    IF NOT (axis = ANY(axes)) OR jsonb_typeof(delta -> axis) <> 'number' THEN RETURN false; END IF;
    IF (delta ->> axis)::numeric < -1 OR (delta ->> axis)::numeric > 1 THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$;

CREATE TABLE IF NOT EXISTS persona_profile_versions (
  role_id text NOT NULL REFERENCES permanent_roles(role_id),
  version integer NOT NULL CHECK (version > 0),
  profile jsonb NOT NULL,
  rationale jsonb NOT NULL,
  source text NOT NULL CHECK (btrim(source) <> '' AND source !~ '[\r\n]'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (role_id, version),
  CHECK (persona_profile_shape_valid(profile, rationale))
);

CREATE TABLE IF NOT EXISTS persona_task_class_adjustments (
  role_id text NOT NULL REFERENCES permanent_roles(role_id),
  task_class text NOT NULL CHECK (btrim(task_class) <> '' AND task_class !~ '[\r\n]'),
  version integer NOT NULL CHECK (version > 0),
  delta jsonb NOT NULL CHECK (persona_task_delta_valid(delta)),
  reason text NOT NULL CHECK (btrim(reason) <> '' AND reason !~ '[\r\n]'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (role_id, task_class, version)
);

CREATE INDEX IF NOT EXISTS persona_profile_versions_active_idx
  ON persona_profile_versions (role_id, version DESC);
CREATE INDEX IF NOT EXISTS persona_task_class_adjustments_active_idx
  ON persona_task_class_adjustments (role_id, task_class, version DESC);

CREATE OR REPLACE FUNCTION reject_persona_adaptive_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'persona adaptive history is append-only';
END;
$$;

DROP TRIGGER IF EXISTS persona_profile_versions_immutable ON persona_profile_versions;
CREATE TRIGGER persona_profile_versions_immutable
BEFORE UPDATE OR DELETE ON persona_profile_versions
FOR EACH ROW EXECUTE FUNCTION reject_persona_adaptive_mutation();

DROP TRIGGER IF EXISTS persona_task_class_adjustments_immutable ON persona_task_class_adjustments;
CREATE TRIGGER persona_task_class_adjustments_immutable
BEFORE UPDATE OR DELETE ON persona_task_class_adjustments
FOR EACH ROW EXECUTE FUNCTION reject_persona_adaptive_mutation();
