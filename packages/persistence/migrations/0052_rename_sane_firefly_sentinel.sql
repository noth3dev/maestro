-- Naming unification: "Sane" / "Firefly" / "Sentinel" (working codenames)
-- -> "Concertmaster" / "Discord" / "Metronome" (adopted product terminology).
-- This is additive-only per this project's migration-ledger discipline (see
-- packages/persistence/src/migrate.ts): no existing migration file's
-- content or filename is edited, since the ledger verifies each applied
-- file's checksum by filename and a modified/renamed historical file would
-- either fail closed with MigrationChecksumMismatchError or silently
-- resurrect an already-superseded table under its old name. This migration
-- only renames the durable objects created by 0018, 0028, 0029, 0036, 0037,
-- 0042-0045, 0047, and 0048, and migrates stored data values, never drops
-- or recreates the underlying rows.

-- ---------------------------------------------------------------------
-- Sane -> Concertmaster (0036_sane_final_reports.sql)
-- ---------------------------------------------------------------------
ALTER TABLE IF EXISTS sane_final_reports RENAME TO concertmaster_final_reports;
ALTER INDEX IF EXISTS sane_final_reports_goal_idx RENAME TO concertmaster_final_reports_goal_idx;

ALTER TRIGGER sane_final_reports_immutable ON concertmaster_final_reports RENAME TO concertmaster_final_reports_immutable;
ALTER FUNCTION reject_sane_final_report_mutation() RENAME TO reject_concertmaster_final_report_mutation;
CREATE OR REPLACE FUNCTION reject_concertmaster_final_report_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Concertmaster final reports are immutable once issued';
END;
$$;

-- ---------------------------------------------------------------------
-- Sentinel -> Metronome (0028_sentinel_findings.sql, 0029_sentinel_challenges.sql,
-- 0037_sentinel_challenge_idempotency.sql)
-- ---------------------------------------------------------------------
ALTER TABLE IF EXISTS sentinel_findings RENAME TO metronome_findings;
ALTER TABLE IF EXISTS sentinel_challenges RENAME TO metronome_challenges;
ALTER TABLE IF EXISTS sentinel_challenge_findings RENAME TO metronome_challenge_findings;

ALTER INDEX IF EXISTS sentinel_findings_goal_idx RENAME TO metronome_findings_goal_idx;
ALTER INDEX IF EXISTS sentinel_findings_unresolved_idx RENAME TO metronome_findings_unresolved_idx;
ALTER INDEX IF EXISTS sentinel_challenges_goal_idx RENAME TO metronome_challenges_goal_idx;
ALTER INDEX IF EXISTS sentinel_challenges_open_idx RENAME TO metronome_challenges_open_idx;

ALTER TRIGGER sentinel_findings_immutable ON metronome_findings RENAME TO metronome_findings_immutable;
ALTER TRIGGER sentinel_findings_no_delete ON metronome_findings RENAME TO metronome_findings_no_delete;
ALTER TRIGGER sentinel_challenges_immutable ON metronome_challenges RENAME TO metronome_challenges_immutable;
ALTER TRIGGER sentinel_challenges_no_delete ON metronome_challenges RENAME TO metronome_challenges_no_delete;

ALTER FUNCTION reject_sentinel_finding_mutation() RENAME TO reject_metronome_finding_mutation;
CREATE OR REPLACE FUNCTION reject_metronome_finding_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'Metronome finding is already resolved and immutable';
  END IF;
  IF NEW.goal_id IS DISTINCT FROM OLD.goal_id OR NEW.rule_id IS DISTINCT FROM OLD.rule_id
     OR NEW.evidence_identity IS DISTINCT FROM OLD.evidence_identity OR NEW.plan_version IS DISTINCT FROM OLD.plan_version
     OR NEW.details IS DISTINCT FROM OLD.details OR NEW.detected_at IS DISTINCT FROM OLD.detected_at THEN
    RAISE EXCEPTION 'Metronome finding identity/detection facts are immutable; only resolution is allowed';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION reject_sentinel_finding_delete() RENAME TO reject_metronome_finding_delete;
CREATE OR REPLACE FUNCTION reject_metronome_finding_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Metronome findings are never deleted, only resolved';
END;
$$;

