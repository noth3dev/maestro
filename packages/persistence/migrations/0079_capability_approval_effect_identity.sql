-- Allow one command's approval block to authorize distinct exact effects.
ALTER TABLE capability_approvals
  DROP CONSTRAINT IF EXISTS capability_approvals_capability_kind_goal_id_command_id_key;

ALTER TABLE capability_approvals
  ADD CONSTRAINT capability_approvals_capability_goal_command_action_target_key
  UNIQUE (capability_kind, goal_id, command_id, action, target);
