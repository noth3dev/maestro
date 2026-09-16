# Startup

## Purpose

Exercise the documented local CLI bootstrap path and record the boundary where the complete five-process startup still needs an operator fixture. This runbook does not claim that the Control Plane, Model Gateway, Carnegie client, and Discord process all started together.

## Preconditions

- Use a disposable fixture and the repository checkout.
- Keep secrets in the environment; do not place credentials in logs or this document.

## Exercise

Command: `npm test -- apps/cli/src/tui/local-bootstrap.test.ts`

Status: **partially exercised**. The local CLI bootstrap fixture passed, including the Docker-unavailable embedded PostgreSQL-compatible fallback; the complete five-process startup remains pending because no deterministic connected-app fixture is available.

Evidence: `/tmp/plan8-s6-startup.log` — exit status `0`; **1/1** file and **29/29** tests passed.

## Stop condition

Stop and escalate on an unexpected mutation, a missing safety boundary, or any evidence mismatch. Do not widen authority or use a live external provider to make this runbook pass.
