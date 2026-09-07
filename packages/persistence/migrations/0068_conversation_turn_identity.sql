-- Keep the active host turn and request identity durable while provider work is in flight.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS active_turn_id uuid;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS active_request_id uuid;

-- Keep the host turn identity and idempotency key attached to both durable turn rows.
ALTER TABLE conversation_turns ADD COLUMN IF NOT EXISTS turn_ref uuid;
ALTER TABLE conversation_turns ADD COLUMN IF NOT EXISTS request_id uuid;
UPDATE conversation_turns SET turn_ref = turn_id WHERE turn_ref IS NULL;
UPDATE conversation_turns SET request_id = turn_id WHERE request_id IS NULL;
ALTER TABLE conversation_turns ALTER COLUMN turn_ref SET NOT NULL;
ALTER TABLE conversation_turns ALTER COLUMN request_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS conversation_turn_request_role_idx
  ON conversation_turns (conversation_id, request_id, role);
CREATE INDEX IF NOT EXISTS conversation_turn_ref_idx
  ON conversation_turns (conversation_id, turn_ref, role);
