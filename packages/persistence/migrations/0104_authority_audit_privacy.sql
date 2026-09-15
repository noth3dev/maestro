-- Plan 8 §S4: reject credentials and prohibited private content at the authority audit boundary.

CREATE OR REPLACE FUNCTION reject_authority_audit_sensitive_content()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF to_jsonb(NEW)::text ~* '(authorization[[:space:]]*:[[:space:]]*bearer|bearer[[:space:]]+[[:graph:]]+|password[[:space:]]*[:=]|passwd[[:space:]]*[:=]|secret[[:space:]]*[:=]|api[_-]?key[[:space:]]*[:=]|access[_-]?token[[:space:]]*[:=]|refresh[_-]?token[[:space:]]*[:=]|private[_-]?key|credential[[:space:]]*[:=]|-----BEGIN.*PRIVATE KEY-----|(^|[^a-z0-9])(sk|pk)-[a-z0-9_-]{16,}([^a-z0-9]|$)|eyj[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+|AKIA[0-9A-Z]{16}|gh[pousr]_[a-z0-9]{20,}|AIza[0-9a-z_-]{20,}|xox[baprs]-[0-9a-z-]{20,}|hf_[0-9a-z]{20,}|(^|[^a-z])(email|phone|ssn|social security|home address|personal information)([^a-z]|$))' THEN
    RAISE EXCEPTION 'authority audit record contains prohibited private content';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS authority_records_sensitive_content ON authority_records;
CREATE TRIGGER authority_records_sensitive_content
BEFORE INSERT OR UPDATE ON authority_records
FOR EACH ROW EXECUTE FUNCTION reject_authority_audit_sensitive_content();

DROP TRIGGER IF EXISTS authority_decisions_sensitive_content ON authority_decisions;
CREATE TRIGGER authority_decisions_sensitive_content
BEFORE INSERT OR UPDATE ON authority_decisions
FOR EACH ROW EXECUTE FUNCTION reject_authority_audit_sensitive_content();
