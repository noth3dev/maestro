# Maestro Naming Registry & Implementation Provenance

This is the canonical naming registry. It records the verified names used by the current repository and points to the source that establishes each name. **Head** is the canonical role name; **Principal** is not a Maestro name.

| Name | Verified source | Status on the current main line |
| --- | --- | --- |
| **Overture** | [`docs/en/02-hierarchical-orchestration.md`](../../docs/en/02-hierarchical-orchestration.md) | Implemented as the selectively activated intake and Task Contract drafting crew. |
| **Encore** | [`packages/domain/src/encore-council.ts`](../../packages/domain/src/encore-council.ts) | Implemented as the independent council/oversight domain boundary; automatic learning and rollout remain bounded/deferred. |
| **Concertmaster** | [`packages/domain/src/concertmaster-report.ts`](../../packages/domain/src/concertmaster-report.ts) | Implemented as the CEO-facing Secretary Office identity and reporting boundary. |
| **Metronome** | [`packages/domain/src/metronome.ts`](../../packages/domain/src/metronome.ts) | Implemented as the integrity/quality observation and challenge domain boundary. |
| **Head** *(never “Principal”)* | [`packages/domain/src/head-participation.ts`](../../packages/domain/src/head-participation.ts) | Implemented as the canonical domain role and participation API. Do not introduce `Principal` as a synonym. |
| **Scout** | [`packages/domain/src/mission-bundle.ts`](../../packages/domain/src/mission-bundle.ts) | Implemented as a Mission Bundle role (`scout`); production host-tool effects are not enabled. |
| **Worker** | [`packages/domain/src/worker.ts`](../../packages/domain/src/worker.ts) | Implemented as a Mission Bundle/execution role; the native path remains text/evidence-only while host tools are unregistered. |
| **Department** | [`packages/domain/src/organization.ts`](../../packages/domain/src/organization.ts) | Implemented in the organization and Head participation domain model. |
| **Goal** | [`packages/domain/src/goal.ts`](../../packages/domain/src/goal.ts) | Implemented as the durable orchestration aggregate and Control Plane lifecycle. |
| **Mission Bundle** | [`packages/domain/src/mission-bundle.ts`](../../packages/domain/src/mission-bundle.ts) | Implemented as the immutable per-unit execution authorization record, including `TaskDemand`; routing evidence is persisted separately. |
| **Secretary** | [`roadmap/act-1-foundation/phase-02-hierarchical-execution.md`](../act-1-foundation/phase-02-hierarchical-execution.md) | Architectural role name for the Secretary Office. The CEO-facing identity is **Concertmaster**; the product UI is **Carnegie**. |
| **Carnegie** | [`apps/secretary/README.md`](../../apps/secretary/README.md) | Implemented user-facing desktop application branding. Internal `apps/secretary` and Secretary identifiers remain technical names. |
| **Discord** | [`apps/discord/README.md`](../../apps/discord/README.md) | Implemented as an independent out-of-band incident/watchdog process; external-capability acceptance remains open. |
| **watchdog** | [`packages/agent-runtime/src/ipython-host.ts`](../../packages/agent-runtime/src/ipython-host.ts) | Implemented for parent identity/liveness handling in the IPython process boundary; production live acceptance is still open. |
| **FIFO** | [`packages/agent-runtime/src/ipython-process-adapter.ts`](../../packages/agent-runtime/src/ipython-process-adapter.ts) | Implemented as the per-session host-block ordering invariant; it is not a routing or authority primitive. |
| **liveness** | [`packages/agent-runtime/src/ipython-host.ts`](../../packages/agent-runtime/src/ipython-host.ts) | Implemented as fail-closed parent-liveness checks; no claim is made for full live host-tool acceptance. |
| **reconciler** | [`apps/control-plane/src/main.ts`](../../apps/control-plane/src/main.ts) | Implemented for durable Goal/lease recovery scaffolding; durable native-session reconciliation remains limited. |
| **Control Plane** | [`apps/control-plane/src/server.ts`](../../apps/control-plane/src/server.ts) | Implemented as the authenticated REST/SSE and PostgreSQL authority boundary. |
| **Model Gateway** | [`apps/control-plane/src/model-gateway-client.ts`](../../apps/control-plane/src/model-gateway-client.ts) | Implemented as the authenticated provider boundary; it owns provider credentials/account login and exact model identity. |
| **native runtime** | [`packages/agent-runtime/src/agent-runtime.ts`](../../packages/agent-runtime/src/agent-runtime.ts) | Implemented as the Maestro-owned provider-neutral runtime. It does not yet perform Ensemble Router selection. |
| **IPython host tools** | [`packages/agent-runtime/src/ipython-tool.ts`](../../packages/agent-runtime/src/ipython-tool.ts) | Read-only/authority-backed composition exists, but host-tool writes/effects and live acceptance are missing; production registry remains empty. |
| **authority / effect / evidence** | [`packages/authority/src/authority.ts`](../../packages/authority/src/authority.ts), [`packages/evidence/src/index.ts`](../../packages/evidence/src/index.ts) | Implemented as separate authorization, effect-gating, and evidence boundaries. These do not imply that a production host tool is registered. |
| **provider/account identity** | [`packages/contracts/src/index.ts`](../../packages/contracts/src/index.ts), [`apps/model-gateway/README.md`](../../apps/model-gateway/README.md) | Implemented in provider-qualified model, credential binding, and account-login contracts. |
| **Ensemble Router** | [`roadmap/act-1-foundation/active/2026-09-08-ensemble-router-routing-design.md`](../act-1-foundation/active/2026-09-08-ensemble-router-routing-design.md) | Canonical replacement for the retired pool label. Artifact schemas, durable overlay/Goal snapshots, and routing-evidence persistence are implemented; router selection and production routing are not. |
| **`model_map`** | [`packages/domain/src/model-map.ts`](../../packages/domain/src/model-map.ts), [`config/model_map.json`](../../config/model_map.json) | Implemented domain validator plus an empty, human-owned baseline. Runtime/provider observations must not write it. |
| **`TaskDemand`** | [`packages/domain/src/task-demand.ts`](../../packages/domain/src/task-demand.ts), [`packages/contracts/src/index.ts`](../../packages/contracts/src/index.ts) | Implemented domain and wire contract. It stores Head-declared D requirements and provenance; it does not select a model. |
| **`modelPolicy`** | [`packages/agent-runtime/src/agent-runtime.ts`](../../packages/agent-runtime/src/agent-runtime.ts) | Implemented as the exact native admission policy boundary (one provider-qualified identity). Ensemble Router migration is still missing. |
| **`MAESTRO_NATIVE_MODEL`** | [`apps/control-plane/src/config.ts`](../../apps/control-plane/src/config.ts), [`.env.example`](../../.env.example) | Implemented as an explicit provider-qualified fixed-model pin/routing-off input for current host-created paths. Fixed-model pin migration to Ensemble Router is still missing; it is not an implicit fallback. |

