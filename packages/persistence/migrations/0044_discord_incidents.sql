-- Discord incident identity, deduplication, scoring snapshots, and watchdog
-- silence checks. Signal rows remain immutable; incident state is the small,
-- bounded aggregate built from those durable observations.

CREATE TABLE IF NOT EXISTS discord_incidents (
  incident_id uuid PRIMARY KEY,
  incident_fingerprint text NOT NULL CHECK (btrim(incident_fingerprint) <> ''),
  affected_version text NOT NULL CHECK (btrim(affected_version) <> ''),
  first_observed_at timestamptz NOT NULL,
  last_observed_at timestamptz NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info','warning','critical')),
  confidence double precision NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  affected_component text NOT NULL CHECK (btrim(affected_component) <> ''),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','triaging','remediating','resolved','false_positive')),
  signal_count integer NOT NULL DEFAULT 0 CHECK (signal_count >= 0),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (incident_fingerprint, affected_version),
  CHECK (last_observed_at >= first_observed_at)
);
CREATE INDEX IF NOT EXISTS discord_incidents_status_idx ON discord_incidents (status, updated_at);

CREATE TABLE IF NOT EXISTS discord_incident_signals (
  incident_id uuid NOT NULL REFERENCES discord_incidents (incident_id),
  signal_id uuid NOT NULL REFERENCES discord_signals (signal_id),
  attached_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (incident_id, signal_id),
  UNIQUE (signal_id)
);
CREATE INDEX IF NOT EXISTS discord_incident_signals_signal_idx ON discord_incident_signals (signal_id);

CREATE TABLE IF NOT EXISTS discord_watchdog_checks (
  check_id uuid PRIMARY KEY,
  checked_at timestamptz NOT NULL,
  last_observed_at timestamptz,
  max_silence_ms bigint NOT NULL CHECK (max_silence_ms > 0),
  silence_ms bigint,
  state text NOT NULL CHECK (state IN ('observing','uncertain')),
  reason text CHECK (reason IS NULL OR reason IN ('discord_observation_silent','discord_observation_missing')),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CHECK ((state = 'observing' AND reason IS NULL) OR (state = 'uncertain' AND reason IS NOT NULL)),
  CHECK (silence_ms IS NULL OR silence_ms >= 0)
);
CREATE INDEX IF NOT EXISTS discord_watchdog_checks_checked_idx ON discord_watchdog_checks (checked_at, check_id);

CREATE OR REPLACE FUNCTION reject_discord_incident_signal_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Discord incident signal links are immutable once attached';
END;
$$;
DROP TRIGGER IF EXISTS discord_incident_signals_immutable ON discord_incident_signals;
CREATE TRIGGER discord_incident_signals_immutable
  BEFORE UPDATE OR DELETE ON discord_incident_signals
  FOR EACH ROW EXECUTE FUNCTION reject_discord_incident_signal_mutation();

CREATE OR REPLACE FUNCTION reject_discord_watchdog_check_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Discord watchdog checks are immutable once recorded';
END;
$$;
DROP TRIGGER IF EXISTS discord_watchdog_checks_immutable ON discord_watchdog_checks;
CREATE TRIGGER discord_watchdog_checks_immutable
  BEFORE UPDATE OR DELETE ON discord_watchdog_checks
  FOR EACH ROW EXECUTE FUNCTION reject_discord_watchdog_check_mutation();
