-- E5 Task 15: bind the awaiting Task Contract to its exact Overture run and plan manifest.
ALTER TABLE overture_runs
  ADD COLUMN IF NOT EXISTS task_contract_id uuid NULL REFERENCES task_contracts(contract_id);
CREATE INDEX IF NOT EXISTS overture_runs_task_contract_idx ON overture_runs (task_contract_id) WHERE task_contract_id IS NOT NULL;

ALTER TABLE overture_events DROP CONSTRAINT IF EXISTS overture_events_event_type_check;
ALTER TABLE overture_events ADD CONSTRAINT overture_events_event_type_check CHECK (event_type IN ('run_created', 'role_activated', 'message_appended', 'clarification_opened', 'clarification_answered', 'artifact_created', 'artifact_revision_created', 'plan_revision_created', 'manifest_revision_created', 'synthesis_started', 'review_ready', 'launch_ready', 'run_state_changed', 'task_contract_attached'));
