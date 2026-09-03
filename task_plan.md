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
- [pending] 7. Run Phase 1–2 acceptance scenarios, document gaps, and report.
- [in_progress] 9. Phase 4 (plan/phase4.md) preparation: baseline branch `phase4/integration` created from accepted Phase 3 exit gate (`1effc49`), worktree `.worktrees/p4` added, build verified clean. Recommended two-track work-sequence split recorded in progress.md (Track A: environments+devices, steps 1-5; Track B: Firefly, steps 6-9; step 10 integrates both). Playwright dependency not yet added (needed for step 3). Implementation not yet started.

## Next step
See "Phase 5 remediation plan — operational usability" below. Prior P1-P4 completion phase markers describe code/test status only and are not operational-acceptance claims; do not treat them as ready for normal use until Phase 5 tracks land.

## Next step (superseded — kept for history)
Phase 3 is fully exit-gate accepted (all 13 live-gate steps, all 18 Tests items). Main now carries the real Phase 2+3 source code (this merge). Next: decide whether to start Phase 4 Track A (environments/devices) and Track B (Firefly) implementation, e.g. via parallel subagents in `.worktrees/p4`-derived worktrees, matching the pattern used throughout Phase 3.

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



## Re-patch execution order (added 2026-09-04, after second hardening audit wave) — supersedes Track A/B ordering

The Track A/Track B split above groups fixes by subsystem. Actual execution instead walks the
phases in original order — Phase 1, then 2, then 3, then 4 — repairing everything below before any
phase is re-claimed as accepted, so each phase is fully hardened before the next is touched again.
Do not skip ahead to a later phase's items while an earlier phase still has an open item below.
This section is the current source of truth for "what remains broken"; Track A/B above stays as
the original grouping for reference but is no longer the execution order.

A second wave of four parallel read-only audits (security, concurrency/data-integrity, test
quality, and budget/evidence-bundle/certification domain correctness — `p1-3-security-audit2`,
`p1-3-concurrency-audit2`, `p1-3-testquality-audit2`, `p1-3-domain-audit2`) ran 2026-09-04 against
`main` and delivered the findings below, each grounded in exact file:line evidence. A fifth
audit (`p1-3-feature-completeness-audit`, real-world usability/missing-feature sweep) was
dispatched but its subagent aborted mid-run without delivering findings; it was not re-dispatched
this session. The Track A/B items already cover the largest known functional gaps (no
write-command API surface, no CLI/UI parity for Council/certification/report state, no CEO
approval completion path), so this is a partial, not total, blind spot — re-run a dedicated
feature-completeness audit before treating Phase 4 as usable.

### Phase 1 — remaining open items
1. **[MEDIUM, security]** `authenticateLocalOperator` (packages/persistence/src/auth.ts:140-176)
   runs an unfiltered SQL query (no WHERE clause) and scrypt-derives against every credential row
   on every login attempt, including pre-auth junk-bearer requests — a CPU-amplification DoS
   vector once multiple operators exist. Fix: accept an operator/credential identifier to narrow
   the query to O(1) rows before deriving, or rate-limit failed attempts per source.
2. **[LOW-MEDIUM, security]** Unbounded in-process memory growth: `execution-kernel.ts`'s
   `sessions`/`roots`/`children` Maps (lines 81-83) and `goal-service.ts`'s `leaseProofs` Map
   (line 42) never evict terminal-state entries. Fix: evict or bound (LRU) on terminal status once
   evidence is durably recorded.
3. **[LOW, security]** No TLS requirement when `MAESTRO_ALLOW_REMOTE=true` (apps/control-plane/src/config.ts:20,45-46);
   bearer secrets would travel in cleartext on a non-loopback bind. Fix: fail closed on remote bind
   without TLS configured.
4. **[P0-adjacent, concurrency/infra]** No production-safe migration runner exists anywhere in the
   codebase. The only runner (`packages/persistence/src/test-migrations.ts` `applyAllMigrations`)
   unconditionally `DROP SCHEMA ... CASCADE`s before applying all 47 migrations, has no
   `schema_migrations` ledger, and takes no advisory lock; it is called exclusively from
   `*.integration.test.ts` files. There is currently no supported way to create or evolve a real
   production database. Fix: add a real migration runner with a checksum/applied-at ledger under a
   single `pg_advisory_lock`, additive-only, wired into control-plane startup before
   `reconcileOnStartup`.
