-- Provider sessions are created after a durable worker identity exists. The
-- pending references are replaced exactly once when the provider binding is
-- returned; all other worker identity fields remain immutable.
CREATE OR REPLACE FUNCTION reject_worker_terminal_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  binding_pending boolean := OLD.execution_ref LIKE 'pending:%' AND OLD.invocation_ref LIKE 'pending:%';
  binding_completed boolean := NEW.execution_ref NOT LIKE 'pending:%' AND NEW.invocation_ref NOT LIKE 'pending:%';
BEGIN
  IF OLD.status IN ('succeeded', 'failed', 'cancelled') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Worker status is immutable once terminal';
  END IF;
  IF NEW.council_id IS DISTINCT FROM OLD.council_id
     OR NEW.department_id IS DISTINCT FROM OLD.department_id
     OR NEW.plan_version IS DISTINCT FROM OLD.plan_version
     OR NEW.item_id IS DISTINCT FROM OLD.item_id
     OR NEW.bundle_content_hash IS DISTINCT FROM OLD.bundle_content_hash
     OR NEW.attempt IS DISTINCT FROM OLD.attempt
     OR NEW.spawned_at IS DISTINCT FROM OLD.spawned_at
     OR (NEW.execution_ref IS DISTINCT FROM OLD.execution_ref AND NOT (binding_pending AND binding_completed))
     OR (NEW.invocation_ref IS DISTINCT FROM OLD.invocation_ref AND NOT (binding_pending AND binding_completed))
     OR (NEW.execution_ref IS DISTINCT FROM OLD.execution_ref AND NEW.invocation_ref = OLD.invocation_ref)
     OR (NEW.invocation_ref IS DISTINCT FROM OLD.invocation_ref AND NEW.execution_ref = OLD.execution_ref) THEN
    RAISE EXCEPTION 'Worker identity/binding is immutable';
  END IF;
  RETURN NEW;
END;
$$;
