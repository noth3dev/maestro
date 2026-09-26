-- Crew tool use (Python runs and workspace file reads/writes) is recorded as
-- Overture events so the session chat can show what each role did.
ALTER TABLE overture_events DROP CONSTRAINT IF EXISTS overture_events_event_type_check;
ALTER TABLE overture_events ADD CONSTRAINT overture_events_event_type_check CHECK (event_type IN ('run_created', 'role_activated', 'message_appended', 'clarification_opened', 'clarification_answered', 'artifact_created', 'artifact_revision_created', 'plan_revision_created', 'manifest_revision_created', 'synthesis_started', 'review_ready', 'launch_ready', 'run_state_changed', 'task_contract_attached', 'tool_activity'));