ALTER FUNCTION reject_sentinel_challenge_resolved_mutation() RENAME TO reject_metronome_challenge_resolved_mutation;
CREATE OR REPLACE FUNCTION reject_metronome_challenge_resolved_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'resolved' THEN
    RAISE EXCEPTION 'Metronome challenge is already resolved and immutable';
  END IF;
  IF NEW.goal_id IS DISTINCT FROM OLD.goal_id OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.evidence_references IS DISTINCT FROM OLD.evidence_references OR NEW.raised_by IS DISTINCT FROM OLD.raised_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.request_hash IS DISTINCT FROM OLD.request_hash THEN
    RAISE EXCEPTION 'Metronome challenge identity facts are immutable';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION reject_sentinel_challenge_delete() RENAME TO reject_metronome_challenge_delete;
CREATE OR REPLACE FUNCTION reject_metronome_challenge_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Metronome challenges are never deleted';
END;
$$;

-- raised_by is free text (not a CHECK-constrained enum); migrate the one
-- durable data value the application itself writes for this actor identity.
UPDATE metronome_challenges SET raised_by = 'metronome' WHERE raised_by = 'sentinel';

-- ---------------------------------------------------------------------
-- Firefly -> Discord (0042-0045, 0047, 0048)
-- ---------------------------------------------------------------------
ALTER TABLE IF EXISTS firefly_signals RENAME TO discord_signals;
ALTER TABLE IF EXISTS firefly_incidents RENAME TO discord_incidents;
ALTER TABLE IF EXISTS firefly_incident_signals RENAME TO discord_incident_signals;
ALTER TABLE IF EXISTS firefly_watchdog_checks RENAME TO discord_watchdog_checks;
ALTER TABLE IF EXISTS firefly_improvement_evidence RENAME TO discord_improvement_evidence;

ALTER TABLE IF EXISTS discord_signals RENAME COLUMN firefly_health_state TO discord_health_state;

ALTER INDEX IF EXISTS firefly_incidents_status_idx RENAME TO discord_incidents_status_idx;
ALTER INDEX IF EXISTS firefly_incident_signals_signal_idx RENAME TO discord_incident_signals_signal_idx;
ALTER INDEX IF EXISTS firefly_watchdog_checks_checked_idx RENAME TO discord_watchdog_checks_checked_idx;
ALTER INDEX IF EXISTS firefly_incidents_linked_goal_idx RENAME TO discord_incidents_linked_goal_idx;
ALTER INDEX IF EXISTS firefly_improvement_evidence_outcome_idx RENAME TO discord_improvement_evidence_outcome_idx;

ALTER TRIGGER firefly_signals_immutable ON discord_signals RENAME TO discord_signals_immutable;
ALTER FUNCTION reject_firefly_signal_mutation() RENAME TO reject_discord_signal_mutation;
CREATE OR REPLACE FUNCTION reject_discord_signal_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Discord signals are immutable once received';
END;
$$;

ALTER TRIGGER firefly_incident_signals_immutable ON discord_incident_signals RENAME TO discord_incident_signals_immutable;
ALTER FUNCTION reject_firefly_incident_signal_mutation() RENAME TO reject_discord_incident_signal_mutation;
CREATE OR REPLACE FUNCTION reject_discord_incident_signal_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Discord incident signal links are immutable once attached';
END;
$$;

ALTER TRIGGER firefly_watchdog_checks_immutable ON discord_watchdog_checks RENAME TO discord_watchdog_checks_immutable;
ALTER FUNCTION reject_firefly_watchdog_check_mutation() RENAME TO reject_discord_watchdog_check_mutation;
CREATE OR REPLACE FUNCTION reject_discord_watchdog_check_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Discord watchdog checks are immutable once recorded';
END;
$$;

ALTER TRIGGER firefly_incident_signals_identity_check ON discord_incident_signals RENAME TO discord_incident_signals_identity_check;
ALTER FUNCTION reject_mismatched_firefly_incident_signal_link() RENAME TO reject_mismatched_discord_incident_signal_link;
CREATE OR REPLACE FUNCTION reject_mismatched_discord_incident_signal_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  incident_fingerprint text;
  incident_affected_version text;
  signal_fingerprint text;
  signal_affected_version text;
