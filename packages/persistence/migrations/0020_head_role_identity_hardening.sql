-- Phase 2 HeadRoleId identity hardening.
--
-- 0014 registers the canonical permanent HeadRoleId -> Department mapping and
-- adds head_role_id to Goal participation. 0018 aligns those IDs with the
-- durable permanent role catalog. This migration only changes the identity
-- keys and bindings consumed by Head activation and Head Council; it does not
-- introduce workers, plans, Git, budget, or API state.

-- Existing participation rows were created with (goal_id, department_id).
-- 0014 has already backfilled their canonical role where possible. Fail closed
-- rather than guessing an identity if an initialized database is inconsistent.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM goal_head_participations
    WHERE head_role_id IS NULL OR btrim(head_role_id) = ''
  ) THEN
    RAISE EXCEPTION 'cannot bind existing Head participation to a canonical HeadRoleId';
  END IF;
END;
$$;

-- Remove the old edge foreign keys before changing the participation key.
ALTER TABLE head_activation_edges
  DROP CONSTRAINT IF EXISTS head_activation_edges_goal_id_requester_department_id_fkey,
  DROP CONSTRAINT IF EXISTS head_activation_edges_goal_id_department_id_fkey,
  DROP CONSTRAINT IF EXISTS head_activation_edges_requester_participation_fkey,
  DROP CONSTRAINT IF EXISTS head_activation_edges_target_participation_fkey;

-- The append-only trigger protects history after the migration. Temporarily
-- suspend it only to add the immutable role identity to legacy edge rows.
DROP TRIGGER IF EXISTS head_activation_edges_append_only ON head_activation_edges;
ALTER TABLE head_activation_edges
  ADD COLUMN IF NOT EXISTS requester_head_role_id text,
  ADD COLUMN IF NOT EXISTS head_role_id text;
UPDATE head_activation_edges edge
SET requester_head_role_id = participation.head_role_id
FROM goal_head_participations participation
WHERE edge.goal_id = participation.goal_id
  AND edge.requester_department_id = participation.department_id
  AND edge.requester_head_role_id IS NULL;
UPDATE head_activation_edges edge
SET head_role_id = participation.head_role_id
FROM goal_head_participations participation
WHERE edge.goal_id = participation.goal_id
  AND edge.department_id = participation.department_id
  AND edge.head_role_id IS NULL;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM head_activation_edges
    WHERE requester_head_role_id IS NULL OR head_role_id IS NULL
  ) THEN
    RAISE EXCEPTION 'cannot bind existing Head activation edge to canonical HeadRoleIds';
  END IF;
END;
$$;
ALTER TABLE head_activation_edges
  ALTER COLUMN requester_head_role_id SET NOT NULL,
  ALTER COLUMN head_role_id SET NOT NULL;

-- The identity partition is (HeadRoleId, GoalId), not Department, so a
-- replaced role can remain as a sleeping/auditable participation while its
-- replacement receives a new row for the same Goal and Department.
ALTER TABLE goal_head_participations DROP CONSTRAINT IF EXISTS goal_head_participations_pkey;
ALTER TABLE goal_head_participations
  ADD CONSTRAINT goal_head_participations_pkey PRIMARY KEY (goal_id, head_role_id);
ALTER TABLE goal_head_participations
  DROP CONSTRAINT IF EXISTS goal_head_participations_head_role_fk;
ALTER TABLE goal_head_participations
  ADD CONSTRAINT goal_head_participations_head_role_fk
  FOREIGN KEY (head_role_id, department_id)
  REFERENCES permanent_head_roles (head_role_id, department_id);

-- Only one role may be active for a Department in one Goal, and a permanent
-- role/session cannot be active in two Goal contexts at once. Existing 0014
-- indexes remain valid; these names are new and reapply-safe.
CREATE UNIQUE INDEX IF NOT EXISTS goal_head_participations_active_department_idx
  ON goal_head_participations (goal_id, department_id)
  WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS goal_head_participations_active_role_idx
  ON goal_head_participations (head_role_id)
  WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS goal_head_participations_active_session_idx
  ON goal_head_participations (active_session_ref)
  WHERE status = 'active';