5. **[HIGH, test quality]** fast-check property testing is almost entirely absent despite being a
   locked-stack requirement (plan/phase1.md) and two explicit Phase 1 Tests items (#2, #3). Only
   one file (`packages/persistence/src/fencing.property.test.ts`) uses fast-check at all, and it
   only covers `commands.ts`. See Phase 2/3 items below for the 10 modules with zero stale/forged
   fencing coverage.
6. **[LOW-MEDIUM, test quality]** Evidence-hash corruption (Phase 1 Tests #9) is proven only at
   `getEvidenceMetadata` (packages/persistence/src/evidence.integration.test.ts:32), never at any
   of the actual "certification consumers" the spec names (certification, evidence-bundle, Sane
   report). Fix: add one corrupted-hash regression test per real consumer.
7. **[LOW, test quality]** No test asserts `parseConfig`'s accepted key set excludes
   provider-credential-shaped env vars (Phase 1 Tests #12 has no dedicated coverage; the only
   related test checks DB-credential log redaction, a different property).
8. Already-known Phase 1-rooted P0s from the first audit wave (see "Phase 5 remediation plan" /
   Track A above, items 1 and 4): no durable worker/session restart recovery
   (`execution-kernel.ts` `resume()`/`reconnect()` always throw; `reconciliation.ts` does no real
   session reconciliation); no project-scoped operator authorization (authentication only, no
   membership/role/capability check in `server.ts`/`goal-service.ts`).

### Phase 2 — remaining open items
1. **[P0, domain correctness — empirically reproduced]** Budget reservations silently double-count
   across envelope revisions. `reserveGoalBudget`/`reserveDepartmentBudget`/`reserveMissionBudget`
   (packages/persistence/src/budget-reservation.ts:63-68,104-109,146-151) are strictly append-only;
   each child-level overrun check sums only rows under the single newest parent row
   (`ORDER BY created_at DESC LIMIT 1`), so reservations against a superseded envelope become
   invisible and enforcement never re-aggregates. Verified against real PostgreSQL: reserving the
   same 100,000-cent Goal ceiling twice (a routine, CEO-approval-free "same amount" action) let a
   Department allocate 160,000 cents against it — 78% over budget — with zero rejection.
   `sane-report.ts:193-194`'s `costCents` sums *all* historical reservations (a different, wider
   scope than enforcement uses), so reporting and enforcement are inconsistent. Fix: track a
   durable "current envelope" identity so overrun checks always sum all live reservations for the
   Goal/Department, not just the newest envelope's children; add a regression test that
   re-reserves at the goal level and proves the department cap still holds.
2. **[HIGH, test quality]** Mission Assignment Bundle capability scoping (skills/tools/paths/
   authority boundary) never reaches the real Prime Agent spawn call.
   `packages/domain/src/execution-kernel.ts`'s `SpawnRequest` (lines 13-18) has no field for it;
   `worker.ts:104` drops `allowedSkills`/`allowedTools`/`allowedPaths`/`authorityBoundary` when
   calling `kernel.spawn`. "Scout workers are read-only by default" (plan/phase2.md) is currently
   unenforced anywhere; Phase 2 Tests #12/#13 have no code path to test. Fix: extend the
   execution-kernel port to carry mission-bundle capability scoping through to the real spawn/tool
   surface (or wrap every worker action in an authority check keyed off the mission bundle), then
   add a real spawn + out-of-scope-tool-call test that fails closed.
3. **[MEDIUM, test quality]** Team-lead grant cost/duration/scope ceilings
   (packages/persistence/src/team-lead-grant.ts:37-39,63-64,120-123) are stored but never enforced
   at `spawnHelperWorker` time — only `max_helpers` is checked (Phase 2 Tests #10 is ~25% covered).
   Fix: enforce cost/duration/scope at spawn time; add the three missing ceiling-exceeded tests.
4. **[MEDIUM, test quality]** Mission persona overlay (plan/phase2.md "Ten-axis persona baseline")
   has zero implementation — `mission-bundle.ts` only carries an opaque `profileRef: string`; no
   derivation or mission-lifetime expiry exists to test (Phase 2 Tests #11's "expire correctly"
   half is untestable as-is). Fix: implement a durable mission-persona-overlay derivation bound to
   mission lifetime with explicit expiry, then test [0,1] bounds and post-mission unavailability.
5. **[HIGH, concurrency — empirically reproduced]** Head activation/sleep/resume
   (packages/persistence/src/head-participation.ts) checks fencing (`assertCurrentGoalLease`,
   line 322) but never checks the pause/stop/emergency-stop control latch — zero references to
   `goal_controls`/`assertGoalControlOpen`/`paused_at`/`emergency_stopped_at` in the file. Verified
   against real PostgreSQL: `activateHeadParticipation` succeeded and durably created a new
   participation row on a Goal with `emergency_stopped_at` already set. Fix: call the existing
   `assertGoalControlOpen` inside head-participation.ts's lease-check helper before creating or
   transitioning a participation row.
6. **[LOW/MEDIUM, concurrency]** `acceptDepartmentWorkerOutput`
   (packages/persistence/src/certification.ts:38) is an unguarded check-then-insert race, saved
   only by a DB unique constraint whose violation surfaces as a raw Postgres error instead of this
   codebase's usual idempotent-return pattern. Fix: `INSERT ... ON CONFLICT (worker_id) DO NOTHING
   RETURNING ...`, re-read on conflict.
7. **[HIGH, security]** No path/repository containment check before Git worktree/branch
   operations. `recordGoalIntegrationBranch`/`recordDepartmentBranch`/`recordWorkerWorktree`
   (packages/persistence/src/git-integration.ts:26,134,170) and `createWorktree`/`createBranch`
   (packages/git-adapter/src/git-ops.ts:20-27) accept caller-supplied paths with no containment
   check against an allow-listed workspace root; `git worktree add` will materialize a checkout at
   any writable absolute path (no shell injection since `spawn` uses argv arrays, but no path
   containment either). Fix: canonicalize and assert `repositoryPath`/`worktreePath` fall under a
   configured single workspace root (e.g. `MAESTRO_WORKTREE_ROOT`) at the persistence boundary.
8. **[9-10 uncovered fencing modules, test quality — part of item 5 above]** Of 13 persistence
   modules independently implementing the `FOR UPDATE ... fencing_token = $3` pattern, these have
   zero stale/forged-lease test coverage: `budget-reservation.ts`, `council.ts`,
   `department-plan.ts`, `device-grant.ts` (only a not-found case, not stale-token),
   `mission-bundle.ts`, `team-lead-grant.ts` (Phase 2), plus `environment.ts`, `firefly-incident.ts`
   (Phase 4) and `git-integration.ts`, `sentinel-challenge.ts` (spans Phase 2/3). Add at least one
   stale/forged-fencing-token test per module while its phase is being re-patched.
9. Already-known Phase 2-rooted P0 from the first audit wave: effect adapters (Git) not enforced
   through `AuthorizedEffectExecutor`; no production write-command API surface for Task
   Contract/Council/Plan/worker/Git actions.

### Phase 3 — remaining open items
1. **[P0, concurrency]** `certification.ts`, `evidence-bundle.ts`, `sane-report.ts`, and
   `overwatch-council.ts` have **zero** goal_lease/fencing check and **zero** control-latch
   (pause/stop/emergency-stop) check — unlike every other Phase 2/3 write module. Unguarded entry
   points: `certifyQuality`/`certifyConditional`/`grantCertificationWaiver`/
   `adjudicateCertificationConflict` (certification.ts:280,295,330), `assembleEvidenceBundle`/
   `recordEvidenceBundle` (evidence-bundle.ts:13,205), `generateSaneFinalReport`
   (sane-report.ts:35), `runOverwatchCouncilReview` (overwatch-council.ts:106, which spawns real
   Prime Agent subagents and incurs real cost). A stale/fenced-out actor can therefore certify, run
   a full Council round, assemble an evidence bundle, or produce a Sane final report on a
   paused/emergency-stopped Goal. Fix: thread a `GoalLeaseProof`/authorized-actor context through
   all five entry points; lock the lease row FOR UPDATE and call `assertGoalControlOpen` before any
   write; add a fencing/pause-bypass regression test per module.
2. **[MEDIUM/HIGH, concurrency]** `assembleEvidenceBundle` and `generateSaneFinalReport` each issue
   10-15+ sequential, non-transactional reads across ~10 tables — unlike `certification.ts`'s own
   `readCertificationLineage` (line 141), which correctly opens one transaction with FOR SHARE/FOR
   UPDATE locks. A concurrent write during assembly can produce an internally inconsistent
   bundle/report that still hashes and commits successfully. Fix: wrap each assembly in one
   transaction with FOR SHARE locks (matching `readCertificationLineage`), or `REPEATABLE READ`.
3. **[MEDIUM, concurrency]** `generateSaneFinalReport` has no idempotency or per-Goal uniqueness
   constraint (`sane_final_reports`, migration 0036, has no unique constraint on `goal_id`).
   Concurrent/retried calls for the same Goal can produce two divergent "final" reports. Fix: add a
   unique constraint/idempotency key scoping one final report per Goal.
4. **[P1, domain correctness]** Evidence bundle assembly never queries `authority_records`/
   `authority_decisions` (the durable grant/approval/deny audit trail), `independent_briefs` (the
   actual sealed Council brief content — only aggregate `head_councils` fields are read), or
   `goal_head_participations`/`head_activation_attempts`/`head_activation_edges` ("activated
   organization and reasons"). This breaks Tests item 17 ("replay the bundle to reconstruct the
   final decision") since the brief content that produced the Council decision is absent.
   Separately, `generateSaneFinalReport` calls `recordEvidenceBundle` *before* inserting the
   `sane_final_reports` row, so the bundle can structurally never contain the report content
   plan/phase3.md's bundle-contents list also names. Fix: extend `assembleEvidenceBundle`'s queries
   to include all three omitted sources; document or add a second post-report bundle snapshot.
5. **[P1, domain correctness]** `evaluateCertificationCompleteness`
   (packages/domain/src/sane-report.ts:62-111) never compares cost to budget and never checks
   `budget_reservations` at all — there is no budget-related blocker reason in
   `CertificationCompletenessBlockerReason`. A Goal that has blown its budget (see Phase 2 item 1)
   can still report `success: true`. Separately, the reported `costCents` is a sum of *reservations*
   (a planning artifact, itself double-counted per Phase 2 item 1), not actual incurred spend — no
   `actual_cost`/spend accumulation exists anywhere in the codebase. Fix: add a budget-exceeded
   blocker computed from corrected reservation accounting, plus a real actual-cost accumulation
   distinct from reservations.
6. **[HIGH, security]** The four new read-state routes (`GET /v1/goals/:goalId/{sentinel-challenges,
   overwatch-council-rounds,certifications,sane-report}`, apps/control-plane/src/server.ts:149-152)
   take only `goalId` — unlike `GET /v1/goals/:goalId`, which requires and checks `projectId`. The
   wire contract itself has no `projectId` field to enforce against, so any authenticated operator
   can read another project's Sentinel challenges, Council deliberation, certifications, and Sane
   report by iterating/guessing goal UUIDs (a concrete IDOR). Fix: add `projectId` to all four
   routes/schemas and the matching `ReadStateService` methods, matching `getGoal`'s pattern.
7. Already-known Phase 3-rooted P0s from the first audit wave: no production write-command API
   surface for Sentinel/Council/certification/report actions; Sentinel is a one-shot callable, not
   a continuous scheduled/event-driven loop, and its rule set omits several plan-required finding
   types; App/CLI/UI parity is read-contract-only, no forms/write surface, no dedicated Secretary
   panels for these four record kinds.

### Phase 4 — remaining open items
Unchanged from Track B above (enrolled-device audit, 2026-09-04): no real device-agent transport
or mutual authentication; local validation doesn't cover Goal/grant/expiry/fencing; no authenticated
command dispatch or signed device receipts; device revocation doesn't cascade to issued grants;
applications/data-scope/network-scope are declarative only, unenforced; no disconnect/dependent-work
pause lifecycle; Sentinel has no device-access observation; grant expiry/closure has no durable
automatic state transition. See Track B items 1-8 above for full detail — not re-numbered here to
avoid duplicate item IDs.

### Feature-completeness (real-world usability) sweep — completed directly 2026-09-04
The dispatched subagent aborted mid-run with no findings (see above); the parent session completed
this sweep directly by reading `apps/cli/src/main.ts`, `apps/secretary/src/goal-page.tsx`,
`apps/control-plane/src/server.ts`, `apps/firefly/src/main.ts`, and plan/phase2.md's Sane/Task
Contract flow. This is additional to (not a duplicate of) the known "no write-command API surface"
P0 items already listed per-phase above; it grounds two of those gaps in their single sharpest
concrete illustration each, plus two smaller cross-cutting gaps not previously called out.

1. **[Phase 2, illustrates known P0]** "Sane" (the intake persona meant to turn a plain-language
   CEO request into a draft Goal + Task Contract, per plan/phase2.md line 5/36) exists in code only
   as a display-name string (`packages/domain/src/organization.ts:166`). The actual Task Contract
   lifecycle functions (`createDurableTaskContract`, `selectAndRecordOvertureRoles`,
   `recordExactTaskContractConfirmation`, `launchConfirmedTaskContract`, all in
   `packages/persistence/src/task-contract.ts`) have no CLI command and no HTTP route calling them
   — `apps/cli/src/main.ts` only has `goal create --project-id` (a bare Goal, no Task Contract
   substance field exists in `CreateGoalInputSchema` at all) and `apps/control-plane/src/server.ts`
   has no `/task-contracts` route. There is currently no way, through any user-facing surface, for
   a CEO to actually start a Goal with a plain-language outcome.
2. **[Phase 4, illustrates known Firefly notification gap]** `apps/firefly/src/main.ts:89`'s
   `main()` wires Firefly's own delivery transport to a stub that immediately throws `"No delivery
   transport configured"` — there is no default delivery implementation at all, and no Discord/
   desktop emergency-notification channel exists anywhere in the codebase despite plan/phase4.md
   #46 explicitly promising "one pre-approved out-of-band emergency channel ... a dedicated Discord
   emergency channel or enrolled-device desktop notification" for exactly the case (main control
   plane unavailable) Firefly exists to handle.
3. **[Medium, cross-cutting, new]** No "list/browse Goals" capability exists anywhere. Confirmed
   `apps/control-plane/src/server.ts` has only `GET /v1/goals/:goalId` (requires already knowing
   the UUID), never a bare `GET /v1/goals` listing route; the CLI and Secretary UI inherit the same
   limit. An operator with no memorized Goal UUID has no way to discover what Goals exist.
4. **[Medium, cross-cutting, new]** No cost/budget-at-a-glance surface anywhere for a human: no CLI
   command, no route, and no Secretary panel surfaces `budget_reservations` data, even though (per
   the Phase 2/3 domain-correctness findings above) that data already has real accounting-integrity
   problems worth seeing before they compound.
5. Confirms with direct evidence (no new finding, closes the open question): Secretary
   (`apps/secretary/src/goal-page.tsx`) is a single, config-fixed-`goalId`, fully read-only page —
   zero forms, zero navigation between Goals, zero Council/certification/Sane-report panels. The
   CLI (`apps/cli/src/main.ts`) totals 2 write commands (`goal create`, `goal transition`) and 5
   read commands (`goal get`, 3x `*.list`, `sane-report get`, `events list`) — no command exists for
   Task Contract, Council brief submission, Department Plan, Mission Bundle, worker spawn, Git
   actions, critical-action approval, device enrollment/grants, environment creation, or any
   Firefly incident action.

### Status
- [not_started] Phase 1 remaining items 1-8 above.
- [not_started] Phase 2 remaining items 1-9 above (feature-completeness item 1 above illustrates
  item 9's write-API gap concretely; fix together).
- [not_started] Phase 3 remaining items 1-7 above.
- [not_started] Phase 4 remaining items (= Track B items 1-8, unchanged; feature-completeness item 2
  above is a Firefly-specific instance to fix alongside Track B).
- [not_started] Feature-completeness items 3-4 above (Goal listing, budget-at-a-glance) — new,
  cross-cutting, not yet assigned to a specific phase item; fold into the write-API-surface work
  whichever phase implements it first (most naturally Phase 3's read/write API extension).

## Phase 5 remediation plan — operational usability (added 2026-09-04, supersedes prior "complete/complete_pending_independent_review" claims for P1-P4 runtime lanes)

### Why this phase exists
Two independent read-only audits (P1-P3 usability audit, P4 enrolled-device audit) found that green `npm run check` evidence across Phases 1-4 proves durable domain/persistence component behavior, not a runnable system a normal user/operator/device could actually use end-to-end. Phase 1-4 "complete" markers above describe code-level and test-level status only. This phase closes the specific evidenced runtime gaps before any of that work is treated as operationally accepted or merged as a usable product.

### Track A — P1-P3 control-plane runtime lanes (blocking, P0 unless noted)
1. **Durable worker/session recovery.** `packages/prime-adapter/src/execution-kernel.ts` session/invocation state is process-local only; `resume()`/`reconnect()` always throw. `packages/persistence/src/reconciliation.ts` explicitly does no session reconciliation. Required: durable session/invocation binding table, a real `reconcileOnStartup` that loads worker/session bindings, fences or cancels stale provider work, and persists the recovery decision with evidence. Test: kill-and-restart a real running control-plane process with an active worker; prove no duplicate/stale execution.
2. **Authority enforcement at real effect adapters.** `apps/control-plane/src/main.ts` wires `AuthorizedEffectExecutor` to a no-op; `packages/git-adapter/src/git-ops.ts` exports direct unauthenticated `spawn('git', ...)` calls with no grant/lease/audit path. Required: compose every effect adapter (Git first) through `AuthorizedEffectExecutor`; no direct adapter call site bypasses it. Test: forged/expired/out-of-scope authority attempt against the real Git adapter is rejected before any `git` process spawns.
3. **Production orchestration path.** `apps/control-plane/src/main.ts`/`server.ts` only expose Goal create/transition/critical-action and reads; no route exists to confirm/amend a Task Contract, activate Heads, submit/reveal Council briefs, create Department Plans/Mission Bundles, spawn/observe/cancel workers, run Sentinel/Council/Quality, approve/revoke authority, or request a final report. Required: expose the minimal write-command surface for one full Goal lifecycle through the actual HTTP API (not direct persistence calls in a test). Test: drive one real Goal from Task Contract through Sane final report using only the HTTP API + CLI, no direct persistence-layer calls.
4. **Project-scoped operator authorization.** `server.ts` authenticates but never checks project membership/role/capability; `goal-service.ts` forwards any authenticated operator to any supplied project/Goal ID. Required: add project/role/capability authorization checks on every route, not just authentication. Test: an authenticated operator without project membership is rejected reading/writing another project's Goal.
5. **User-facing CEO approval/critical-action completion.** No endpoint/CLI/UI records a required approval and reruns the concrete effect; `CreateGoalInputSchema` has no outcome/Task-Contract/confirmation fields. Required: add the minimal approve-and-rerun command path end-to-end (API + CLI at least). Test: a critical action that requires approval is approved through a real user-facing command and then actually executes the effect exactly once.
6. **Continuous Sentinel observation (P1, not blocking exit but required before "usable").** `scanGoalForSentinelFindings` is a one-shot callable with no scheduler/consumer composed in `main.ts`, and its rule set omits unsupported-claims/circular-discussion/activation-cycle/scope-budget-authority-divergence/unreviewed-integration findings from the plan. Required: compose a real scheduled/event-driven Sentinel loop and complete its rule set. Test: a seeded violation is caught by the running loop without being manually invoked.
7. **App/CLI/UI operational parity (P1).** Secretary is read-only single-Goal view with no forms/SSE and no challenge/Council/certification/report display; CLI covers only Goal/event read+create+transition. Required: extend both to the write/read surface from item 3, matching this project's own "same state through app and CLI" requirement, not just a shared read contract.

### Track B — P4 enrolled-device runtime lanes (blocking, P0 unless noted)
1. **Real device-agent transport and mutual authentication.** No TLS/mTLS listener, certificate/key proof, or authenticated device session exists; `device.ts` explicitly defers this. Required: implement a real device-agent process with TLS/mTLS (or an equivalent standard authenticated-TLS design) and proof-of-possession. Test: a separately running device-agent process (not in-process construction) completes an authenticated round trip.
2. **Local validation must cover Goal, grant, expiry, and fencing token, not just device/policy/action/target.** `LocalDeviceActionRequest` and `evaluateLocalDevicePolicy` do not carry or check Goal ID, grant reference, grant expiry, or fencing sequence. Required: deliver a signed grant envelope to the agent; the agent verifies device binding, Goal, scope, expiry/revocation freshness, and monotonic fencing locally before OS execution. Test: negative case per field (stale Goal, expired grant, reused/lower fencing sequence) rejected locally, not just server-side.
3. **Authenticated command dispatch and signed device receipts.** Only a results table exists; no command/outbox/session table, no device signature on submitted results, no argv/command-payload record. Required: persist immutable command envelopes before dispatch and require signed device receipts (device identity, grant/Goal, sequence, action parameters, outcome) verified on receipt. Test: forged and replayed command/result rejected.
4. **Device revocation must cascade to already-issued grants.** `revokeDevice` does not touch `device_grants`; `recordDeviceCommandResult` never checks `devices.state`. Required: atomically revoke/expire active grants on device revoke and/or check enrolled device state on every dispatch/receipt. Test: grant issued -> device revoked -> next in-scope command result rejected.
5. **Enforce applications/data-scope/network-scope, not just action/path.** Declared in schema and domain type but never checked at execution/receipt time. Required: model typed command targets (application/browser target, data resource, network destination) and validate each against scope both locally and server-side. Test: escape attempts on each of the three unenforced scope dimensions are rejected.
6. **Disconnect/dependent-work pause lifecycle.** No device session/heartbeat/disconnect state exists. Required: track authenticated device session/heartbeat and work-to-device dependency; pause only dependent work on disconnect. Test: independent work continues; dependent work pauses.
7. **Sentinel device-access observation (P1).** Sentinel never reads device/grant/result state. Required: add deterministic device-grant/audit finding rules (expired grant use, unexpected target, unexpected side effect) with safe-pause coverage.
8. **Durable automatic grant expiry/closure (P1).** Expiry/terminal-Goal currently only rejects at submit time; `device_grants.state` never transitions to `expired`/`closed`. Required: transition state atomically on the lifecycle event (Goal closure, revocation, expiry) and test the durable state change plus immediate local rejection.

### Sequencing decision
- Do Track B item 1-2 first (device-agent transport + full local validation) because it is the immediate, currently mis-claimed P4S10 gap; do not widen the existing S10 test's claim without this work.
- Track A items 1-3 are prerequisite-independent of Track B and may run in a parallel isolated worktree.
- Do not attempt Track A item 6/7 (Sentinel loop, app/CLI parity) or Track B items 6-8 until each track's P0 items above land and are independently reviewed, since they build on the corrected authorization/session primitives.
- No phase in this remediation plan may be marked `complete` on self-review alone; each requires independent (no-edit) review plus real-PostgreSQL (and, where applicable, real-process/real-device-agent) verification per this project's existing acceptance policy.

### Status
- [not_started] Track A (P1-P3 control-plane runtime lanes), items 1-7.
- [not_started] Track B (P4 enrolled-device runtime lanes), items 1-8.
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


## 2026-09-03 (continued) — P4S10 integrated; Phase 4 work-sequence complete at code level
- [complete_pending_independent_review] 9. Phase 4 (plan/phase4.md) work-sequence steps 1-10 are implemented and integrated on `phase4/integration`, with real-PostgreSQL verification stable over repeated runs (582 passed, 2 intentional live-Prime skips, 0 failed). The exit gate (device/local-policy narrow-grant task plus Firefly outage/recovery/dedupe/isolated-remediation) is evidenced by two composition tests. Self-reviewed only; independent (no-edit) review of the full Phase 4 surface is the recommended next step, and merge to `main` remains behind that review per this project's existing acceptance policy.
- Branches merged into `phase4/integration`: `fix/shared-migration-runner`, `phase4/p4s1-environments` (S1+S2), `phase4/p4s4-devices` (S4), `phase4/p4s6-firefly` (S6+S7), `phase4/p4s5-device-grants` (S3+S5), `phase4/p4s8-incident-workflow` (S8), `phase4/p4s9-improvement-evidence` (S9), `phase4/p4s10-live-gate` (S10).
