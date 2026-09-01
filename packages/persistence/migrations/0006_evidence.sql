CREATE TABLE IF NOT EXISTS evidence_records (
  evidence_id uuid PRIMARY KEY,
  correlation_id uuid NOT NULL,
  command_id uuid NOT NULL,
  project_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  actor_id text NOT NULL CHECK (actor_id <> ''),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  byte_length bigint NOT NULL CHECK (byte_length >= 0),
  kind text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9._-]{0,127}$'),
  media_type text NOT NULL CHECK (media_type ~ '^[a-z]+/[a-z0-9.+-]+(;[a-z0-9._-]+=[a-z0-9._-]+)*$'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  record_version integer NOT NULL DEFAULT 1 CHECK (record_version = 1),
  retention retention_class NOT NULL DEFAULT 'project_lifetime'
);
CREATE INDEX IF NOT EXISTS evidence_records_goal_created_idx ON evidence_records (project_id, goal_id, created_at, evidence_id);
CREATE INDEX IF NOT EXISTS evidence_records_sha256_idx ON evidence_records (sha256);

CREATE OR REPLACE FUNCTION reject_evidence_record_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'evidence records are immutable';
END;
$$;
DROP TRIGGER IF EXISTS evidence_records_immutable ON evidence_records;
CREATE TRIGGER evidence_records_immutable BEFORE UPDATE OR DELETE ON evidence_records
  FOR EACH ROW EXECUTE FUNCTION reject_evidence_record_mutation();
