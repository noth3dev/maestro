# Device revocation

## Purpose

Revoke an enrolled device and confirm its prior grant cannot be reused. Use generated disposable device keys; never use `testbed/`.

## Preconditions

- Use a disposable PostgreSQL fixture and the repository checkout.
- Keep secrets in the environment; do not place credentials in logs or this document.

## Exercise

Command: `MAESTRO_TEST_DATABASE_URL=postgres://... npm test -- packages/persistence/src/device.integration.test.ts packages/persistence/src/device-agent-runtime.integration.test.ts`

Status: **exercised against a disposable PostgreSQL fixture**. The device and device-agent runtime integration suites exercised enrollment, policy/grant/session checks, command claim/replay, natural expiry, terminal close, and revocation behavior with generated disposable keys.

Evidence: `/tmp/plan8-s6-device-revocation.log` — exit status `0`; **2/2** files and **14/14** tests passed. No `testbed/` fixture was used.

## Stop condition

Stop and escalate on an unexpected mutation, a missing safety boundary, or any evidence mismatch. Do not widen authority or use a live external provider to make this runbook pass.
