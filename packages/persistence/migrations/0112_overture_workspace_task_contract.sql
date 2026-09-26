-- Overture Runs may bind their Task Contract to an exact session workspace
-- commit (task.md plus the reviewed files) instead of a DB plan manifest.
ALTER TABLE overture_runs DROP CONSTRAINT IF EXISTS overture_runs_task_contract_ref_check;
ALTER TABLE overture_runs ADD CONSTRAINT overture_runs_task_contract_ref_check CHECK (
  task_contract_ref IS NULL
  OR (
    jsonb_typeof(task_contract_ref) = 'object'
    AND (
      (task_contract_ref ? 'planId' AND task_contract_ref ? 'version' AND task_contract_ref ? 'manifestHash')
      OR (
        task_contract_ref ? 'workspaceRevision'
        AND task_contract_ref ? 'taskPath'
        AND task_contract_ref ? 'contentHash'
        AND task_contract_ref->>'workspaceRevision' ~ '^[0-9a-f]{40}$'
        AND task_contract_ref->>'contentHash' ~ '^[0-9a-f]{64}$'
      )
    )
  )
);
