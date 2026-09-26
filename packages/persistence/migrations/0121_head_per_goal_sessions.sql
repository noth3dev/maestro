-- A Head is a standing identity that can staff several Goals at once, one
-- session per Goal (goal_head_participations_head_role_goal_idx still holds).
DROP INDEX IF EXISTS goal_head_participations_active_head_idx;
DROP INDEX IF EXISTS goal_head_participations_active_role_idx;
