DO $$
DECLARE
  duplicate_groups bigint;
BEGIN
  SELECT count(*) INTO duplicate_groups
  FROM (
    SELECT project_id, goal_id, command_id
    FROM evidence_records
    GROUP BY project_id, goal_id, command_id
    HAVING count(*) > 1
  ) duplicates;
  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION 'evidence replay identity migration refused: % duplicate (project_id, goal_id, command_id) groups exist; reconcile evidence_records before retrying migration 0082', duplicate_groups;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS evidence_records_command_identity_idx
  ON evidence_records (project_id, goal_id, command_id);
