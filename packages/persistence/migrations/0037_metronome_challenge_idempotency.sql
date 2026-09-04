-- Phase 3 Metronome challenge identity/idempotency and canonical actor hardening.
-- Additive only: legacy rows retain NULL keys, while every new challenge
-- receives a durable key before the unique constraint is consulted.

ALTER TABLE metronome_challenges
  ADD COLUMN IF NOT EXISTS idempotency_key char(64),
  ADD COLUMN IF NOT EXISTS request_hash char(64);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'metronome_challenges'::regclass
       AND conname = 'metronome_challenges_idempotency_key_format'
  ) THEN
    ALTER TABLE metronome_challenges
      ADD CONSTRAINT metronome_challenges_idempotency_key_format
      CHECK (idempotency_key IS NULL OR idempotency_key ~ '^[0-9a-f]{64}$');
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'metronome_challenges'::regclass
       AND conname = 'metronome_challenges_request_hash_format'
  ) THEN
    ALTER TABLE metronome_challenges
      ADD CONSTRAINT metronome_challenges_request_hash_format
      CHECK (request_hash IS NULL OR request_hash ~ '^[0-9a-f]{64}$');
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'metronome_challenges'::regclass
       AND conname = 'metronome_challenges_identity_hash_pair'
  ) THEN
    ALTER TABLE metronome_challenges
      ADD CONSTRAINT metronome_challenges_identity_hash_pair
      CHECK ((idempotency_key IS NULL) = (request_hash IS NULL));
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'metronome_challenges'::regclass
       AND conname = 'metronome_challenges_goal_idempotency_key_unique'
  ) THEN
    ALTER TABLE metronome_challenges
      ADD CONSTRAINT metronome_challenges_goal_idempotency_key_unique
      UNIQUE (goal_id, idempotency_key);
  END IF;
END;
$$;

-- The 0029 trigger protects challenge identity. Extend that protection to the
-- hashes so a direct SQL update cannot change the key used for idempotency.
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
