# Act 1 Operational Build Plan

**Status:** in_progress — Phase 1 audit and operational gate reconciliation
**Started:** 2026-09-07

## Goal

Raise Maestro from a code-complete phase baseline to an operationally usable Act 1 system by closing Phase 1 through Phase 8 gates in order, one independently verifiable vertical slice at a time.

## Sources of truth

- `plan/phase1.md` through `plan/phase8.md`: phase requirements and exit gates.
- `plan/2026-09-07-maestro-native-agent-backend.md`: current native runtime/provider migration and Prime-removal boundary.
- `plan/2026-09-06-maestro-tui.md` and `plan/specs/2026-09-06-maestro-tui-design.md`: terminal operator surface.
- Root `task_plan.md`, `findings.md`, and `progress.md`: current evidence ledger. When historical status conflicts with the repository, trust the repository and record the reconciliation.

## Non-negotiable execution rules

1. Work Phase 1 before Phase 2, then Phase 3, through Phase 8. Do not claim a phase accepted from unit tests alone.
2. Each slice has a focused failing test, minimal implementation, focused verification, full check, required disposable-PostgreSQL and real-process evidence, independent review, and immediate documentation.
3. Never modify or discard unrelated in-flight worktrees. No remote push, deployment, credential change, or destructive cleanup without explicit authorization.
4. PostgreSQL is disposable and task-scoped. Provider and external effects remain bounded, observable, and fail closed.
5. Native conversation runtime and Model Gateway are current. Legacy Prime Worker execution remains until the native backend migration clears its own parity and no-Prime gates.

## Phase 1 execution sequence

### 0. Requirements and evidence audit — current

- [ ] Map every Phase 1 outcome, record, state rule, failure case, test, and exit-gate clause to exact implementation and test evidence.
- [ ] Run fresh no-database build/check and record pass/skip/failure counts.
- [ ] Run the Phase 1 persistence/API suites against a dedicated disposable PostgreSQL database.
- [ ] Run the real-process restart/reconciliation and public Prime parent/child gates where the environment allows.
- [ ] Classify each gap as resolved, environment-gated, missing implementation, or requiring a product decision.
- [ ] Update the root ledger with the resulting single next slice.

### 1. Close the first Phase 1 operational gap

- [ ] Choose only after the audit. Add a focused regression test first.
- [ ] Implement the smallest safe vertical slice.
- [ ] Verify in a clean worktree, obtain independent no-edit review, merge locally, remove the temporary worktree/container, and record evidence.

### 2. Phase 1 exit gate

- [ ] Real PostgreSQL control plane survives a killed active-Goal process and reconciles without duplicate transitions.
- [ ] App/CLI/TUI read the same durable state through the typed API.
- [ ] Stale lease/fencing writes are rejected with no durable mutation.
- [ ] Unauthorized critical action never reaches its effect adapter; exact approval executes once.
- [ ] Live Prime compatibility is either replaced by native parity or explicitly retained as a verified legacy bridge until the native migration gate is complete.
- [ ] Independent review and all required environment gates are recorded before Phase 1 is re-claimed.

## Later Act 1 phases

Phase 2–8 remain blocked behind the preceding phase exit gate. Their requirements are not redefined here; this file tracks execution order and evidence only. Any new requirement or architecture decision must be added to the relevant phase plan and root findings ledger before implementation.

## Current next action

Finish the Phase 1 evidence audit, then select exactly one missing or environment-gated blocker to close.
