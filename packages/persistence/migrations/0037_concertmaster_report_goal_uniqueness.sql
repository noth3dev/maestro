-- Phase 3 remediation: one immutable final report per Goal.
-- Additive only; retries return the existing committed report in the service layer.

CREATE UNIQUE INDEX IF NOT EXISTS concertmaster_final_reports_one_per_goal_idx
  ON concertmaster_final_reports (goal_id);
