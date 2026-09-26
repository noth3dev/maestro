-- Role taxonomy v3 adds the Plan Reviewer, the crew member who challenges
-- plans before they become a Task Contract. v2 runs remain valid.
ALTER TABLE overture_runs DROP CONSTRAINT IF EXISTS overture_runs_role_taxonomy_version_check;
ALTER TABLE overture_runs ADD CONSTRAINT overture_runs_role_taxonomy_version_check CHECK (role_taxonomy_version IN (2, 3));
ALTER TABLE overture_role_assignments DROP CONSTRAINT IF EXISTS overture_role_assignments_role_id_check;
ALTER TABLE overture_role_assignments ADD CONSTRAINT overture_role_assignments_role_id_check CHECK (role_id IN ('conversation-lead', 'architecture-analyst', 'external-research-scout', 'security-evaluator', 'design-mock-specialist', 'task-editor', 'plan-reviewer'));
