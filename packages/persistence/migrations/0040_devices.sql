-- Phase 4 work-sequence step 4: explicitly enrolled devices, durable inventory,
-- and append-only local policy revisions. Enrollment is identity only; policy
-- remains a separate authority object.
CREATE TABLE IF NOT EXISTS devices (
  device_id uuid PRIMARY KEY,
  display_name text NOT NULL CHECK (btrim(display_name) <> ''),
  device_type text NOT NULL CHECK (device_type IN ('computer', 'cli_endpoint')),
  public_key text NOT NULL CHECK (btrim(public_key) <> ''),
  identity_fingerprint char(64) NOT NULL CHECK (identity_fingerprint ~ '^[0-9a-f]{64}$'),
  enrolled_by text NOT NULL CHECK (btrim(enrolled_by) <> ''),
  enrolled_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  state text NOT NULL CHECK (state IN ('enrolled', 'revoked')),
  revoked_at timestamptz,
  inventory jsonb,
  inventory_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime',
  UNIQUE (identity_fingerprint),
  CHECK ((state = 'enrolled' AND revoked_at IS NULL) OR (state = 'revoked' AND revoked_at IS NOT NULL)),
  CHECK ((inventory IS NULL) = (inventory_updated_at IS NULL))
);
CREATE INDEX IF NOT EXISTS devices_state_idx ON devices (state, enrolled_at, device_id);
CREATE INDEX IF NOT EXISTS devices_inventory_idx ON devices (inventory_updated_at, device_id);

-- Every policy version is immutable. The latest version is the local policy
-- selected by the policy agent; no Goal grant is created in this migration.
CREATE TABLE IF NOT EXISTS device_policies (
  device_id uuid NOT NULL REFERENCES devices(device_id),
  policy_version integer NOT NULL CHECK (policy_version > 0),
  rules jsonb NOT NULL CHECK (jsonb_typeof(rules) = 'array'),
  expires_at timestamptz,
  set_by text NOT NULL CHECK (btrim(set_by) <> ''),
  set_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime',
  PRIMARY KEY (device_id, policy_version)
);
CREATE INDEX IF NOT EXISTS device_policies_latest_idx ON device_policies (device_id, policy_version DESC);

CREATE OR REPLACE FUNCTION reject_device_identity_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.device_id IS DISTINCT FROM OLD.device_id
    OR NEW.display_name IS DISTINCT FROM OLD.display_name
    OR NEW.device_type IS DISTINCT FROM OLD.device_type
    OR NEW.public_key IS DISTINCT FROM OLD.public_key
    OR NEW.identity_fingerprint IS DISTINCT FROM OLD.identity_fingerprint
    OR NEW.enrolled_by IS DISTINCT FROM OLD.enrolled_by
    OR NEW.enrolled_at IS DISTINCT FROM OLD.enrolled_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Device enrollment identity is immutable';
  END IF;
  IF OLD.state = 'revoked' AND (NEW.state <> 'revoked' OR NEW.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Device revocation is final';
  END IF;
  IF OLD.state = 'enrolled' AND NEW.state = 'revoked' AND NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'Revoked device requires revoked_at';
  END IF;
  IF OLD.state = 'revoked'
    AND (NEW.inventory IS DISTINCT FROM OLD.inventory OR NEW.inventory_updated_at IS DISTINCT FROM OLD.inventory_updated_at) THEN
    RAISE EXCEPTION 'Revoked device inventory cannot change';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS devices_identity_immutable ON devices;
CREATE TRIGGER devices_identity_immutable BEFORE UPDATE ON devices
  FOR EACH ROW EXECUTE FUNCTION reject_device_identity_mutation();

CREATE OR REPLACE FUNCTION reject_device_mutation_after_revocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Device enrollment records are append-only';
END;
$$;
DROP TRIGGER IF EXISTS devices_append_only_delete ON devices;
CREATE TRIGGER devices_append_only_delete BEFORE DELETE ON devices
  FOR EACH ROW EXECUTE FUNCTION reject_device_mutation_after_revocation();

-- Inventory is observed state, not an authority input. Mirror the domain
-- shape and secret screening here so direct SQL cannot bypass the API.
CREATE OR REPLACE FUNCTION reject_invalid_device_inventory() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  field text;
  capability jsonb;
  material text;
BEGIN
  IF NEW.inventory IS NULL THEN
    RETURN NEW;
  END IF;
  IF jsonb_typeof(NEW.inventory) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Device inventory must be an object';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_object_keys(NEW.inventory) AS entry(key)
     WHERE key NOT IN ('observedAt', 'platform', 'architecture', 'capabilities', 'applications')
  ) THEN
    RAISE EXCEPTION 'Device inventory has unknown field';
  END IF;
  IF jsonb_typeof(NEW.inventory->'observedAt') IS DISTINCT FROM 'string'
    OR btrim(NEW.inventory->>'observedAt') = ''
    OR jsonb_typeof(NEW.inventory->'platform') IS DISTINCT FROM 'string'
    OR btrim(NEW.inventory->>'platform') = ''
    OR jsonb_typeof(NEW.inventory->'architecture') IS DISTINCT FROM 'string'
    OR btrim(NEW.inventory->>'architecture') = '' THEN
    RAISE EXCEPTION 'Device inventory metadata is invalid';
  END IF;
  BEGIN
    PERFORM (NEW.inventory->>'observedAt')::timestamptz;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Device inventory metadata is invalid';
  END;
  FOR field IN SELECT unnest(ARRAY['capabilities', 'applications']) LOOP
    IF jsonb_typeof(NEW.inventory->field) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Device inventory % must be a list', field;
    END IF;
    FOR capability IN SELECT value FROM jsonb_array_elements(NEW.inventory->field) AS entry(value) LOOP
      IF jsonb_typeof(capability) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'Device inventory % entry must be an object', field;
      END IF;
      IF EXISTS (
        SELECT 1
          FROM jsonb_object_keys(capability) AS entry(key)
         WHERE key NOT IN ('name', 'version')
      ) THEN
        RAISE EXCEPTION 'Device inventory % entry has unknown field', field;
      END IF;
      IF jsonb_typeof(capability->'name') IS DISTINCT FROM 'string'
        OR btrim(capability->>'name') = ''
        OR jsonb_typeof(capability->'version') IS DISTINCT FROM 'string'
        OR btrim(capability->>'version') = '' THEN
        RAISE EXCEPTION 'Device inventory % name and version are required', field;
      END IF;
      material := (capability->>'name') || ' ' || (capability->>'version');
      IF material ~* '(secret|password|token|private.?key|credential)'
        OR position(chr(61) IN material) > 0
        OR position(chr(10) IN material) > 0 THEN
        RAISE EXCEPTION 'Inventory capability values must not contain secret-like material';
      END IF;
    END LOOP;
  END LOOP;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS devices_inventory_boundary ON devices;
