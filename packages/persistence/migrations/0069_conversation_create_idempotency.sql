ALTER TABLE conversations ADD COLUMN IF NOT EXISTS create_request_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS conversations_create_request_idx
  ON conversations (operator_id, project_id, create_request_id)
  WHERE create_request_id IS NOT NULL;
