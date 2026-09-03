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
- [complete_with_environment_gate] 3. Complete remaining Phase 1 command/recovery/evidence boundaries required by Phase 2. Tag `phase1-accepted` at `541ce7d`.
- [in_progress] 4. Implement Phase 2 Task Contract and Secretary intake vertical slice. Organization/personas (`2e8e5a5`), Overture Task Contract (`c653760`/`c89042d`), Head activation (`b835564`/`ac65c8d`) done on branches, not yet merged to `main`.
- [complete] 5. Head Council sealed-submission slice (P2S5) accepted after independent review and real-PostgreSQL verification on `phase2/p2s5-integration` (7a627a2): 254 passed, 1 intentional skip, 0 failed. See "Phase 2 detailed status" below for accepted boundary. Department Plans (P2S6) and beyond not started; in_progress.
- [complete_pending_independent_review] 6. Full Phase 2 work-sequence (steps 6-12) implemented and self-audited on `phase2/p2s5-integration` (fc79c6c): 331 passed, 0 failed. A cross-cutting Council departmentOwnership authorization gap (Department Plan/budget/Git-branch creation) was found and fixed in this final self-audit. P2S5/P2S6 independently reviewed; P2S7-P2S12 self-reviewed only (subagent independent review unavailable throughout this session's back half). Proceeding to Phase 3 per user direction.
- [complete] 7. Phase 3 (plan/phase3.md) work-sequence steps 1-10 on `phase3/integration` (`699dee1`), real-PostgreSQL verified: 453 passed, 1 intentional live-Prime skip, 0 failed.
- [complete] 8. Phase 3 step 11 (complete live release scenario) fully closed: live Prime worker execution proven (`MAESTRO_LIVE_PRIME=1`), full unsupported-assertion Overwatch Council round proven, forced mid-flight restart/reconciliation proven, and Tests item 18 (CLI/app parity) proven with a real-PostgreSQL end-to-end fixture (`apps/control-plane/src/read-state-parity.integration.test.ts`) asserting the CLI and `@maestro/api-client` return identical Sentinel challenge, Overwatch Council round, certification, and Sane report state for the same real Goal through a live HTTP server. Final real-PostgreSQL `npm run check`: 459 passed, 2 skipped (live-Prime cases skipped by default, separately proven passing with `MAESTRO_LIVE_PRIME=1`), 0 failed. **Phase 3 exit gate: all 13 live-gate steps and all 18 Tests items evidenced.** Secretary UI has no dedicated panel for these four record kinds yet (Goal/event loaders only) -- a UI-layer follow-up, not a gap in the API/CLI parity claim itself.

## Next step
Run Phase 3 work-sequence step 11 (the complete live release scenario) when the PostgreSQL and live-Prime environment gates are available.

Current restart lane: forced mid-flight worker restart/reconciliation scenario is implemented on `phase3/p3s11-restart`; focused and full real-PostgreSQL checks pass pending parent merge. Verify the thirteen live-gate steps, replayable evidence bundle, and no critical findings before treating Phase 3 as exit-gate accepted. Do not begin Phase 4+ work.

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

## Naming decision (deferred, for Phase 2+)
- User confirmed: rename Initiator Crew to "Overture" when Phase 2 Initiator/intake work is implemented. Use "Overture" as the actual name at that time, not "Initiator Crew".
- "Vanguard" (rapid-response taskforce from plan/extra.md in the main workspace) is explicitly deferred to a later phase; do not implement it in Phase 1/2.


## Phase 2 detailed status (as of 2026-09-01, this session)

### Branch/commit map
- `main` (`22cacff`): docs only. Phase 2 code is NOT merged to `main` yet.
- `phase1/control-plane` (`c389967`, tag `phase1-accepted` at `541ce7d`): accepted Phase 1 baseline all Phase 2 work builds on.
- `phase2/overture-task-contract` (`c653760`) -> merged into `phase2/head-activation`'s ancestor `c89042d`: Task Contract editor, content identity, amendment, confirmation. Work-sequence step 3.
- `phase2/head-activation` (`b835564`) -> `phase2/head-activation-hardening` etc. all converge at `ac65c8d`: goal-scoped Head activation, duplicate/cycle prevention. Work-sequence step 4.
- `phase2/overture-organization`, `phase2/persona-baseline`: also at `ac65c8d`, no further unmerged commits found this session.
- `phase2/overture-role-refresh`: at `ac65c8d` with an uncommitted, uncomitted-but-inspected WIP diff (`packages/domain/src/task-contract.ts`/`.test.ts`, 2 files, +62/-9). It renames the placeholder Overture role IDs (`project-context-scout`, `requirements-analyst`) to the plan's actual canonical six-role pool (`conversation-lead`, `architecture-analyst`, `external-research-scout`, `security-evaluator`, `design-mock-specialist`, `task-editor` — see plan/phase2.md "Sane and Task Contract flow") and adds `canonicalizeOvertureRoles` for legacy-value migration. This is a real, in-scope fix, not stale/junk. Not yet committed or test-run this session.
- `phase2/sealed-submissions`: `ac65c8d` -> `59bc408` (**new, this session**) — sealed-submission snapshot primitive (`packages/domain/src/sealed-submission.ts`), 4/4 unit tests pass.
- `phase2/council-briefs`: `ac65c8d` -> merged `59bc408` -> `d86ba7f` (**new, this session**) — Head Council domain/persistence (independent briefs seal/reveal, deliberation rounds, stop-after-two-empty-rounds, decision packet with escalation-on-unresolved-conflict), now bound to a real frozen sealed-submission snapshot (`snapshot_hash` column, migration `0013_council_briefs.sql`) -> `f861c5b` (docs). This is work-sequence step 5.

### What is verified vs not
- Verified this session: `npm run build` and `npm test` green on `phase2/council-briefs` HEAD: **129 passed, 71 skipped** (skips are the DB-gated integration suites).
- NOT verified: real PostgreSQL integration tests (3 council tests + all other DB suites) — Docker is unavailable in this runtime (`docker: command not found`). This is an explicit environment gate, same as Phase 1's.
- NOT done: independent (no-edit) review of the sealed-submission/council slice. Per this project's own acceptance policy (see "Commit checkpoint policy" above), do not treat it as accepted until reviewed.
- `phase2/overture-role-refresh` worktree has an unreviewed, uncommitted working-tree edit to `task-contract.ts`/`task-contract.test.ts` from a prior stalled session — needs inspection before use.

### Work sequence remaining (plan/phase2.md "Work sequence", steps 6-12)
6. Department Plan schema, reconciliation, revisions, worker linkage — only after a resolved Council packet bound to the exact frozen contract/evidence snapshot is durable. **Now unblocked** by this session's snapshot-hash binding. **Not started.**
7. Mission bundles and least-privilege capability selection. **Not started.**
8. Scout and Execution worker lifecycles through Prime Agent native hierarchy. **Not started.**
9. Worker request-for-help and bounded team-lead exception. **Not started.**
10. Git repository, branch, worktree, commit, integration, diff, cleanup evidence. **Not started.**
11. Budget reservations and milestone forecasts. **Not started.**
12. Run a real local Goal through integrated change, stopping before final certification. **Not started.**

### Parallelization plan (dispatch target)
- Worktrees `.worktrees/phase2-*` already exist per work item; each Sonnet subagent should work in exactly one worktree/branch, test-first (TDD), run `npm run build && npm test` before reporting, and never claim "accepted" — only "self-verified, pending independent review."
- Steps 6-9 (Department Plans, mission bundles, worker lifecycle, request-for-help) are logically sequential per plan/phase2.md dependencies (each later step consumes durable state the prior step produces), so full step-level parallelism is NOT safe without careful interface staging. Recommended split for first parallel wave:
  - Agent A: Department Plan schema/persistence/domain validation (step 6) in a new `.worktrees/phase2-department-plans` worktree branched from `phase2/council-briefs` HEAD (`f861c5b`), since it directly consumes the Council decision packet.
  - Agent B: independent no-edit review of the sealed-submission/council slice already committed, so it can be marked accepted or sent back for repair.
  - Agent C: finish and verify the in-progress canonical Overture role rename in `phase2-overture-role-refresh` (`task-contract.ts`), run `npm run build && npm test`, then commit — this must land before Department Plans/mission bundles reference role IDs by name.
- Steps 7-12 should be dispatched only after step 6 lands and is independently reviewed, since mission bundles/workers/Git integration all read the Department Plan.


## User sequencing decision — 2026-09-01
- After Phase 2 reaches its actual exit gate (not merely self-verified code), proceed directly into Phase 3.
- Phase 3 start gate: all required Phase 2 slices independently reviewed and real-PostgreSQL verified; one bounded local Goal has durable Contract/Council/Plan/worker/Git/budget/evidence lineage and stops at the Phase 2 boundary (`awaiting certification` rather than a claimed success); no unresolved safety/authority/recovery blocker.
- Phase 3 scope then begins with Overwatch/Sentinel, independent certification, durable evidence bundle, and Sane final report. Do not begin Phase 3 implementation while Phase 2’s current Council/Head/Contract acceptance blockers remain open.

## Phase 3 closeout status — 2026-09-03
- Step 10 (adversarial fixtures) is complete at the code/test level on `phase3/integration`: tests cover fabricated evidence/unsupported claims, same-model fake consensus and disagreement, seeded Quality defects, forged evidence references, and unauthorized remote push capability.
- Closeout hardening is included: Sentinel challenge mutations require durable lease/role/session authorization; Prime production roots stay in the process repository context; certifications and reports bind to the exact launched Contract and immutable integrated revision; frozen revisions include accepted worker commits; and duplicate certification finding IDs are rejected at domain, waiver, and database boundaries.
- Verification gate: fresh `npm run check` reported 261 passed, 188 skipped, 0 failed. The skipped suites require PostgreSQL/Docker (unavailable here), so no real-PostgreSQL claim is made.
- Step 11, the full live release scenario, remains pending. Do not treat Phase 3 as fully exit-gate accepted until that scenario and the PostgreSQL environment gate pass.

## 2026-09-03 — P3S11 council unsupported-assertion round
- Added a real-PostgreSQL composition test that requests a semantic review of an unsupported natural-language claim, verifies the claimed-supported/no-evidence result is downgraded to `unsupported`, confirms the uncertainty trigger, and runs a complete Overwatch Council round.
- The round records each reviewer identity from `getModelIdentity`, labels the one-family fallback as `same-model-independent-review`, preserves minority dissent in synthesis, and proves sealed collection by checking zero persisted judgments during every reviewer prompt before all three are written.
- Focused verification passed: 7 passed, 0 skipped, 0 failed. Full `npm run check` is required before acceptance.


## Phase 3 step 11 split — CLI/app parity finding (2026-09-03)
- **Tests item 18 status: blocked by missing read surfaces.** Control-plane currently serves only Goal and event reads (`GET /v1/goals/:goalId`, `GET /v1/events`, and event SSE). CLI currently provides `goal get` and `events list`; Secretary loads and renders only Goal/events.
- No route, typed API-client method, CLI command, or Secretary loader exists for Sentinel challenges, Overwatch Council state, certification state, or Sane reports, although the durable domain/persistence modules exist. This branch records the evidence and does not invent a new aggregate endpoint.
- The minimal read contract is now implemented across control-plane, API client, and CLI. A real PostgreSQL app/API/CLI parity composition fixture remains to be added before claiming the item fully proven.

## 2026-09-03 — P3S11 CLI/app parity read contract implemented
- Added authenticated read-only control-plane routes for Sentinel challenges, Overwatch Council rounds (including judgments and synthesis), Quality/conditional certifications, and Sane final reports, backed by durable persistence reads. Added matching zod contracts, typed API-client methods, and CLI commands.
- Control-plane route tests prove all four shapes and missing-report handling. Secretary UI was not changed: it consumes the same API client but has no existing state-panel architecture for these four records; the control-plane is the app backing API.
- Verification: `MAESTRO_TEST_DATABASE_URL=...55440... npm run check` passed with **458 passed, 2 skipped, 0 failed** (74 test files passed, 1 skipped; skips are the intentional live-Prime cases).
- Tests item 18 is now covered at the shared read-contract level (control-plane/API client/CLI); a full real-domain parity fixture remains limited to existing persistence integration coverage.


## 2026-09-04 — Phase 4 P4S1 environment foundation
- [self_verified_pending_postgres] Implemented typed environment recipe/manifest and durable PostgreSQL environment lifecycle records in migration 0039. Identity is content-addressed from canonical recipe and resolved inputs; durable writes require current Goal lease plus actor/session context.
- Focused/domain tests and build pass. Full check: 267 passed, 194 skipped, 0 failed; integration tests require the assigned disposable PostgreSQL instance and were not run in this runtime.
## Phase 4 step 6 — Firefly foundation
- Implemented Firefly authenticated signal schema, freshness and replay rejection, independent append-only buffer, and PostgreSQL receiving primitive.
- Self-verification currently: build passed; focused Firefly tests **2 passed, 0 failed**. Real-Postgres integration remains pending.
- [in_progress] 9. Phase 4 Track B (plan/phase4.md work-sequence steps 6-9): P4S6 Firefly signal foundation is self-verified with real-PostgreSQL focused evidence pending independent review; steps 7-9 are next. Track A remains isolated in `.worktrees/p4-env`.
- [in_progress] 9. Phase 4 Track B (plan/phase4.md work-sequence steps 6-9): P4S6 hardening and P4S7 fingerprint/dedup/severity-confidence/silence slices are self-verified with real-PostgreSQL evidence, pending independent review; step 8 Incident Brief/triage/remediation composition is next. Track A remains isolated in `.worktrees/p4-env`.


## 2026-09-03 — Phase 4 integration merge landed
- [in_progress] 9. `phase4/integration` now carries environments (P4S1+P4S2), devices (P4S4), Firefly (P4S6+P4S7), and the shared migration-runner fix, merged and fresh-verified together: 532 passed, 2 intentional live-Prime skips, 0 failed, stable over 2 consecutive real-PostgreSQL runs. Migration numbering collision between environments/devices (0039-0041) and Firefly (previously 0039-0042) resolved by renumbering Firefly to 0042-0045.
- Next: P4S3 (browser environment adapter, Playwright), P4S5 (Goal-scoped device grants/command channel), P4S8-P4S9 (Firefly Incident Brief through closure and improvement evidence), P4S10 (live gates).


## 2026-09-03 (continued) — P4S3 and P4S5 integrated
- [in_progress] 9. `phase4/integration` now also carries P4S3 (Playwright browser environment adapter) and P4S5 (Goal-scoped device grants + sequenced capability-authenticated command channel). Full real-PostgreSQL check: 568 passed, 2 intentional live-Prime skips, 0 failed.
- Next: P4S8-P4S9 (Firefly Incident Brief through closure and improvement evidence), P4S10 (live gates).


## 2026-09-03 (continued) — P4S8 integrated
- [in_progress] 9. `phase4/integration` now also carries P4S8 (Firefly Incident Brief -> Goal linkage -> immediate safe pause -> remediation through the existing Phase 2/3 pipeline -> closure). Full real-PostgreSQL check: 577 passed, 2 intentional live-Prime skips, 0 failed, stable over 2 runs.
- Next: P4S9 (incident outcome/false-positive improvement evidence, no automatic changes), P4S10 (device-scope and seeded-incident live gates -- the Phase 4 exit gate).


## 2026-09-03 (continued) — P4S9 integrated
- [in_progress] 9. `phase4/integration` now also carries P4S9 (durable Firefly improvement evidence recorded on incident closure, no automatic changes). Full real-PostgreSQL check: 580 passed, 2 intentional live-Prime skips, 0 failed.
- Next: P4S10, the device-scope and seeded-incident live gates -- the Phase 4 exit gate itself.
