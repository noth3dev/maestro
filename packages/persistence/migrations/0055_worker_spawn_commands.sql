-- Bind a successful worker spawn to its API command identity so retries can
-- return the durable worker rather than starting another provider execution.
ALTER TABLE workers
  ADD COLUMN IF NOT EXISTS spawn_command_id uuid,
  ADD COLUMN IF NOT EXISTS spawn_request_hash char(64);
ALTER TABLE workers DROP CONSTRAINT IF EXISTS workers_spawn_request_hash_check;
ALTER TABLE workers ADD CONSTRAINT workers_spawn_request_hash_check
  CHECK (spawn_request_hash IS NULL OR spawn_request_hash ~ '^[0-9a-f]{64}$');
CREATE UNIQUE INDEX IF NOT EXISTS workers_spawn_command_idx
  ON workers (spawn_command_id) WHERE spawn_command_id IS NOT NULL;
