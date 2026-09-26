-- Projects become named records. Each operator has one Home project (the
-- global workspace where Concertmaster sessions start); a PRD approved there
-- creates a new project for its Goal.
CREATE TABLE IF NOT EXISTS projects (
  project_id uuid PRIMARY KEY,
  name text NOT NULL CHECK (btrim(name) <> '' AND char_length(name) <= 120),
  kind text NOT NULL CHECK (kind IN ('home', 'project')),
  created_by uuid NULL REFERENCES local_operators(operator_id),
  create_command_id uuid NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS projects_one_home_per_operator ON projects (created_by) WHERE kind = 'home';

-- Backfill: each operator's earliest project is their Home; any other
-- existing project keeps working under a placeholder name.
INSERT INTO projects (project_id, name, kind, created_by, created_at)
SELECT DISTINCT ON (m.operator_id) m.project_id, 'Home', 'home', m.operator_id, m.granted_at
  FROM operator_project_memberships m
 WHERE m.active
   AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.project_id = m.project_id)
 ORDER BY m.operator_id, m.granted_at, m.project_id
ON CONFLICT DO NOTHING;
INSERT INTO projects (project_id, name, kind, created_by, created_at)
SELECT DISTINCT ON (m.project_id) m.project_id, 'Project ' || left(m.project_id::text, 8), 'project', m.operator_id, m.granted_at
  FROM operator_project_memberships m
 WHERE m.active
   AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.project_id = m.project_id)
 ORDER BY m.project_id, m.granted_at
ON CONFLICT DO NOTHING;

-- A PRD approved in one project (usually Home) may start its Goal in another
-- (usually a new project). The run keeps its own project; this records where
-- its Task Contract lives.
ALTER TABLE overture_runs ADD COLUMN IF NOT EXISTS target_project_id uuid NULL;
