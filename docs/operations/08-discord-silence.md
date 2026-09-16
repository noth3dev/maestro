# Discord silence

## Purpose

Verify overdue or missing Discord observations become `uncertain`, not a fabricated no-incident result. Use a disposable database and synthetic signal fixture; this is not live Discord detection.

## Preconditions

- Use a disposable PostgreSQL fixture and the repository checkout.
- Use synthetic signals only; do not call Discord or a live external provider.
- Keep secrets in the environment; do not place credentials in logs or this document.

## Exercise

Command: `MAESTRO_TEST_DATABASE_URL=postgres://... npm test -- packages/persistence/src/discord-incident.integration.test.ts`

Status: **exercised against a disposable PostgreSQL fixture with synthetic signals**. Missing and silent observations became `uncertain` with explicit reasons, without creating a no-incident conclusion; incident signal history and deduplication paths also passed.

Evidence: `/tmp/plan8-s6-discord-silence.log` — exit status `0`; **1/1** file and **6/6** tests passed. This proves the synthetic persistence path only, not live Discord detection.

## Stop condition

Stop and escalate on an unexpected mutation, a missing safety boundary, or any evidence mismatch. Do not widen authority or use a live external provider to make this runbook pass.
