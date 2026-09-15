# Model outage

## Purpose

Confirm that a gateway outage is reported as `provider_unavailable`, response bodies are not leaked, and no unrouted fallback is selected.

## Preconditions

- Use a disposable fixture and the repository checkout.
- Keep secrets in the environment; do not place credentials in logs or this document.

## Exercise

Command: `npm test -- apps/control-plane/src/model-gateway-client.test.ts test/phase8-chaos/chaos-injection.test.ts`

Status: **pending §S6 real-fixture exercise**. This inventory slice records the command without claiming that it has run successfully.

Evidence: **pending** — replace this marker with the captured test output path and exit status after the exercise gate runs.

## Stop condition

Stop and escalate on an unexpected mutation, a missing safety boundary, or any evidence mismatch. Do not widen authority or use a live external provider to make this runbook pass.
