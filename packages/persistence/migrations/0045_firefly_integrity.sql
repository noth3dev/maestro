-- Phase 4 step 7 hardening: close a direct-SQL integrity gap found in
-- independent review of 0041_firefly_incidents.sql. Additive only.
--
-- firefly_incident_signals had independent foreign keys and UNIQUE(signal_id)
-- but nothing bound the linked incident's (incident_fingerprint,
-- affected_version) to the linked signal's own identity, so a direct SQL
-- INSERT could attach a signal to an unrelated incident and corrupt the
-- durable dedup lineage. The application path always chooses the right
-- key; this trigger makes that the only path that can succeed.
CREATE OR REPLACE FUNCTION reject_mismatched_firefly_incident_signal_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  incident_fingerprint text;
  incident_affected_version text;
  signal_fingerprint text;
  signal_affected_version text;
BEGIN
  SELECT i.incident_fingerprint, i.affected_version INTO incident_fingerprint, incident_affected_version
    FROM firefly_incidents AS i WHERE i.incident_id = NEW.incident_id;
  SELECT s.incident_fingerprint, s.affected_version INTO signal_fingerprint, signal_affected_version
    FROM firefly_signals AS s WHERE s.signal_id = NEW.signal_id;
  IF incident_fingerprint IS DISTINCT FROM signal_fingerprint OR incident_affected_version IS DISTINCT FROM signal_affected_version THEN
    RAISE EXCEPTION 'Firefly incident-signal link identity mismatch';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS firefly_incident_signals_identity_check ON firefly_incident_signals;
CREATE TRIGGER firefly_incident_signals_identity_check BEFORE INSERT ON firefly_incident_signals
  FOR EACH ROW EXECUTE FUNCTION reject_mismatched_firefly_incident_signal_link();