-- Rebuild edge history identity around role IDs while retaining department
-- columns as a human-readable, checked context projection.
ALTER TABLE head_activation_edges DROP CONSTRAINT IF EXISTS head_activation_edges_pkey;
ALTER TABLE head_activation_edges
  ADD CONSTRAINT head_activation_edges_pkey
  PRIMARY KEY (goal_id, requester_head_role_id, head_role_id);
ALTER TABLE head_activation_edges
  ADD CONSTRAINT head_activation_edges_requester_participation_fkey
  FOREIGN KEY (goal_id, requester_head_role_id)
  REFERENCES goal_head_participations (goal_id, head_role_id),
  ADD CONSTRAINT head_activation_edges_target_participation_fkey
  FOREIGN KEY (goal_id, head_role_id)
  REFERENCES goal_head_participations (goal_id, head_role_id);

CREATE OR REPLACE FUNCTION assert_head_activation_edge_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM goal_head_participations p
    WHERE p.goal_id = NEW.goal_id
      AND p.head_role_id = NEW.requester_head_role_id
      AND p.department_id = NEW.requester_department_id
  ) OR NOT EXISTS (
    SELECT 1 FROM goal_head_participations p
    WHERE p.goal_id = NEW.goal_id
      AND p.head_role_id = NEW.head_role_id
      AND p.department_id = NEW.department_id
  ) THEN
    RAISE EXCEPTION 'Head activation edge role and Department identities do not match';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS head_activation_edge_identity ON head_activation_edges;
CREATE TRIGGER head_activation_edge_identity
BEFORE INSERT OR UPDATE ON head_activation_edges
FOR EACH ROW EXECUTE FUNCTION assert_head_activation_edge_identity();

CREATE OR REPLACE FUNCTION reject_head_activation_history_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'head activation history is append-only';
END;
$$;
DROP TRIGGER IF EXISTS head_activation_edges_append_only ON head_activation_edges;
CREATE TRIGGER head_activation_edges_append_only
BEFORE UPDATE OR DELETE ON head_activation_edges
FOR EACH ROW EXECUTE FUNCTION reject_head_activation_history_mutation();

-- Existing attempts already have role columns when 0014 was applied. The
-- guarded additions/backfill keep this migration safe for older initialized
-- data and retain every pre-hardening attempt as audit history.
ALTER TABLE head_activation_attempts
  ADD COLUMN IF NOT EXISTS head_role_id text,
  ADD COLUMN IF NOT EXISTS requester_head_role_id text;
DROP TRIGGER IF EXISTS head_activation_attempts_append_only ON head_activation_attempts;
UPDATE head_activation_attempts attempt
SET head_role_id = role.head_role_id
FROM permanent_head_roles role
WHERE attempt.department_id = role.department_id
  AND attempt.head_role_id IS NULL;
UPDATE head_activation_attempts attempt
SET requester_head_role_id = role.head_role_id
FROM permanent_head_roles role
WHERE attempt.requester_department_id = role.department_id
  AND attempt.requester_head_role_id IS NULL;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM head_activation_attempts
    WHERE head_role_id IS NULL OR btrim(head_role_id) = ''
  ) THEN
    RAISE EXCEPTION 'cannot bind existing Head activation attempt to a canonical HeadRoleId';
  END IF;
END;
$$;
ALTER TABLE head_activation_attempts ALTER COLUMN head_role_id SET NOT NULL;
ALTER TABLE head_activation_attempts
  DROP CONSTRAINT IF EXISTS head_activation_attempts_head_role_fk,
  DROP CONSTRAINT IF EXISTS head_activation_attempts_requester_head_role_fk;
ALTER TABLE head_activation_attempts
  ADD CONSTRAINT head_activation_attempts_head_role_fk
  FOREIGN KEY (head_role_id) REFERENCES permanent_head_roles (head_role_id),
  ADD CONSTRAINT head_activation_attempts_requester_head_role_fk
  FOREIGN KEY (requester_head_role_id) REFERENCES permanent_head_roles (head_role_id);
ALTER TABLE head_activation_attempts DROP CONSTRAINT IF EXISTS head_activation_attempts_role_binding_check;
ALTER TABLE head_activation_attempts
  ADD CONSTRAINT head_activation_attempts_role_binding_check
  CHECK ((requester_role = 'Sane' AND requester_head_role_id IS NULL)
      OR (requester_role = 'Head' AND requester_head_role_id IS NOT NULL));
