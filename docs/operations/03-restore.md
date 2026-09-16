# Restore

## Purpose

Restore a previously captured plain export only into a disposable PostgreSQL database or schema, then read back the expected fixture. The repository has no production restore helper; never use `applyAllMigrations` as a substitute for restoring a dump.

## Preconditions

- Use a disposable fixture and the repository checkout.
- Use a `psql` client matching the major version of the dump and target server.
- Set `MAESTRO_RESTORE_DATABASE_URL` to the disposable target and `MAESTRO_RELEASE_EXPORT_PATH` to the captured export.
- Keep secrets in the environment; do not place credentials in logs or this document.

## Exercise

Command: `psql "$MAESTRO_RESTORE_DATABASE_URL" --file "$MAESTRO_RELEASE_EXPORT_PATH" --single-transaction --set ON_ERROR_STOP=1 && psql "$MAESTRO_RESTORE_DATABASE_URL" --tuples-only --no-align --set ON_ERROR_STOP=1 --command="SELECT (SELECT count(*) FROM schema_migrations), (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'), (SELECT count(*) FROM release_checkpoints);"`

Status: **exercised against a disposable PostgreSQL 16 fixture**. The plain export restored successfully and the readback returned `107|133|0` (migration rows, public tables, release checkpoints).

Evidence: `/tmp/maestro-release/restore-exercise.log` — exit status `0`; the disposable restore database was dropped after readback.

## Stop condition

Stop and escalate on an unexpected mutation, a missing safety boundary, or any evidence mismatch. Do not widen authority or use a live external provider to make this runbook pass.
