CREATE TABLE IF NOT EXISTS goal_leases (
  goal_id uuid PRIMARY KEY,
  owner_id text NOT NULL CHECK (owner_id <> ''),
  fencing_token bigint NOT NULL CHECK (fencing_token > 0),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime'
);
CREATE INDEX IF NOT EXISTS goal_leases_expiry_idx ON goal_leases (expires_at, goal_id);
