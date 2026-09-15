# Startup

## Purpose

Boot the local CLI, Control Plane, Model Gateway, Carnegie client, and Discord process in the documented order.

## Preconditions

- Use a disposable fixture and the repository checkout.
- Keep secrets in the environment; do not place credentials in logs or this document.

## Exercise

Command: `npm test -- apps/cli/src/tui/local-bootstrap.test.ts`

Status: **pending §S6 real-fixture exercise**. This inventory slice records the command without claiming that it has run successfully.

Evidence: **pending** — replace this marker with the captured test output path and exit status after the exercise gate runs.

## Stop condition

Stop and escalate on an unexpected mutation, a missing safety boundary, or any evidence mismatch. Do not widen authority or use a live external provider to make this runbook pass.
