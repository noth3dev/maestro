-- Plan 6 §S9 remediation: bind the actual bounded worker assignment to its Worker.
ALTER TABLE workers ADD COLUMN IF NOT EXISTS worker_profile_derivation jsonb;
