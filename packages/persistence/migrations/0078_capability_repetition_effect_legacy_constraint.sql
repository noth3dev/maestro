-- Existing databases applied 0077 before the legacy approval/command uniqueness was removed.
ALTER TABLE capability_repetition_claims
  DROP CONSTRAINT IF EXISTS capability_repetition_claims_approval_id_command_id_key;

ALTER TABLE capability_repetition_claims
  DROP CONSTRAINT IF EXISTS capability_repetition_claims_capability_kind_goal_id_comman_key;
