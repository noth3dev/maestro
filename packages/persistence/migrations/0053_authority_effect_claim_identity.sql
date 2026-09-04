-- A single durable command may contain multiple independently authorized
-- effects, such as creating a branch and its worktree. Claims are unique per
-- command and effect scope, not per command alone.
ALTER TABLE authority_effect_claims
  DROP CONSTRAINT IF EXISTS authority_effect_claims_pkey;
ALTER TABLE authority_effect_claims
  ADD PRIMARY KEY (command_id, action, target);