BEGIN
  SELECT i.incident_fingerprint, i.affected_version INTO incident_fingerprint, incident_affected_version
    FROM discord_incidents AS i WHERE i.incident_id = NEW.incident_id;
  SELECT s.incident_fingerprint, s.affected_version INTO signal_fingerprint, signal_affected_version
    FROM discord_signals AS s WHERE s.signal_id = NEW.signal_id;
  IF incident_fingerprint IS DISTINCT FROM signal_fingerprint OR incident_affected_version IS DISTINCT FROM signal_affected_version THEN
    RAISE EXCEPTION 'Discord incident-signal link identity mismatch';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TRIGGER firefly_incidents_closure_immutable ON discord_incidents RENAME TO discord_incidents_closure_immutable;
ALTER FUNCTION reject_firefly_incident_closure_mutation() RENAME TO reject_discord_incident_closure_mutation;
CREATE OR REPLACE FUNCTION reject_discord_incident_closure_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('resolved', 'false_positive') THEN
    IF NEW.status IS DISTINCT FROM OLD.status
      OR NEW.resolution_summary IS DISTINCT FROM OLD.resolution_summary
      OR NEW.retained_risk IS DISTINCT FROM OLD.retained_risk
      OR NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
      RAISE EXCEPTION 'A closed Discord incident is final';
    END IF;
  END IF;
  IF NEW.linked_goal_id IS DISTINCT FROM OLD.linked_goal_id AND OLD.linked_goal_id IS NOT NULL THEN
    RAISE EXCEPTION 'A Discord incident''s linked Goal is immutable once set';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TRIGGER firefly_incidents_linked_at_immutable ON discord_incidents RENAME TO discord_incidents_linked_at_immutable;
ALTER FUNCTION reject_firefly_incident_linked_at_mutation() RENAME TO reject_discord_incident_linked_at_mutation;
CREATE OR REPLACE FUNCTION reject_discord_incident_linked_at_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.linked_at IS NOT NULL AND NEW.linked_at IS DISTINCT FROM OLD.linked_at THEN
    RAISE EXCEPTION 'A Discord incident''s linked_at is immutable once set';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TRIGGER firefly_improvement_evidence_immutable ON discord_improvement_evidence RENAME TO discord_improvement_evidence_immutable;
ALTER FUNCTION reject_firefly_improvement_evidence_mutation() RENAME TO reject_discord_improvement_evidence_mutation;
CREATE OR REPLACE FUNCTION reject_discord_improvement_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Discord improvement evidence is append-only';
END;
$$;

-- discord_watchdog_checks.reason stored the working codename as data values
-- in its CHECK constraint (0044_firefly_incidents.sql). Widen, migrate, narrow.
ALTER TABLE discord_watchdog_checks DROP CONSTRAINT IF EXISTS firefly_watchdog_checks_reason_check;
ALTER TABLE discord_watchdog_checks ADD CONSTRAINT discord_watchdog_checks_reason_check
  CHECK (reason IS NULL OR reason IN ('firefly_observation_silent', 'firefly_observation_missing', 'discord_observation_silent', 'discord_observation_missing'));
UPDATE discord_watchdog_checks SET reason = 'discord_observation_silent' WHERE reason = 'firefly_observation_silent';
UPDATE discord_watchdog_checks SET reason = 'discord_observation_missing' WHERE reason = 'firefly_observation_missing';
ALTER TABLE discord_watchdog_checks DROP CONSTRAINT IF EXISTS discord_watchdog_checks_reason_check;
ALTER TABLE discord_watchdog_checks ADD CONSTRAINT discord_watchdog_checks_reason_check
  CHECK (reason IS NULL OR reason IN ('discord_observation_silent', 'discord_observation_missing'));

-- ---------------------------------------------------------------------
-- permanent_roles.role_kind data values ('sane', 'sentinel') and the
-- role_id 'sane' row set by 0018_role_identity_hardening.sql.
-- ---------------------------------------------------------------------
ALTER TABLE permanent_roles DROP CONSTRAINT IF EXISTS permanent_roles_role_kind_check;
ALTER TABLE permanent_roles ADD CONSTRAINT permanent_roles_role_kind_check
  CHECK (role_kind IN ('sane', 'department_head', 'sentinel', 'encore_council', 'concertmaster', 'metronome'));
