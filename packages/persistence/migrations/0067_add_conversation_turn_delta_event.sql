-- Durable per-turn text deltas are replayed through the same conversation cursor.
ALTER TABLE conversation_events DROP CONSTRAINT IF EXISTS conversation_events_event_type_check;
ALTER TABLE conversation_events ADD CONSTRAINT conversation_events_event_type_check CHECK (event_type IN (
  'conversation_created', 'turn_started', 'turn_delta', 'turn_completed', 'turn_failed', 'turn_cancelled', 'turn_unknown'
));
