-- Keep Council creation resumable while sealed independent briefs are still pending.
ALTER TABLE goal_orchestration_runs DROP CONSTRAINT IF EXISTS goal_orchestration_runs_stage_check;
ALTER TABLE goal_orchestration_runs ADD CONSTRAINT goal_orchestration_runs_stage_check CHECK (stage IN ('head_activation', 'council_creation', 'briefs_pending'));
ALTER TABLE goal_orchestration_history DROP CONSTRAINT IF EXISTS goal_orchestration_history_stage_check;
ALTER TABLE goal_orchestration_history ADD CONSTRAINT goal_orchestration_history_stage_check CHECK (stage IN ('head_activation', 'council_creation', 'briefs_pending'));