## Ensemble Router artifact status

Verified on the current main line represented by the routing-artifact persistence commits:

- **A — capability:** domain vector/validator with eight `0..200` axes and explicit `unproven` entries ([`model-profile.ts`](../../packages/domain/src/model-profile.ts)).
- **D — demand:** domain and wire `TaskDemand` contract with Head-declared levels and provenance ([`task-demand.ts`](../../packages/domain/src/task-demand.ts), [`contracts/src/index.ts`](../../packages/contracts/src/index.ts)).
- **E — work character/pressure inputs:** domain contract and continuous pressure calculation ([`work-character.ts`](../../packages/domain/src/work-character.ts)); pressure-band projection is separate.
- **B — provider facts:** domain and wire schema ([`provider-facts.ts`](../../packages/domain/src/provider-facts.ts), [`contracts/src/index.ts`](../../packages/contracts/src/index.ts)).
- **C — operational overlay:** domain and wire schema, pure per-Goal snapshot helper, and durable persistence ([`operational-overlay.ts`](../../packages/domain/src/operational-overlay.ts), [`contracts/src/index.ts`](../../packages/contracts/src/index.ts), [`ensemble-router-artifacts.ts`](../../packages/persistence/src/ensemble-router-artifacts.ts)).
- **Four pressure bands:** domain projection and wire schema ([`pressure-band.ts`](../../packages/domain/src/pressure-band.ts), [`contracts/src/index.ts`](../../packages/contracts/src/index.ts)).
- **Routing evidence:** domain/wire validation and append-only durable persistence ([`routing-evidence.ts`](../../packages/domain/src/routing-evidence.ts), [`ensemble-router-artifacts.ts`](../../packages/persistence/src/ensemble-router-artifacts.ts), [`0072_ensemble_router_artifacts.sql`](../../packages/persistence/migrations/0072_ensemble_router_artifacts.sql)).
- **Human-owned baseline:** domain validator and empty `config/model_map.json` ([`model-map.ts`](../../packages/domain/src/model-map.ts), [`model_map.json`](../../config/model_map.json)).

The following are intentionally **missing** and must not be documented as live: router selection; fixed-model pin migration; host-tool writes/effects; and live host-tool acceptance. Current native admission still uses an exact `modelPolicy` identity, and `MAESTRO_NATIVE_MODEL` remains an explicit fixed pin/routing-off input where required.
