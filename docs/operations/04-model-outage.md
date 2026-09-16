# Model outage

## Purpose

Confirm that a gateway outage is reported as `provider_unavailable`, response bodies are not leaked, and no unrouted fallback is selected.

## Preconditions

- Use a disposable fixture and the repository checkout.
- Use a loopback HTTP gateway fixture that returns a controlled `503`; do not call a live provider.
- Keep secrets in the environment; do not place credentials in logs or this document.

## Exercise

Command: `npm test -- test/phase8-ops/model-outage-loopback.integration.test.ts apps/control-plane/src/model-gateway-client.test.ts test/phase8-chaos/chaos-injection.test.ts`

Status: **exercised with a loopback HTTP gateway fixture and the existing deterministic fault tests**. The production `createModelGatewayClient` received a real loopback `503` response containing a secret outside the error object and returned `provider_unavailable`/`503` without exposing that response secret; no fallback model or live provider was used.

Evidence: `/tmp/plan8-s6-model-outage.log` — the captured command output shows **3 files passed, 15/15 tests passed**, including the real loopback HTTP fixture test, and `EXIT_STATUS=0`.

## Stop condition

Stop and escalate on an unexpected mutation, a missing safety boundary, or any evidence mismatch. Do not widen authority or use a live external provider to make this runbook pass.
