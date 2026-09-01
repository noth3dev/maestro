CREATE TABLE IF NOT EXISTS local_operators (
  operator_id uuid PRIMARY KEY,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE IF NOT EXISTS local_operator_credentials (
  credential_id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES local_operators(operator_id),
  active boolean NOT NULL DEFAULT true,
  revoked_at timestamptz,
  salt bytea NOT NULL CHECK (octet_length(salt) = 16),
  verifier bytea NOT NULL CHECK (octet_length(verifier) = 64),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CHECK (revoked_at IS NULL OR active = false)
);
CREATE INDEX IF NOT EXISTS local_operator_credentials_operator_idx ON local_operator_credentials (operator_id);

CREATE OR REPLACE FUNCTION local_operator_credential_identifiers_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.credential_id <> OLD.credential_id OR NEW.operator_id <> OLD.operator_id THEN
    RAISE EXCEPTION 'local operator credential identifiers are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS local_operator_credential_identifiers_immutable_trigger ON local_operator_credentials;
CREATE TRIGGER local_operator_credential_identifiers_immutable_trigger
  BEFORE UPDATE ON local_operator_credentials
  FOR EACH ROW EXECUTE FUNCTION local_operator_credential_identifiers_immutable();
