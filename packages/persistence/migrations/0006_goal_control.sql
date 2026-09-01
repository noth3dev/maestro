CREATE TABLE IF NOT EXISTS goal_controls (
  project_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  control_epoch bigint NOT NULL DEFAULT 1 CHECK (control_epoch > 0),
  emergency_stopped_at timestamptz,
  PRIMARY KEY (project_id, goal_id)
);
