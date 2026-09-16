# Backup

## Purpose

Create a new, mode-0600 PostgreSQL plain export and record its release-candidate checkpoint identity. Never overwrite an existing export.

## Preconditions

- Use a disposable fixture and the repository checkout.
- Use a `pg_dump` client matching the major version of the fixture server.
- Set the release model-gateway, provider-adapter, and browser pins in the environment.
- Keep secrets in the environment; do not place credentials in logs or this document.

## Exercise

Command: `node scripts/freeze-release-candidate.mjs --manifest /tmp/maestro-release/identity.json --export-path /tmp/maestro-release/database.sql --database-url "$MAESTRO_TEST_DATABASE_URL"`

Status: **exercised against a disposable PostgreSQL 16 fixture**. The export was new, mode `0600`, and the release checkpoint recorded the same export hash.

Evidence: `/tmp/maestro-release/backup-exercise.log` — exit status `0`; export mode `600`, size `649884` bytes, SHA-256 `429d85e2bf83d01ec82f85c02f0617cd2b34784b9836566c2c89e904b06a47b0`; candidate `48caa3cdb96265e9131c19e47b4334f9be9892b5678334a58ecef086bad602b1`.

## Stop condition

Stop and escalate on an unexpected mutation, a missing safety boundary, or any evidence mismatch. Do not widen authority or use a live external provider to make this runbook pass.
