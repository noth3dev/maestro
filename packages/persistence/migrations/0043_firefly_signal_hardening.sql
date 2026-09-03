-- Firefly signal hardening.  Existing received signals are immutable and
-- writer transactions serialize the replay high-water mark in persistence.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'firefly_signals'::regclass
       AND conname = 'firefly_signals_observation_order'
  ) THEN
    ALTER TABLE firefly_signals
      ADD CONSTRAINT firefly_signals_observation_order
      CHECK (last_observed_at >= first_observed_at);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'firefly_signals'::regclass
       AND conname = 'firefly_signals_reproduction_evidence_array'
  ) THEN
    ALTER TABLE firefly_signals
      ADD CONSTRAINT firefly_signals_reproduction_evidence_array
      CHECK (jsonb_typeof(minimal_reproduction_evidence) = 'array');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION reject_firefly_signal_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Firefly signals are immutable once received';
END;
$$;
DROP TRIGGER IF EXISTS firefly_signals_immutable ON firefly_signals;
CREATE TRIGGER firefly_signals_immutable
  BEFORE UPDATE OR DELETE ON firefly_signals
  FOR EACH ROW EXECUTE FUNCTION reject_firefly_signal_mutation();
