ALTER TABLE goal_controls ADD COLUMN IF NOT EXISTS default_spend_ceiling_cents bigint NOT NULL DEFAULT 5000 CHECK (default_spend_ceiling_cents >= 0);
ALTER TABLE goal_controls ADD COLUMN IF NOT EXISTS default_critical_actions_require_approval boolean NOT NULL DEFAULT true;
ALTER TABLE goal_controls ADD COLUMN IF NOT EXISTS default_allow_flashmob boolean NOT NULL DEFAULT true;
