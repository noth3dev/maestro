# Plan 8 §S9 representative scenarios

## Status

**Blocked: inventory and report contract only.** The repository now has a canonical catalog for all eleven representative scenarios and a safe report runner. This does **not** close §S9 or G7. A complete run still requires one frozen candidate and real end-to-end evidence from the same run.

## Run the safe inventory report

From the repository root:

```bash
rm -f /tmp/plan8-s9-scenarios.json /tmp/plan8-s9-scenarios.json.lock
node scripts/run-phase8-scenarios.mjs --report /tmp/plan8-s9-scenarios.json
```

The command intentionally exits `2` with `status=blocked` until live evidence is available. It writes an atomic `0600` report and removes its exclusive lock. The final fixture report is `/tmp/plan8-s9-scenarios.json`, exit status `2`, mode `0600`, lock absent, content hash `42865b5a9503d2dc13b85ad9d35ab6a3c29f9bd5ca842ac63a021c2521d2318b`, and **11/11** catalog records.

`--execute` is additionally gated by `MAESTRO_PHASE8_SCENARIOS_LIVE=1`. Even then, mapped suite output remains `blocked` unless the same run supplies the required actors, models, skills, tools, costs, durable events/evidence, certifications, dissent, and cleanup record. Passing component suites is not converted into a false full-system claim.

## Canonical scenario catalog

| ID                          | Scenario                        | Reused executable suites                                                                                                                                                                           | Current boundary                                                                   |
| --------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `01-overture`               | Overture                        | `apps/control-plane/src/task-contract-api.integration.test.ts`, `packages/persistence/src/e2e-goal.integration.test.ts`                                                                            | Role selection/launch components only; full live launch record pending.            |
| `02-hierarchical-execution` | Hierarchical execution          | `apps/control-plane/src/native-worker-acceptance.integration.test.ts`, `test/phase6-scenario/full-chain.integration.test.ts`                                                                       | Synthetic gateway/kernel boundaries remain; full cross-phase handoff pending.      |
| `03-head-to-head`           | Head-to-Head activation         | `packages/persistence/src/head-participation.integration.test.ts`, `apps/control-plane/src/head-participation-api.integration.test.ts`                                                             | Dedicated mid-Goal Head-to-Head runtime seam is not exposed.                       |
| `04-environment-device`     | Environment and enrolled device | `packages/persistence/src/phase4-device-live-gate.integration.test.ts`, `apps/device-agent/src/main.integration.test.ts`                                                                           | Real composed environment+CLI+device flow pending.                                 |
| `05-restart-recovery`       | Restart recovery                | `test/release-scenario/worker-restart-recovery.integration.test.ts`, `test/phase7-scenario/cli-parity-and-recovery-proof.integration.test.ts`                                                      | Synthetic provider result; one frozen-candidate end-to-end run pending.            |
| `06-discord-incident`       | Discord incident                | `apps/discord/src/live-gate.integration.test.ts`, `apps/control-plane/src/discord-signal-acceptance.integration.test.ts`, `packages/persistence/src/discord-incident-workflow.integration.test.ts` | Live Discord detection/delivery is not claimed.                                    |
| `07-encore-improvement`     | Encore improvement              | `apps/control-plane/src/encore-acceptance.integration.test.ts`, `test/phase6-scenario/full-chain.integration.test.ts`, `test/phase8-routing/routing-hardening-fuzz.test.ts`                        | Synthetic evaluation; full same-run digest-to-rollout record pending.              |
| `08-portfolio-council`      | Portfolio Council               | `test/phase5-scenario/contention.integration.test.ts`                                                                                                                                              | Durable contention only; full same-run prioritization/reallocation record pending. |
| `09-ipython-approval`       | IPython approval gate           | `packages/agent-runtime/src/ipython-two-stage.test.ts`, `test/phase8-security/security-adversarial.test.ts`, `test/release-scenario/critical-action-forbidden-effect.integration.test.ts`          | Local mechanics only; live full-access/repetition/stop evidence pending.           |
| `10-critical-gate`          | Critical gate                   | `test/release-scenario/critical-action-forbidden-effect.integration.test.ts`, `test/phase8-security/security-adversarial.test.ts`                                                                  | No remote or external effect is invoked by this fixture.                           |
| `11-radial-app`             | Radial app                      | `test/phase7-scenario/cli-parity-and-recovery-proof.integration.test.ts`, `test/phase8-performance/radial-graph-large-portfolio-baseline.integration.test.ts`                                      | Full Electron visual and screen-reader acceptance pending.                         |

Each catalog record includes the required fields for actual actors, models, skills, tools, costs, injected failures, durable events/evidence, expected/observed behavior, certifications, dissent, limitations, and cleanup. Empty actual fields in the blocked report mean **not observed**, not zero activity.

## Explicit limitations

- The runner reuses existing suites but does not invent missing production orchestration.
- Provider, remote, deployment, payment, Discord, and external-send effects remain disabled.
- Existing suite evidence may use disposable PostgreSQL, loopback, synthetic provider, or in-memory fixtures; those boundaries remain labeled.
- A passing inventory test, mapped suite, or static catalog cannot close the eleven real-scenario requirement.
