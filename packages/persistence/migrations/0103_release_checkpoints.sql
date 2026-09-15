-- Plan 8 §S1: additive, immutable release-candidate freeze checkpoints.
-- The checkpoint stores the normalized identity and the exact export hash used
-- to recover the candidate. Re-recording the same candidate is idempotent.
CREATE TABLE IF NOT EXISTS release_checkpoints (
  candidate_id text PRIMARY KEY CHECK (candidate_id ~ '^[0-9a-f]{64}$'),
  identity jsonb NOT NULL CHECK (jsonb_typeof(identity) = 'object' AND identity->>'schemaVersion' = '1'),
  database_export_path text NOT NULL CHECK (btrim(database_export_path) <> '' AND length(database_export_path) <= 4096 AND database_export_path !~ E'[\r\n]'),
  database_export_sha256 text NOT NULL CHECK (database_export_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
REVOKE ALL ON release_checkpoints FROM PUBLIC;

CREATE OR REPLACE FUNCTION prevent_release_checkpoint_mutation()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'release checkpoints are append-only';
END;
$$;
DROP TRIGGER IF EXISTS release_checkpoints_append_only_row ON release_checkpoints;
CREATE TRIGGER release_checkpoints_append_only_row
BEFORE UPDATE OR DELETE ON release_checkpoints
FOR EACH ROW EXECUTE FUNCTION prevent_release_checkpoint_mutation();
DROP TRIGGER IF EXISTS release_checkpoints_append_only_truncate ON release_checkpoints;
CREATE TRIGGER release_checkpoints_append_only_truncate
BEFORE TRUNCATE ON release_checkpoints
FOR EACH STATEMENT EXECUTE FUNCTION prevent_release_checkpoint_mutation();
