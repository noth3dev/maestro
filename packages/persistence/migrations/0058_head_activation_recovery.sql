-- Durable Head activation provider binding and recovery state. A provider spawn
-- can succeed after the lease expires; retain opaque refs so reconciliation can
-- cancel or inspect that session instead of creating an unowned retry.
ALTER TABLE head_activation_commands
  ADD COLUMN IF NOT EXISTS provider_execution_ref text,
  ADD COLUMN IF NOT EXISTS provider_invocation_ref text;
ALTER TABLE head_activation_commands DROP CONSTRAINT IF EXISTS head_activation_commands_status_check;
ALTER TABLE head_activation_commands
  ADD CONSTRAINT head_activation_commands_status_check
  CHECK (status IN ('reserved', 'spawn_started', 'active', 'orphaned'));
