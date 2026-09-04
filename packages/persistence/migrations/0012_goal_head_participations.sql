CREATE TABLE IF NOT EXISTS goal_head_participations (
  goal_id uuid NOT NULL REFERENCES goals(goal_id),
  department_id text NOT NULL REFERENCES departments(department_id),
  contract_id uuid,
  status text NOT NULL CHECK (status IN ('starting', 'active', 'sleeping')),
  active_session_ref text,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (goal_id, department_id),
  CHECK ((status = 'active') = (active_session_ref IS NOT NULL)),
  CHECK (active_session_ref IS NULL OR active_session_ref <> '')
);

CREATE TABLE IF NOT EXISTS head_activation_attempts (
  attempt_id uuid PRIMARY KEY,
  goal_id uuid NOT NULL REFERENCES goals(goal_id),
  department_id text NOT NULL REFERENCES departments(department_id),
  requester_department_id text REFERENCES departments(department_id),
  requester_role text NOT NULL CHECK (requester_role IN ('Concertmaster', 'Head')),
  outcome text NOT NULL CHECK (outcome IN ('reserved', 'already_active', 'cycle_rejected')),
  reason text NOT NULL CHECK (reason <> ''),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CHECK ((requester_role = 'Concertmaster' AND requester_department_id IS NULL)
      OR (requester_role = 'Head' AND requester_department_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS head_activation_attempts_goal_idx ON head_activation_attempts (goal_id, recorded_at, attempt_id);

CREATE TABLE IF NOT EXISTS head_activation_edges (
  goal_id uuid NOT NULL,
  requester_department_id text NOT NULL,
  department_id text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (goal_id, requester_department_id, department_id),
  FOREIGN KEY (goal_id, requester_department_id) REFERENCES goal_head_participations(goal_id, department_id),
  FOREIGN KEY (goal_id, department_id) REFERENCES goal_head_participations(goal_id, department_id),
  CHECK (requester_department_id <> department_id)
);

CREATE OR REPLACE FUNCTION reject_head_activation_history_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'head activation history is append-only';
END;
$$;
DROP TRIGGER IF EXISTS head_activation_attempts_append_only ON head_activation_attempts;
CREATE TRIGGER head_activation_attempts_append_only BEFORE UPDATE OR DELETE ON head_activation_attempts
FOR EACH ROW EXECUTE FUNCTION reject_head_activation_history_mutation();
DROP TRIGGER IF EXISTS head_activation_edges_append_only ON head_activation_edges;
CREATE TRIGGER head_activation_edges_append_only BEFORE UPDATE OR DELETE ON head_activation_edges
FOR EACH ROW EXECUTE FUNCTION reject_head_activation_history_mutation();
