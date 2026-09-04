-- Phase 2 durable role identity hardening. This migration depends only on
-- 0010_permanent_organization.sql. It intentionally adds no Goal, session,
-- worker, learning, or Council execution state.

-- 0010 temporarily made every role organization-wide. Remove that obsolete
-- check before introducing the reviewed role-kind/mapping invariant.
ALTER TABLE permanent_roles DROP CONSTRAINT IF EXISTS permanent_roles_department_id_check;

-- The 0010 name is deterministic on PostgreSQL, but also remove the old
-- unnamed-check variant so this migration remains safe across initialized
-- databases created by compatible tooling.
DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'permanent_roles'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%department_id IS NULL%'
  LOOP
    EXECUTE format('ALTER TABLE permanent_roles DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END;
$$;

ALTER TABLE permanent_roles ADD COLUMN IF NOT EXISTS role_kind text;
ALTER TABLE permanent_roles ADD COLUMN IF NOT EXISTS role_charter text;
ALTER TABLE permanent_roles ADD COLUMN IF NOT EXISTS capability_boundary jsonb;
ALTER TABLE permanent_roles ADD COLUMN IF NOT EXISTS provenance jsonb;

-- A database may have been bootstrapped from 0010 before this additive
-- migration was applied. Backfill its one legacy identity before enforcing the
-- required metadata columns. Unknown role rows fail the NOT NULL transition
-- below instead of receiving guessed identity facts.
UPDATE permanent_roles
   SET role_kind = COALESCE(role_kind, 'concertmaster'),
       role_charter = COALESCE(role_charter, 'Coordinate the Secretary Office on behalf of the CEO while preserving intent and canonical records.'),
       capability_boundary = COALESCE(capability_boundary, '{"allowed":["coordinate the Secretary Office","maintain canonical records","present CEO decisions"],"forbidden":["change CEO intent without confirmation","execute unapproved critical actions","spawn production workers directly"]}'::jsonb),
       provenance = COALESCE(provenance, '{"source":"plan/phase2.md §25–26","sourceRevision":"ac65c8d","reviewedBy":"Phase 2 organization review","reviewedAt":"2026-09-01","reviewVersion":"phase2-role-baselines-v1"}'::jsonb)
 WHERE role_id = 'concertmaster'
   AND (role_kind IS NULL OR role_charter IS NULL OR capability_boundary IS NULL OR provenance IS NULL);

ALTER TABLE permanent_roles ALTER COLUMN role_kind SET NOT NULL;
ALTER TABLE permanent_roles ALTER COLUMN role_charter SET NOT NULL;
ALTER TABLE permanent_roles ALTER COLUMN capability_boundary SET NOT NULL;
ALTER TABLE permanent_roles ALTER COLUMN provenance SET NOT NULL;

ALTER TABLE permanent_roles DROP CONSTRAINT IF EXISTS permanent_roles_role_kind_check;
ALTER TABLE permanent_roles ADD CONSTRAINT permanent_roles_role_kind_check
  CHECK (role_kind IN ('concertmaster', 'department_head', 'metronome', 'encore_council'));

ALTER TABLE permanent_roles DROP CONSTRAINT IF EXISTS permanent_roles_role_department_check;
ALTER TABLE permanent_roles ADD CONSTRAINT permanent_roles_role_department_check
  CHECK ((role_kind = 'department_head') = (department_id IS NOT NULL));

ALTER TABLE permanent_roles DROP CONSTRAINT IF EXISTS permanent_roles_role_charter_check;
ALTER TABLE permanent_roles ADD CONSTRAINT permanent_roles_role_charter_check
  CHECK (btrim(role_charter) <> '');

ALTER TABLE permanent_roles DROP CONSTRAINT IF EXISTS permanent_roles_capability_boundary_check;
ALTER TABLE permanent_roles ADD CONSTRAINT permanent_roles_capability_boundary_check
  CHECK (jsonb_typeof(capability_boundary) = 'object'
    AND jsonb_typeof(capability_boundary -> 'allowed') = 'array'
    AND jsonb_typeof(capability_boundary -> 'forbidden') = 'array');

ALTER TABLE permanent_roles DROP CONSTRAINT IF EXISTS permanent_roles_provenance_check;
ALTER TABLE permanent_roles ADD CONSTRAINT permanent_roles_provenance_check
  CHECK (jsonb_typeof(provenance) = 'object'
    AND provenance ?& ARRAY['source', 'sourceRevision', 'reviewedBy', 'reviewedAt', 'reviewVersion']
    AND jsonb_typeof(provenance -> 'source') = 'string'
    AND jsonb_typeof(provenance -> 'sourceRevision') = 'string'
    AND jsonb_typeof(provenance -> 'reviewedBy') = 'string'
    AND jsonb_typeof(provenance -> 'reviewedAt') = 'string'
    AND jsonb_typeof(provenance -> 'reviewVersion') = 'string'
    AND btrim(provenance ->> 'source') <> ''
    AND btrim(provenance ->> 'sourceRevision') <> ''
    AND btrim(provenance ->> 'reviewedBy') <> ''
    AND btrim(provenance ->> 'reviewedAt') <> ''
    AND btrim(provenance ->> 'reviewVersion') <> '');

-- A later Head participation table can use this composite relation to prove
-- that a referenced Head belongs to the claimed Department, rather than
-- trusting two independent text columns.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'permanent_roles'::regclass
       AND conname = 'permanent_roles_role_department_key'
  ) THEN
    ALTER TABLE permanent_roles ADD CONSTRAINT permanent_roles_role_department_key
      UNIQUE (role_id, department_id);
  END IF;
END;
$$;
CREATE UNIQUE INDEX IF NOT EXISTS permanent_roles_department_head_unique
  ON permanent_roles (department_id)
  WHERE role_kind = 'department_head';

CREATE OR REPLACE FUNCTION reject_permanent_role_department_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.department_id IS DISTINCT FROM OLD.department_id THEN
    RAISE EXCEPTION 'permanent role-to-department mapping is immutable';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS permanent_role_department_immutable ON permanent_roles;
CREATE TRIGGER permanent_role_department_immutable
BEFORE UPDATE OF department_id ON permanent_roles
FOR EACH ROW EXECUTE FUNCTION reject_permanent_role_department_mutation();

-- Canonical role identities are durable facts. Future profile or lifecycle
-- records must be additive; they must not rewrite or delete this row.
CREATE OR REPLACE FUNCTION reject_permanent_role_identity_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'canonical permanent role identity is immutable';
END;
$$;
DROP TRIGGER IF EXISTS permanent_role_identity_immutable ON permanent_roles;
CREATE TRIGGER permanent_role_identity_immutable
BEFORE UPDATE OR DELETE ON permanent_roles
FOR EACH ROW EXECUTE FUNCTION reject_permanent_role_identity_mutation();
