CREATE TABLE IF NOT EXISTS operator_project_memberships (
  membership_id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES local_operators(operator_id),
  project_id uuid NOT NULL,
  active boolean NOT NULL DEFAULT true,
  granted_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  revoked_at timestamptz,
  CHECK (active = (revoked_at IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS operator_project_memberships_one_active_idx
  ON operator_project_memberships (operator_id, project_id) WHERE active;
CREATE INDEX IF NOT EXISTS operator_project_memberships_project_idx ON operator_project_memberships (project_id) WHERE active;

CREATE OR REPLACE FUNCTION reject_project_membership_reactivation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.active = false AND NEW.active = true THEN
    RAISE EXCEPTION 'revoked project memberships cannot be reactivated; grant a new membership instead';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS operator_project_memberships_no_reactivation ON operator_project_memberships;
CREATE TRIGGER operator_project_memberships_no_reactivation
  BEFORE UPDATE ON operator_project_memberships
  FOR EACH ROW EXECUTE FUNCTION reject_project_membership_reactivation();