CREATE TRIGGER devices_inventory_boundary BEFORE INSERT OR UPDATE OF inventory ON devices
  FOR EACH ROW EXECUTE FUNCTION reject_invalid_device_inventory();

CREATE OR REPLACE FUNCTION reject_device_policy_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Device policy revisions are immutable and append-only';
END;
$$;
DROP TRIGGER IF EXISTS device_policies_immutable_update ON device_policies;
DROP TRIGGER IF EXISTS device_policies_immutable_delete ON device_policies;
CREATE TRIGGER device_policies_immutable_update BEFORE UPDATE ON device_policies
  FOR EACH ROW EXECUTE FUNCTION reject_device_policy_mutation();
CREATE TRIGGER device_policies_immutable_delete BEFORE DELETE ON device_policies
  FOR EACH ROW EXECUTE FUNCTION reject_device_policy_mutation();

-- Local policy is never a Goal grant. Keep the persistence boundary aligned
-- with the domain action canonicalization so direct SQL cannot enable a
-- critical or forbidden family through case or separator variants.
CREATE OR REPLACE FUNCTION reject_critical_device_policy_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  rule jsonb;
  canonical_action text;
BEGIN
  FOR rule IN SELECT value FROM jsonb_array_elements(NEW.rules) AS entry(value) LOOP
    canonical_action := trim(
      both '.' FROM regexp_replace(
        regexp_replace(lower(btrim(COALESCE(rule->>'action', ''))), '[^a-z0-9]+', '.', 'g'),
        '(^\.+|\.+$)', '', 'g'
      )
    );
    IF canonical_action IN ('system.policy.bypass', 'permanent.delete')
      OR canonical_action LIKE 'external.%'
      OR canonical_action LIKE 'deployment.%'
      OR canonical_action LIKE 'payment.%'
      OR canonical_action LIKE 'permission.%'
      OR canonical_action LIKE 'authority.%'
      OR canonical_action LIKE 'git.remote.%' THEN
      RAISE EXCEPTION 'Critical or forbidden actions require the Goal grant and cannot be enabled by local policy';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS device_policies_no_critical_actions ON device_policies;
CREATE TRIGGER device_policies_no_critical_actions BEFORE INSERT ON device_policies
  FOR EACH ROW EXECUTE FUNCTION reject_critical_device_policy_rules();

CREATE OR REPLACE FUNCTION reject_policy_for_revoked_device() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE device_state text;
BEGIN
  SELECT state INTO device_state FROM devices WHERE device_id = NEW.device_id FOR KEY SHARE;
  IF device_state IS NULL THEN
    RAISE EXCEPTION 'Device for policy does not exist';
  END IF;
  IF device_state = 'revoked' THEN
    RAISE EXCEPTION 'Revoked device cannot receive a policy';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS device_policies_active_device_check ON device_policies;
CREATE TRIGGER device_policies_active_device_check BEFORE INSERT ON device_policies
  FOR EACH ROW EXECUTE FUNCTION reject_policy_for_revoked_device();
