CREATE TABLE IF NOT EXISTS operator_project_roles (
  grant_id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES local_operators(operator_id),
  project_id uuid NOT NULL,
  role_id text NOT NULL CHECK (length(trim(role_id)) > 0),
  active boolean NOT NULL DEFAULT true,
  granted_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  revoked_at timestamptz,
  CHECK (active = (revoked_at IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS operator_project_roles_one_active_idx
  ON operator_project_roles (operator_id, project_id, role_id) WHERE active;
CREATE INDEX IF NOT EXISTS operator_project_roles_lookup_idx
  ON operator_project_roles (operator_id, project_id) WHERE active;

CREATE OR REPLACE FUNCTION reject_project_role_reactivation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.active = false AND NEW.active = true THEN
    RAISE EXCEPTION 'revoked project roles cannot be reactivated; grant a new role instead';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS operator_project_roles_no_reactivation ON operator_project_roles;
CREATE TRIGGER operator_project_roles_no_reactivation
  BEFORE UPDATE ON operator_project_roles
  FOR EACH ROW EXECUTE FUNCTION reject_project_role_reactivation();
