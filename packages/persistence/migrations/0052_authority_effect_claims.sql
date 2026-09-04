-- Claim an allowed external command before invoking its effect. This is
-- intentionally append-only: a crashed caller may leave a claim, which is
-- safer than replaying a potentially completed external side effect.
CREATE TABLE IF NOT EXISTS authority_effect_claims (
  command_id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  actor_id text NOT NULL CHECK (actor_id <> ''),
  action text NOT NULL CHECK (action <> ''),
  target text NOT NULL CHECK (target <> ''),
  policy_version integer NOT NULL CHECK (policy_version >= 0),
  budget_effect_cents bigint NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
CREATE INDEX IF NOT EXISTS authority_effect_claims_scope_idx
  ON authority_effect_claims (project_id, goal_id, actor_id, claimed_at);

CREATE OR REPLACE FUNCTION authority_effect_claims_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'authority effect claims are append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS authority_effect_claims_update ON authority_effect_claims;
CREATE TRIGGER authority_effect_claims_update BEFORE UPDATE ON authority_effect_claims
  FOR EACH ROW EXECUTE FUNCTION authority_effect_claims_append_only();
DROP TRIGGER IF EXISTS authority_effect_claims_delete ON authority_effect_claims;
CREATE TRIGGER authority_effect_claims_delete BEFORE DELETE ON authority_effect_claims
  FOR EACH ROW EXECUTE FUNCTION authority_effect_claims_append_only();
