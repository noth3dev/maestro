-- Plan 2 §S6c: keep a completed worker session alive for one bounded repair round.
-- The requeue budget is stored in the shared capability repetition ledger;
-- these columns retain only the worker's hold identity and deadline.
ALTER TABLE workers
  ADD COLUMN IF NOT EXISTS repair_hold_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS repair_approval_id uuid REFERENCES capability_approvals (approval_id);

ALTER TABLE workers DROP CONSTRAINT IF EXISTS workers_status_check;
ALTER TABLE workers ADD CONSTRAINT workers_status_check
  CHECK (status IN ('spawned', 'running', 'awaiting_repair', 'succeeded', 'failed', 'cancelled', 'unknown'));

ALTER TABLE workers DROP CONSTRAINT IF EXISTS workers_repair_hold_check;
ALTER TABLE workers ADD CONSTRAINT workers_repair_hold_check
  CHECK ((status = 'awaiting_repair') = (repair_hold_expires_at IS NOT NULL AND repair_approval_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS workers_repair_hold_expiry_idx
  ON workers (repair_hold_expires_at)
  WHERE status = 'awaiting_repair';
