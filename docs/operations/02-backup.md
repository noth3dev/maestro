# Backup

## Purpose

Create a new, mode-0600 PostgreSQL plain export and record its release-candidate checkpoint identity. Never overwrite an existing export.

## Preconditions

- Use a disposable fixture and the repository checkout.
- Keep secrets in the environment; do not place credentials in logs or this document.

## Exercise

Command: `node scripts/freeze-release-candidate.mjs --manifest /tmp/maestro-release/identity.json --export-path /tmp/maestro-release/database.sql --database-url "$MAESTRO_TEST_DATABASE_URL"`

Status: **pending §S6 real-fixture exercise**. This inventory slice records the command without claiming that it has run successfully.

Evidence: **pending** — replace this marker with the captured test output path and exit status after the exercise gate runs.

## Stop condition

Stop and escalate on an unexpected mutation, a missing safety boundary, or any evidence mismatch. Do not widen authority or use a live external provider to make this runbook pass.
