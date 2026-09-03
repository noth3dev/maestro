-- Phase 4 step 4 hardening: close two direct-SQL gaps found in independent
-- review of 0040_devices.sql. Additive only; 0040 stays untouched.

-- git.push (not only git.remote.push) must also be classified critical so a
-- local policy can never grant Git push authority, matching the domain
-- canonicalization in packages/domain/src/device.ts.
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
    IF canonical_action IN ('system.policy.bypass', 'permanent.delete', 'git.push')
      OR canonical_action LIKE 'external.%'
      OR canonical_action LIKE 'deployment.%'
      OR canonical_action LIKE 'payment.%'
      OR canonical_action LIKE 'permission.%'
      OR canonical_action LIKE 'authority.%'
      OR canonical_action LIKE 'git.remote.%'
      OR canonical_action LIKE 'git.push.%' THEN
      RAISE EXCEPTION 'Critical or forbidden actions require the Goal grant and cannot be enabled by local policy';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

-- Every device_policies row must be the next contiguous version for its
-- device. This closes a direct-SQL bypass where an out-of-band INSERT with
-- an arbitrary higher policy_version silently became the "latest" policy
-- (readDevice/evaluateDevicePolicy select MAX(policy_version)).
CREATE OR REPLACE FUNCTION reject_noncontiguous_device_policy_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  current_max integer;
BEGIN
  SELECT max(policy_version) INTO current_max FROM device_policies WHERE device_id = NEW.device_id;
  IF current_max IS NULL THEN
    IF NEW.policy_version <> 1 THEN
      RAISE EXCEPTION 'Device policy revisions must start at version 1';
    END IF;
  ELSIF NEW.policy_version <> current_max + 1 THEN
    RAISE EXCEPTION 'Device policy revisions must be the next contiguous version';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS device_policies_sequence_check ON device_policies;
CREATE TRIGGER device_policies_sequence_check BEFORE INSERT ON device_policies
  FOR EACH ROW EXECUTE FUNCTION reject_noncontiguous_device_policy_version();
