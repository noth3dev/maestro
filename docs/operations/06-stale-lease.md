# Stale lease

## Purpose

Exercise stale and forged fencing tokens and confirm every rejected operation leaves durable state unchanged.

## Preconditions

- Use a disposable PostgreSQL fixture and the repository checkout.
- Keep secrets in the environment; do not place credentials in logs or this document.

## Exercise

Command: `MAESTRO_TEST_DATABASE_URL=postgres://... npm test -- packages/persistence/src/fencing.property.test.ts`

Status: **exercised against a disposable PostgreSQL fixture**. Property-based cases rejected stale, forged, and mismatched lease proofs without durable writes or lease mutation.

Evidence: `/tmp/plan8-s6-stale-lease.log` — exit status `0`; **1/1** file and **4/4** tests passed, including 25 generated cases for each stale-token property.

## Stop condition

Stop and escalate on an unexpected mutation, a missing safety boundary, or any evidence mismatch. Do not widen authority or use a live external provider to make this runbook pass.