ALTER TABLE head_activation_attempts DROP CONSTRAINT IF EXISTS head_activation_attempts_outcome_check;
ALTER TABLE head_activation_attempts
  ADD CONSTRAINT head_activation_attempts_outcome_check
  CHECK (outcome IN ('reserved', 'already_active', 'cycle_rejected', 'runtime_conflict', 'binding_conflict'));
CREATE OR REPLACE FUNCTION reject_head_activation_history_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'head activation history is append-only';
END;
$$;
DROP TRIGGER IF EXISTS head_activation_attempts_append_only ON head_activation_attempts;
CREATE TRIGGER head_activation_attempts_append_only
BEFORE UPDATE OR DELETE ON head_activation_attempts
FOR EACH ROW EXECUTE FUNCTION reject_head_activation_history_mutation();

-- Council participant rows are legacy-readable but all new rows carry the
-- captured HeadRoleId. Existing rows are backfilled from their Goal snapshot;
-- their old sealed snapshot payload/hash is intentionally not rewritten.
ALTER TABLE council_participants ADD COLUMN IF NOT EXISTS head_role_id text;
DROP TRIGGER IF EXISTS council_participant_identity_immutable ON council_participants;
UPDATE council_participants participant
SET head_role_id = participation.head_role_id
FROM head_councils council
JOIN goal_head_participations participation
  ON participation.goal_id = council.goal_id
 AND participation.department_id = participant.department_id
 AND participation.contract_id = council.contract_id
 AND participation.status = 'active'
WHERE participant.council_id = council.council_id
  AND participant.head_role_id IS NULL;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM council_participants
    WHERE head_role_id IS NULL OR btrim(head_role_id) = ''
  ) THEN
    RAISE EXCEPTION 'cannot bind existing Council participant to a canonical HeadRoleId';
  END IF;
END;
$$;
ALTER TABLE council_participants
  ALTER COLUMN head_role_id SET NOT NULL,
  ADD CONSTRAINT council_participants_head_role_nonblank CHECK (btrim(head_role_id) <> '');
ALTER TABLE council_participants
  ADD CONSTRAINT council_participants_head_role_fk
  FOREIGN KEY (head_role_id, department_id)
  REFERENCES permanent_head_roles (head_role_id, department_id);
CREATE UNIQUE INDEX IF NOT EXISTS council_participants_head_role_unique
  ON council_participants (council_id, head_role_id);

CREATE OR REPLACE FUNCTION council_participant_must_be_active() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c head_councils%ROWTYPE;
BEGIN
  SELECT * INTO c FROM head_councils WHERE council_id = NEW.council_id FOR KEY SHARE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM goal_head_participations p
    WHERE p.goal_id = c.goal_id
      AND p.department_id = NEW.department_id
      AND p.head_role_id = NEW.head_role_id
      AND p.contract_id = c.contract_id
      AND p.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Council participant must be an active HeadRoleId bound to this Goal, Department, and contract';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS council_participant_active ON council_participants;
CREATE TRIGGER council_participant_active
BEFORE INSERT ON council_participants
FOR EACH ROW EXECUTE FUNCTION council_participant_must_be_active();

CREATE OR REPLACE FUNCTION council_participant_identity_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.council_id IS DISTINCT FROM OLD.council_id
     OR NEW.department_id IS DISTINCT FROM OLD.department_id
     OR NEW.head_role_id IS DISTINCT FROM OLD.head_role_id
     OR NEW.session_ref IS DISTINCT FROM OLD.session_ref THEN
    RAISE EXCEPTION 'frozen Council participant identity is immutable';
  END IF;
  IF OLD.absent_at IS NOT NULL
     AND (NEW.absent_at IS DISTINCT FROM OLD.absent_at OR NEW.absence_reason IS DISTINCT FROM OLD.absence_reason) THEN
    RAISE EXCEPTION 'Council participant absence is immutable';
  END IF;
  IF OLD.absent_at IS NULL
     AND (NEW.absent_at IS NULL OR NEW.absence_reason IS NULL) THEN
    RAISE EXCEPTION 'Council participant absence must be recorded atomically';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS council_participant_identity_immutable ON council_participants;
CREATE TRIGGER council_participant_identity_immutable
BEFORE UPDATE ON council_participants
FOR EACH ROW EXECUTE FUNCTION council_participant_identity_immutable();
