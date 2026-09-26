-- The Department Heads' execution plan per Goal: cross-department phases and
-- department-owned slices (p<phase>s<n>). Each revision is a new version;
-- the Encore Council approves a version before dispatch.
CREATE TABLE IF NOT EXISTS goal_plans (
  goal_id uuid NOT NULL,
  project_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('draft', 'awaiting_approval', 'approved', 'superseded', 'rejected')),
  council_id uuid NULL,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  approval_ref text NULL CHECK (approval_ref IS NULL OR length(approval_ref) <= 512),
  command_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (goal_id, version)
);
CREATE INDEX IF NOT EXISTS goal_plans_project_idx ON goal_plans (project_id, goal_id, version DESC);

CREATE TABLE IF NOT EXISTS goal_plan_phases (
  goal_id uuid NOT NULL,
  version integer NOT NULL,
  phase_no integer NOT NULL CHECK (phase_no > 0),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 4000),
  outcome text NOT NULL CHECK (length(btrim(outcome)) BETWEEN 1 AND 4000),
  PRIMARY KEY (goal_id, version, phase_no),
  FOREIGN KEY (goal_id, version) REFERENCES goal_plans (goal_id, version)
);

CREATE TABLE IF NOT EXISTS goal_plan_slices (
  goal_id uuid NOT NULL,
  version integer NOT NULL,
  slice_id text NOT NULL CHECK (slice_id ~ '^p[1-9][0-9]*s[1-9][0-9]*$'),
  phase_no integer NOT NULL,
  department_id text NOT NULL CHECK (length(btrim(department_id)) BETWEEN 1 AND 128),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 4000),
  objective text NOT NULL CHECK (length(btrim(objective)) BETWEEN 1 AND 4000),
  acceptance jsonb NOT NULL CHECK (jsonb_typeof(acceptance) = 'array' AND jsonb_array_length(acceptance) BETWEEN 1 AND 64),
  depends_on jsonb NOT NULL CHECK (jsonb_typeof(depends_on) = 'array' AND jsonb_array_length(depends_on) <= 64),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'approved', 'in_progress', 'review', 'done', 'blocked')),
  status_reason text NULL CHECK (status_reason IS NULL OR length(status_reason) <= 1000),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (goal_id, version, slice_id),
  FOREIGN KEY (goal_id, version, phase_no) REFERENCES goal_plan_phases (goal_id, version, phase_no)
);
