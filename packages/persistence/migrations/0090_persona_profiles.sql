CREATE TABLE IF NOT EXISTS persona_profile_versions (
  role_id text NOT NULL REFERENCES permanent_roles(role_id),
  version integer NOT NULL CHECK (version > 0),
  profile jsonb NOT NULL CHECK (jsonb_typeof(profile) = 'object'),
  rationale jsonb NOT NULL CHECK (jsonb_typeof(rationale) = 'object'),
  source text NOT NULL CHECK (source <> ''),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (role_id, version)
);

CREATE TABLE IF NOT EXISTS persona_task_class_adjustments (
  role_id text NOT NULL REFERENCES permanent_roles(role_id),
  task_class text NOT NULL CHECK (task_class <> ''),
  version integer NOT NULL CHECK (version > 0),
  delta jsonb NOT NULL CHECK (jsonb_typeof(delta) = 'object'),
  reason text NOT NULL CHECK (reason <> ''),
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
