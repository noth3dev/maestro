ALTER TABLE goals ADD COLUMN IF NOT EXISTS task_contract_id uuid REFERENCES task_contracts(contract_id);
CREATE UNIQUE INDEX IF NOT EXISTS goals_task_contract_id_unique ON goals (task_contract_id) WHERE task_contract_id IS NOT NULL;
