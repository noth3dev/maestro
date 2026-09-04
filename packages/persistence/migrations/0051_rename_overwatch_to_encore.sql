-- Naming unification: "Overwatch Council" (working codename) -> "Encore
-- Council" (adopted product terminology, see docs/05-roadmap-and-phase-status.md
-- and the Phase 3 roadmap entry "Encore, Certification & First Usable
-- Release"). This is additive-only per this project's migration-ledger
-- discipline (see packages/persistence/src/migrate.ts): no existing
-- migration file's content is edited, since the ledger verifies each
-- applied file's checksum. Every table/index/trigger/function this
-- migration renames was itself created in 0031_overwatch_council.sql; this
-- migration only renames the durable objects and updates any stored data
-- values, never drops or recreates the underlying rows.

ALTER TABLE IF EXISTS overwatch_council_rounds RENAME TO encore_council_rounds;
ALTER TABLE IF EXISTS overwatch_council_judgments RENAME TO encore_council_judgments;
ALTER TABLE IF EXISTS overwatch_council_syntheses RENAME TO encore_council_syntheses;

ALTER INDEX IF EXISTS overwatch_council_rounds_goal_idx RENAME TO encore_council_rounds_goal_idx;

ALTER TRIGGER overwatch_council_rounds_immutable ON encore_council_rounds RENAME TO encore_council_rounds_immutable;
ALTER TRIGGER overwatch_council_judgments_immutable ON encore_council_judgments RENAME TO encore_council_judgments_immutable;
ALTER TRIGGER overwatch_council_syntheses_immutable ON encore_council_syntheses RENAME TO encore_council_syntheses_immutable;

ALTER FUNCTION reject_overwatch_round_mutation() RENAME TO reject_encore_round_mutation;
CREATE OR REPLACE FUNCTION reject_encore_round_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Encore Council round is immutable once frozen';
END;
$$;

-- Postgres does not auto-rename a table's implicitly-named constraints
-- (PK/CHECK/FK/UNIQUE) or their backing indexes when the table itself is
-- renamed -- they keep the old "overwatch_council_..." prefix even though
-- they now belong to "encore_council_...". These are internal identifiers
-- (confirmed unreferenced by any application code, error-message match, or
-- ON CONFLICT/ON CONSTRAINT clause), but full naming unification means
-- fixing them too rather than leaving a cosmetic trail of the old name.
DO $$
DECLARE
  rec record;
  new_name text;
BEGIN
  FOR rec IN
    SELECT conname, conrelid::regclass::text AS table_name
      FROM pg_constraint
     WHERE conrelid::regclass::text IN ('encore_council_rounds', 'encore_council_judgments', 'encore_council_syntheses')
       AND conname LIKE 'overwatch\_%'
  LOOP
    new_name := regexp_replace(rec.conname, '^overwatch_', 'encore_');
    EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', rec.table_name, rec.conname, new_name);
  END LOOP;

  FOR rec IN
    SELECT indexname
      FROM pg_indexes
     WHERE tablename IN ('encore_council_rounds', 'encore_council_judgments', 'encore_council_syntheses')
       AND indexname LIKE 'overwatch\_%'
  LOOP
    new_name := regexp_replace(rec.indexname, '^overwatch_', 'encore_');
    EXECUTE format('ALTER INDEX %I RENAME TO %I', rec.indexname, new_name);
  END LOOP;
END;
$$;

-- permanent_roles.role_kind stored the working codename as a data value in
-- its CHECK constraint (0018_role_identity_hardening.sql,
-- permanent_roles_role_kind_check). Widen the constraint to the new value,
-- migrate every existing row, then narrow it back to just the new value --
-- the same drop/recreate pattern this project already uses for CHECK
-- constraints it needs to change.
ALTER TABLE permanent_roles DROP CONSTRAINT IF EXISTS permanent_roles_role_kind_check;
ALTER TABLE permanent_roles ADD CONSTRAINT permanent_roles_role_kind_check
  CHECK (role_kind IN ('sane', 'department_head', 'sentinel', 'overwatch_council', 'encore_council'));
UPDATE permanent_roles SET role_kind = 'encore_council' WHERE role_kind = 'overwatch_council';
ALTER TABLE permanent_roles DROP CONSTRAINT IF EXISTS permanent_roles_role_kind_check;
ALTER TABLE permanent_roles ADD CONSTRAINT permanent_roles_role_kind_check
  CHECK (role_kind IN ('sane', 'department_head', 'sentinel', 'encore_council'));
