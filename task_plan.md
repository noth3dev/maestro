# Maestro Phase 1–2 Execution Plan

## Goal
Complete the remaining Phase 1 durable control-plane safety foundations, then implement Phase 2 hierarchical execution for one local software Goal.

## Assumptions and boundaries
- Work remains in the existing isolated worktree `phase1/control-plane`.
- No remote push, deployment, external send, credential change, or deletion is authorized.
- Phase 1 and Phase 2 are implemented incrementally with test-first proof for each behavior.
- Planning sources read in full before execution: `plan1.md`, `plan/phase1.md`, `plan/phase2.md`.

## Success criteria
1. Phase 1 critical foundations have durable state, recovery-safe concurrency controls, and executable evidence.
2. Phase 2 supports a bounded local Goal from Task Contract through hierarchical Head/worker execution and Git integration.
3. Each slice has a focused failing test before implementation and full `npm run check` evidence after it.
4. Every design or implementation decision is recorded in `findings.md` and `progress.md`.

## Phases
- [complete] 1. Reconcile current code with Phase 1 requirements; define the smallest safe remaining vertical slice.
- [complete_with_environment_gate] 2. Implement and verify Phase 1 lease/fencing persistence and guarded state-changing writes.
- [in_progress] 3. Complete remaining Phase 1 command/recovery/evidence boundaries required by Phase 2.
- [pending] 4. Implement Phase 2 Task Contract and Secretary intake vertical slice.
- [pending] 5. Implement selective Head Council, Department Plans, and bounded Scout/Execution hierarchy.
- [pending] 6. Implement isolated Git branch/worktree flow and local Goal integration.
- [pending] 7. Run Phase 1–2 acceptance scenarios, document gaps, and report.

## Next step
Create the verified Phase 1 checkpoint commit, then branch isolated worktrees for evidence, recovery, and API client/CLI work.

## Errors encountered
| Error | Resolution |
|---|---|
| `rlm.find_models('luna max')` returned no catalog result | Use the inherited current execution model for subagents; user confirmed this is Luna. |

## Deferred architecture decision — multi-runtime adapter standardization

**Decision:** Do not implement Codex CLI, Hermes/Ollama, OpenRouter, or Local LLM hot-plug backends during Phase 1–2. Prime Agent remains the sole active execution kernel.

**Future direction:** Introduce a provider-neutral runtime-backend adapter layer only after one Prime-backed local Goal has completed Phase 1–2 execution and its authority, audit, cancellation, usage, and recovery evidence is proven. Candidate backends: Prime Agent, Codex CLI, Local Hermes/Ollama, and OpenRouter.

**Non-negotiable entry contract for every backend:**
- opaque invocation identity; no provider IDs/types beyond the adapter;
- mission-scoped capability/authority preflight through `AuthorizedEffectExecutor`;
- durable Goal/lease/fencing binding before any write-capable work;
- normalized prompt/message/observe/cancel/status/tool-event/usage contract;
- explicit unavailable/unknown behavior; no fabricated success or usage;
- durable audit/evidence, bounded cost/usage reporting, cancellation, and recovery semantics;
- independent compatibility, failure-injection, and security tests before hot-plug enablement.

**Reason for deferral:** Building provider routing now would create a second execution runtime beside Prime Agent before the control-plane safety boundaries are proven. That expands the authority, credential, audit, recovery, and test surface without enabling the current Phase 1–2 acceptance scenario.

**Revisit trigger:** After Phase 2 completes one local Goal to `awaiting certification` with Prime Agent and Phase 3 certification validates the integrated evidence.

## Commit checkpoint policy
- Create a local commit after each coherent vertical slice clears focused tests, full `npm run check`, required disposable-DB integration tests, and independent review.
- Use the resulting commit as the base for separate worktrees when remaining slices have isolated write ownership.
- Local commits remain noncritical; remote push/merge/release stays behind the existing CEO approval boundary.
