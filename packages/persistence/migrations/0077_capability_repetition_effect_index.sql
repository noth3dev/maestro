ALTER TABLE capability_repetition_claims
  ADD COLUMN IF NOT EXISTS effect_index integer NOT NULL DEFAULT 0;

ALTER TABLE capability_repetition_claims
  DROP CONSTRAINT IF EXISTS capability_repetition_claims_approval_id_command_id_key;

ALTER TABLE capability_repetition_claims
  DROP CONSTRAINT IF EXISTS capability_repetition_claims_capability_kind_goal_id_command_id_key;

ALTER TABLE capability_repetition_claims
  DROP CONSTRAINT IF EXISTS capability_repetition_claims_capability_kind_goal_id_comman_key;

ALTER TABLE capability_repetition_claims
  ADD CONSTRAINT capability_repetition_claims_effect_index_check CHECK (effect_index >= 0);

ALTER TABLE capability_repetition_claims
  ADD CONSTRAINT capability_repetition_claims_capability_goal_command_effect_key UNIQUE (capability_kind, goal_id, command_id, effect_index);