UPDATE permanent_roles SET role_kind = 'concertmaster' WHERE role_kind = 'sane';
UPDATE permanent_roles SET role_kind = 'metronome' WHERE role_kind = 'sentinel';
UPDATE permanent_roles SET role_id = 'concertmaster' WHERE role_id = 'sane';
ALTER TABLE permanent_roles DROP CONSTRAINT IF EXISTS permanent_roles_role_kind_check;
ALTER TABLE permanent_roles ADD CONSTRAINT permanent_roles_role_kind_check
  CHECK (role_kind IN ('concertmaster', 'department_head', 'metronome', 'encore_council'));

-- head_activation_attempts.requester_role data values ('Sane') set by
-- 0012_goal_head_participations.sql. Both CHECK constraints referencing
-- 'Sane' are column/table-level unnamed checks with Postgres-deterministic
-- autogenerated names; find and replace them explicitly rather than
-- guessing the exact autogenerated suffix.
DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'head_activation_attempts'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%''Sane''%'
  LOOP
    EXECUTE format('ALTER TABLE head_activation_attempts DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END;
$$;

UPDATE head_activation_attempts SET requester_role = 'Concertmaster' WHERE requester_role = 'Sane';

ALTER TABLE head_activation_attempts ADD CONSTRAINT head_activation_attempts_requester_role_check
  CHECK (requester_role IN ('Concertmaster', 'Head'));
ALTER TABLE head_activation_attempts ADD CONSTRAINT head_activation_attempts_requester_role_department_check
  CHECK ((requester_role = 'Concertmaster' AND requester_department_id IS NULL)
      OR (requester_role = 'Head' AND requester_department_id IS NOT NULL));

-- Postgres does not auto-rename a table's implicitly-named constraints
-- (PK/CHECK/FK/UNIQUE) or their backing indexes when the table itself is
-- renamed -- they keep the old "sane_..."/"sentinel_..."/"firefly_..."
-- prefix even though they now belong to the renamed table. These are
-- internal identifiers (confirmed unreferenced by any application code,
-- error-message match, or ON CONFLICT/ON CONSTRAINT clause), but full
-- naming unification means fixing them too rather than leaving a cosmetic
-- trail of the old name (same pattern as 0051_rename_overwatch_to_encore.sql).
DO $$
DECLARE
  rec record;
  new_name text;
BEGIN
  FOR rec IN
    SELECT conname, conrelid::regclass::text AS table_name
      FROM pg_constraint
     WHERE conrelid::regclass::text IN (
             'concertmaster_final_reports', 'metronome_findings', 'metronome_challenges',
             'metronome_challenge_findings', 'discord_signals', 'discord_incidents',
             'discord_incident_signals', 'discord_watchdog_checks', 'discord_improvement_evidence'
           )
       AND (conname LIKE 'sane\_%' OR conname LIKE 'sentinel\_%' OR conname LIKE 'firefly\_%')
  LOOP
    new_name := regexp_replace(regexp_replace(regexp_replace(rec.conname, '^sane_', 'concertmaster_'), '^sentinel_', 'metronome_'), '^firefly_', 'discord_');
    EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', rec.table_name, rec.conname, new_name);
  END LOOP;

  FOR rec IN
    SELECT indexname
      FROM pg_indexes
     WHERE tablename IN (
             'concertmaster_final_reports', 'metronome_findings', 'metronome_challenges',
             'metronome_challenge_findings', 'discord_signals', 'discord_incidents',
             'discord_incident_signals', 'discord_watchdog_checks', 'discord_improvement_evidence'
           )
       AND (indexname LIKE 'sane\_%' OR indexname LIKE 'sentinel\_%' OR indexname LIKE 'firefly\_%')
  LOOP
    new_name := regexp_replace(regexp_replace(regexp_replace(rec.indexname, '^sane_', 'concertmaster_'), '^sentinel_', 'metronome_'), '^firefly_', 'discord_');
    EXECUTE format('ALTER INDEX %I RENAME TO %I', rec.indexname, new_name);
  END LOOP;
END;
$$;
