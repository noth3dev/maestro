-- Append-only extension of goal_controls: adds pause and stop lifecycle
-- timestamps alongside the existing emergency_stopped_at latch. Each
-- transition is applied by application code together with a control_epoch
-- bump (see packages/persistence/src/authority.ts); this migration only adds
-- durable storage for the additional modes.
ALTER TABLE goal_controls ADD COLUMN IF NOT EXISTS pause_requested_at timestamptz;
ALTER TABLE goal_controls ADD COLUMN IF NOT EXISTS paused_at timestamptz;
ALTER TABLE goal_controls ADD COLUMN IF NOT EXISTS stopping_at timestamptz;
ALTER TABLE goal_controls ADD COLUMN IF NOT EXISTS stopped_at timestamptz;

-- A Goal can only be "paused" after a pause was requested, and only
-- "stopping" precedes "stopped": enforce the ordering durably so a defective
-- application-layer transition cannot skip a required predecessor state.
ALTER TABLE goal_controls DROP CONSTRAINT IF EXISTS goal_controls_pause_order_chk;
ALTER TABLE goal_controls ADD CONSTRAINT goal_controls_pause_order_chk
  CHECK (paused_at IS NULL OR pause_requested_at IS NOT NULL);
ALTER TABLE goal_controls DROP CONSTRAINT IF EXISTS goal_controls_stop_order_chk;
ALTER TABLE goal_controls ADD CONSTRAINT goal_controls_stop_order_chk
  CHECK (stopped_at IS NULL OR stopping_at IS NOT NULL);
