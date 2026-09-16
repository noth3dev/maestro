# Failed rollout

## Purpose

Force a protected-metric or source-retirement failure and confirm the bounded rollout returns to its last certified candidate.

## Preconditions

- Use a disposable PostgreSQL fixture and the repository checkout.
- Keep secrets in the environment; do not place credentials in logs or this document.

## Exercise

Command: `MAESTRO_TEST_DATABASE_URL=postgres://... npm test -- packages/persistence/src/rollout-controller.integration.test.ts`

Status: **exercised against a disposable PostgreSQL fixture**. The integration suite covered source-evidence rollback, bounded scope, protected candidate isolation, interrupted-rollout reconciliation, and the routing-capability rollback path without mutating the human model baseline.

Evidence: `/tmp/plan8-s6-failed-rollout.log` — exit status `0`; **1/1** file and **9/9** tests passed.

## Stop condition

Stop and escalate on an unexpected mutation, a missing safety boundary, or any evidence mismatch. Do not widen authority or use a live external provider to make this runbook pass.
