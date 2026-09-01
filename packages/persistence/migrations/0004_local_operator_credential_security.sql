CREATE OR REPLACE FUNCTION local_operator_credential_security_immutable() RETURNS trigger AS $$
BEGIN
  IF (OLD.revoked_at IS NOT NULL AND (NEW.revoked_at IS NULL OR NEW.active IS DISTINCT FROM false)) THEN
    RAISE EXCEPTION 'revoked local operator credentials cannot be reactivated';
  END IF;
  IF NEW.salt IS DISTINCT FROM OLD.salt OR NEW.verifier IS DISTINCT FROM OLD.verifier THEN
    RAISE EXCEPTION 'local operator credential verifier material is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS local_operator_credential_security_immutable_trigger ON local_operator_credentials;
CREATE TRIGGER local_operator_credential_security_immutable_trigger
  BEFORE UPDATE ON local_operator_credentials
  FOR EACH ROW EXECUTE FUNCTION local_operator_credential_security_immutable();
