-- Phase 2 P2S5 round-replay idempotency. Additive and reapply-safe.

-- Council round submissions are idempotent per (council, command/idempotency
-- identity): a durable partial unique index backs the application-level
-- check in recordCouncilRound so concurrent or direct alternate writers
-- cannot record two round_recorded events under the same identity, matching
-- the existing single-decision and single-creation event guards.
CREATE UNIQUE INDEX IF NOT EXISTS council_protocol_events_round_identity_idx
  ON council_protocol_events (council_id, command_or_idempotency_id)
  WHERE event_type = 'round_recorded';
