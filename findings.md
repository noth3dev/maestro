# Plan 7 §S9 — CLI parity and recovery proof findings

## Investigation (2026-09-15)

- The requested `execution/plan-7.md` was absent from this new worktree because it is an uncommitted root-workspace planning file; it was inspected directly at `/home/ubuntu/projects/ms/execution/plan-7.md`, lines 311–365.
- The canonical historical findings/progress remain `roadmap/act-1-foundation/active/operations/{findings.md,progress.md,task_plan.md}`. No root `findings.md` existed before this slice.
- Current desktop client is `apps/carnegie`, not the plan's stale `apps/secretary` name. CLI entrypoint is `apps/cli/src/main.ts`; typed client is `packages/api-client/src/index.ts`; TUI read path is `apps/cli/src/tui/commands/read-commands.ts`; Carnegie bridge is `apps/carnegie/electron/apiBridge.ts`.
- Existing tests prove isolated pieces: CLI/API and Carnegie Goal/event parity (`apps/carnegie/src/cli-carnegie-parity.integration.test.ts`), event-stream reconnect (`apps/cli/src/tui/activity-stream.test.ts`, `apps/carnegie/src/useDurableEvents.test.ts`), session recovery summary (`apps/cli/src/tui/recovery.test.ts`), projection/radial identities (`apps/carnegie/src/views/panels/radial/radial-layout.test.ts`), and routing pressure/domain rules.

## S9 gaps exposed by RED specification

1. Carnegie has no composed scenario adapter that compares every UI action with its CLI equivalent and the same invalid-input error.
2. Carnegie persists connection credentials only; there is no durable close/reopen workspace session that restores an in-flight worker and pending approval together.
3. `GoalDepartmentPanels` renders Goal/departments/workers/authority/evidence/certification, but no composed Metronome, Encore, or Discord sections. Projection node kinds also do not include those record types.
4. Existing restart evidence covers control-plane/domain recovery, but there is no composed client identity-gate assertion after restart.
5. Pinned-model routing is enforced by exact native admission, while the UI has no projection/read model for a failed A↔D or B/C pressure escalation.
6. Routing-off and below-requirement markers have no durable projection/certification rendering contract.

No route, migration, production data, `testbed/` file, or mockup fixture is added by this slice. The RED tests below intentionally fail against these current gaps and define the smallest next implementation seams.
