-- Why a plan awaits the operator (Encore escalated or rejected it), or how it was approved.
ALTER TABLE goal_plans ADD COLUMN IF NOT EXISTS decision_note text NULL;
