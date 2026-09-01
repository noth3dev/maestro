-- Phase 2 work-sequence step 10: Git branch/worktree/commit/integration
-- evidence. Durable records only; the actual local Git operations run
-- through the injected GitPort (packages/git-adapter) before each record is
-- persisted. No remote push, shared merge, history rewriting, release, or
-- deployment record exists here by construction. Additive only.

CREATE TABLE IF NOT EXISTS goal_integration_branches (
  goal_id uuid PRIMARY KEY REFERENCES goals (goal_id),
  repository_path text NOT NULL CHECK (btrim(repository_path) <> ''),
  branch_name text NOT NULL CHECK (btrim(branch_name) <> ''),
  base_revision text NOT NULL CHECK (base_revision ~ '^[0-9a-f]{40}$'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime'
);
CREATE OR REPLACE FUNCTION reject_goal_integration_branch_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Goal integration branch record is append-only';
END;
$$;
DROP TRIGGER IF EXISTS goal_integration_branches_immutable ON goal_integration_branches;
CREATE TRIGGER goal_integration_branches_immutable
  BEFORE UPDATE OR DELETE ON goal_integration_branches
  FOR EACH ROW EXECUTE FUNCTION reject_goal_integration_branch_mutation();

CREATE TABLE IF NOT EXISTS department_branches (
  goal_id uuid NOT NULL REFERENCES goal_integration_branches (goal_id),
  department_id text NOT NULL REFERENCES departments (department_id),
  repository_path text NOT NULL CHECK (btrim(repository_path) <> ''),
  branch_name text NOT NULL CHECK (btrim(branch_name) <> ''),
  base_branch_name text NOT NULL CHECK (btrim(base_branch_name) <> ''),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime',
  PRIMARY KEY (goal_id, department_id)
);
DROP TRIGGER IF EXISTS department_branches_immutable ON department_branches;
CREATE TRIGGER department_branches_immutable
  BEFORE UPDATE OR DELETE ON department_branches
  FOR EACH ROW EXECUTE FUNCTION reject_goal_integration_branch_mutation();

CREATE TABLE IF NOT EXISTS worker_worktrees (
  worker_id uuid PRIMARY KEY REFERENCES workers (worker_id),
  repository_path text NOT NULL CHECK (btrim(repository_path) <> ''),
  worktree_path text NOT NULL CHECK (btrim(worktree_path) <> ''),
  branch_name text NOT NULL CHECK (btrim(branch_name) <> ''),
  base_branch_name text NOT NULL CHECK (btrim(base_branch_name) <> ''),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime',
  UNIQUE (worktree_path)
);
DROP TRIGGER IF EXISTS worker_worktrees_immutable ON worker_worktrees;
CREATE TRIGGER worker_worktrees_immutable
  BEFORE UPDATE OR DELETE ON worker_worktrees
  FOR EACH ROW EXECUTE FUNCTION reject_goal_integration_branch_mutation();

CREATE TABLE IF NOT EXISTS integration_commits (
  commit_id uuid PRIMARY KEY,
  worker_id uuid NOT NULL REFERENCES worker_worktrees (worker_id),
  commit_sha char(40) NOT NULL CHECK (commit_sha ~ '^[0-9a-f]{40}$'),
  message text NOT NULL CHECK (btrim(message) <> ''),
  evidence_references jsonb NOT NULL CHECK (jsonb_typeof(evidence_references) = 'array'),
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime',
  UNIQUE (worker_id, commit_sha)
);
CREATE INDEX IF NOT EXISTS integration_commits_worker_idx ON integration_commits (worker_id, recorded_at);
DROP TRIGGER IF EXISTS integration_commits_immutable ON integration_commits;
CREATE TRIGGER integration_commits_immutable
  BEFORE UPDATE OR DELETE ON integration_commits
  FOR EACH ROW EXECUTE FUNCTION reject_goal_integration_branch_mutation();
