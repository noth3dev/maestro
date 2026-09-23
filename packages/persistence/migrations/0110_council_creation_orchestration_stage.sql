-- Widen the first orchestration stage to include durable Head Council creation.
ALTER TABLE goal_orchestration_runs DROP CONSTRAINT IF EXISTS goal_orchestration_runs_stage_check;
ALTER TABLE goal_orchestration_runs ADD CONSTRAINT goal_orchestration_runs_stage_check CHECK (stage IN ('head_activation', 'council_creation'));
ALTER TABLE goal_orchestration_history DROP CONSTRAINT IF EXISTS goal_orchestration_history_stage_check;
ALTER TABLE goal_orchestration_history ADD CONSTRAINT goal_orchestration_history_stage_check CHECK (stage IN ('head_activation', 'council_creation'));
