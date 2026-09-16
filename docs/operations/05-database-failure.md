# Database failure

## Purpose

Kill and restart the Control Plane against the disposable database. Confirm stale work is fenced and committed state is not duplicated or lost.

## Preconditions

- Use a disposable PostgreSQL fixture and the repository checkout.
- Keep secrets in the environment; do not place credentials in logs or this document.

## Exercise

Command: `MAESTRO_TEST_DATABASE_URL=postgres://... npm test -- apps/control-plane/src/main.kill-restart.integration.test.ts`

Status: **exercised against a disposable PostgreSQL fixture**. The real Control Plane process was SIGKILLed after a committed transition, restarted against the same database, and the test confirmed no duplicate/lost transition and fail-closed handling of the dangling Goal lease.

Evidence: `/tmp/plan8-s6-database-failure.log` — exit status `0`; **1/1** test passed. Observed process-A kill-to-exit **17 ms**, process-B ready after kill **1444 ms**, total **4663 ms** in the captured run.

## Stop condition

Stop and escalate on an unexpected mutation, a missing safety boundary, or any evidence mismatch. Do not widen authority or use a live external provider to make this runbook pass.
