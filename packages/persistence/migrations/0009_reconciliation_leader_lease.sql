CREATE TABLE IF NOT EXISTS reconciler_leader_lease (
  lease_key text PRIMARY KEY DEFAULT 'singleton',
  owner_id text NOT NULL CHECK (owner_id <> ''),
  fencing_token bigint NOT NULL CHECK (fencing_token > 0),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime',
  CHECK (lease_key = 'singleton')
);
