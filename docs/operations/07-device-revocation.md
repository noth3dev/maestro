# Device revocation

## Purpose

Revoke an enrolled device and confirm its prior grant cannot be reused. Use generated disposable certificates and keys; never use `testbed/`.

## Preconditions

- Use a disposable fixture and the repository checkout.
- Keep secrets in the environment; do not place credentials in logs or this document.

## Exercise

Command: `MAESTRO_TEST_DATABASE_URL=postgres://... npm test -- packages/persistence/src/device.integration.test.ts packages/persistence/src/device-agent-runtime.integration.test.ts`

Status: **pending §S6 real-fixture exercise**. This inventory slice records the command without claiming that it has run successfully.

Evidence: **pending** — replace this marker with the captured test output path and exit status after the exercise gate runs.

## Stop condition

Stop and escalate on an unexpected mutation, a missing safety boundary, or any evidence mismatch. Do not widen authority or use a live external provider to make this runbook pass.
