-- Discord signal hardening.  Existing received signals are immutable and
-- writer transactions serialize the replay high-water mark in persistence.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'discord_signals'::regclass
       AND conname = 'discord_signals_observation_order'
  ) THEN
    ALTER TABLE discord_signals
      ADD CONSTRAINT discord_signals_observation_order
      CHECK (last_observed_at >= first_observed_at);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'discord_signals'::regclass
       AND conname = 'discord_signals_reproduction_evidence_array'
  ) THEN
    ALTER TABLE discord_signals
      ADD CONSTRAINT discord_signals_reproduction_evidence_array
      CHECK (jsonb_typeof(minimal_reproduction_evidence) = 'array');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION reject_discord_signal_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Discord signals are immutable once received';
END;
$$;
DROP TRIGGER IF EXISTS discord_signals_immutable ON discord_signals;
CREATE TRIGGER discord_signals_immutable
  BEFORE UPDATE OR DELETE ON discord_signals
  FOR EACH ROW EXECUTE FUNCTION reject_discord_signal_mutation();
