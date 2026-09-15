# Database failure

## Purpose

Kill and restart the Control Plane against the disposable database. Confirm stale work is fenced and committed state is not duplicated or lost.

## Preconditions

- Use a disposable fixture and the repository checkout.
- Keep secrets in the environment; do not place credentials in logs or this document.

## Exercise

Command: `MAESTRO_TEST_DATABASE_URL=postgres://... npm test -- apps/control-plane/src/main.kill-restart.integration.test.ts`

Status: **pending §S6 real-fixture exercise**. This inventory slice records the command without claiming that it has run successfully.

Evidence: **pending** — replace this marker with the captured test output path and exit status after the exercise gate runs.

## Stop condition

Stop and escalate on an unexpected mutation, a missing safety boundary, or any evidence mismatch. Do not widen authority or use a live external provider to make this runbook pass.
