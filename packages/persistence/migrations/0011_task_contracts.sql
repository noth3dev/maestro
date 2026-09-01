CREATE TABLE IF NOT EXISTS task_contracts (
  contract_id uuid PRIMARY KEY,
  schema_version smallint NOT NULL CHECK (schema_version = 1),
  version bigint NOT NULL CHECK (version > 0),
  content jsonb NOT NULL,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  launch_state text NOT NULL CHECK (launch_state IN ('awaiting_confirmation', 'launched')),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE IF NOT EXISTS task_contract_decisions (
  decision_id uuid PRIMARY KEY,
  contract_id uuid NOT NULL REFERENCES task_contracts(contract_id),
  contract_version bigint NOT NULL CHECK (contract_version > 0),
  kind text NOT NULL CHECK (kind IN ('created', 'amended', 'overture_selected')),
  evidence jsonb NOT NULL,
  content_hash char(64),
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
CREATE INDEX IF NOT EXISTS task_contract_decisions_contract_idx ON task_contract_decisions (contract_id, contract_version, recorded_at);
ALTER TABLE task_contract_decisions ADD COLUMN IF NOT EXISTS content_hash char(64);
DROP TRIGGER IF EXISTS task_contract_decisions_append_only ON task_contract_decisions;
UPDATE task_contract_decisions d SET content_hash = c.content_hash FROM task_contracts c WHERE c.contract_id = d.contract_id AND d.content_hash IS NULL;
ALTER TABLE task_contract_decisions ALTER COLUMN content_hash SET NOT NULL;
ALTER TABLE task_contract_decisions DROP CONSTRAINT IF EXISTS task_contract_decisions_content_hash_check;
ALTER TABLE task_contract_decisions ADD CONSTRAINT task_contract_decisions_content_hash_check CHECK (content_hash ~ '^[0-9a-f]{64}$');

CREATE TABLE IF NOT EXISTS task_contract_confirmations (
  confirmation_id uuid PRIMARY KEY,
  contract_id uuid NOT NULL REFERENCES task_contracts(contract_id),
  contract_version bigint NOT NULL CHECK (contract_version > 0),
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  actor_id text NOT NULL CHECK (actor_id <> ''),
  confirmed_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (contract_id, contract_version, content_hash)
);

CREATE OR REPLACE FUNCTION reject_task_contract_append_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'task contract history and confirmations are append-only';
END;
$$;
DROP TRIGGER IF EXISTS task_contract_decisions_append_only ON task_contract_decisions;
CREATE TRIGGER task_contract_decisions_append_only BEFORE UPDATE OR DELETE ON task_contract_decisions FOR EACH ROW EXECUTE FUNCTION reject_task_contract_append_mutation();
DROP TRIGGER IF EXISTS task_contract_confirmations_append_only ON task_contract_confirmations;
CREATE TRIGGER task_contract_confirmations_append_only BEFORE UPDATE OR DELETE ON task_contract_confirmations FOR EACH ROW EXECUTE FUNCTION reject_task_contract_append_mutation();

CREATE OR REPLACE FUNCTION bind_task_contract_confirmation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_contract task_contracts%ROWTYPE;
BEGIN
  SELECT * INTO current_contract FROM task_contracts WHERE contract_id = NEW.contract_id FOR KEY SHARE;
  IF NOT FOUND OR current_contract.version <> NEW.contract_version OR current_contract.content_hash <> NEW.content_hash THEN
    RAISE EXCEPTION 'confirmation must bind the exact current task contract content';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS task_contract_confirmation_exact_binding ON task_contract_confirmations;
CREATE TRIGGER task_contract_confirmation_exact_binding BEFORE INSERT ON task_contract_confirmations FOR EACH ROW EXECUTE FUNCTION bind_task_contract_confirmation();
CREATE OR REPLACE FUNCTION bind_task_contract_decision()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_contract task_contracts%ROWTYPE;
BEGIN
  SELECT * INTO current_contract FROM task_contracts WHERE contract_id = NEW.contract_id FOR KEY SHARE;
  IF NOT FOUND OR current_contract.version <> NEW.contract_version OR current_contract.content_hash <> NEW.content_hash THEN
    RAISE EXCEPTION 'decision must bind the exact current task contract content';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS task_contract_decision_exact_binding ON task_contract_decisions;
CREATE TRIGGER task_contract_decision_exact_binding BEFORE INSERT ON task_contract_decisions FOR EACH ROW EXECUTE FUNCTION bind_task_contract_decision();
