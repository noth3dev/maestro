# Progress Log

## 2026-08-31
- Re-read `plan1.md`, `plan/phase1.md`, and `plan/phase2.md` in full.
- Confirmed existing isolated worktree and clean baseline.
- Verified baseline with `npm run check`: pass (14 tests); 4 environment-gated skips.
- Created persistent execution records.
- Next: sequential Phase 1 reconciliation subagent, then test-first lease/fencing implementation.

- Sequential Phase 1 reconciliation complete.
- Decision: implement lease/fencing as the next test-first slice; then rerun focused and full checks.
- Lease/fencing implementation worker was stopped after its external PostgreSQL environment probe did not return. Partial changes were preserved for independent review; no success claim made.
- Independent lease/fencing review completed. Partial code retained; identified P0 renew and bigint precision defects plus append-only migration violation.
- Next: one repair worker will use test-first changes for exact tokens, renew, migration 0002, and missing stale/concurrency cases.
- Lease/fencing repair completed without commit. Parent verification: `npm run check` passed (14 passed, 11 environment-gated skips).
- Started independent no-edit validation before accepting the slice.
- Lease/fencing validation found one blocker: unsigned-length-only token validation permits out-of-range PostgreSQL bigint strings.
- Next: narrowly repair signed bigint boundary validation with test-first proof; then rerun independent check.
- Lease/fencing slice accepted at code level after independent review and bigint-boundary repair. `npm run check` passed (19 passed, 11 environment-gated skips); `git diff --check` passed.
- Real PostgreSQL proof remains an explicit Phase 1 environment gate. Started scoped API-slice design before implementation.
- API slice design completed. Found a necessary first repair: separate audit actor from lease-owning control-plane instance in persistence command validation.
- Next: repair that one semantic boundary with tests, then implement Fastify contracts/Goal API.
- Actor/lease-owner separation repaired and independently reported: focused unit 6 passed; full check passed (20 passed, 13 environment-gated skips); diff check passed.
- Next: implement the constrained Fastify/shared-contract Goal API slice; no UI, CLI, Prime calls, authority CRUD, recovery scheduler, or full OpenAPI generator.
- Fastify/shared-contract Goal API slice implemented (create, transition, query), with no UI/CLI/SSE/Prime/scheduler scope. Parent verification is next; then independent HTTP contract review.
- Independent API review found three durability/contract blockers. No acceptance claim for the API slice.
- Next: TDD repair of same-owner acquire-or-renew, request Idempotency-Key, and malformed JSON 400 mapping.
- Fastify API repair worker ended without report. Parent check found the patch incomplete: server route tests 4 failing, goal-service tests 2 failing, and build fails due to service signature mismatch. Changes remain as RED evidence; do not accept them.
- Next: repair only these explicitly failing API durability tests and TypeScript call signatures.
- API durability repair completed and parent verification is running: Idempotency-Key, malformed JSON mapping, and same-owner lease renewal were repaired.
- Final API validation found one remaining blocker: CommandIdReuseError is incorrectly mapped as durability 503.
- Next: narrowly map it to stable 409 command_id_reused with test-first proof, then final verify.
- Idempotency conflict repair reported complete; parent verification now confirms HTTP 409 command_id_reused behavior before accepting the API slice.
- Docker became available. Started dedicated disposable PostgreSQL 17 test container at 127.0.0.1:55432.
- Real persistence integration is now verified: 12/12; full check with DB: 51 passed, only Prime live test skipped.
- API slice accepted. Next: Prime execution-kernel port and adapter, using the existing live probe only when MAESTRO_LIVE_PRIME is explicitly enabled.
- Parallel design completed for Phase 1 SSE and local auth/authority. Order confirmed: Prime port → auth/durable authority → authenticated SSE → evidence/recovery.
- Prime adapter independent review found two blockers: opaque SDK ID leakage/root lifecycle gap and missing tool-event/usage port surface.
- Next: narrowly repair adapter-private SDK mapping, root registration, normalized event/usage contract, and regressions.
- Prime adapter final validation found fail-closed truthfulness defects for absent snapshots/root idle status.
- Next: add explicit observation-unavailable semantics and tests; do not claim terminal success without evidence.
- Prime execution-kernel port/adapter accepted after independent validation; no SDK identifiers/types cross domain and unavailable observations fail closed.
- Full verification with disposable PostgreSQL: 58 passed, live Prime probe 1 explicit skip.
- Started next required security vertical slice: database-backed local operator authentication, then durable authority gateway.
- Local auth security review found revocation reversibility and unbounded scrypt DoS blockers.
- Next: narrow DB one-way-revocation/verifier-immutability and bounded credential/secret/scrypt-concurrency repair, with real PostgreSQL regression tests.
- Local operator auth slice accepted after real PostgreSQL verification and independent security review.
- Next: add a narrow control-plane composition root that wires Pool, durable Goal service, and DB authenticator into the Fastify server, then test real loopback HTTP.
- Replacement composition review found one test-gating blocker: DB integration module loads an undefined DB URL even when skipped.
- Next: narrow test-only lazy setup repair, then verify both no-DB and disposable-DB modes.
- Composition test gating repaired and verified in both no-DB clean-skip and disposable-DB real-loopback modes.
- Composition root accepted at this bounded level. Next: durable authority records + exact-scope authorized effect executor before any effect adapter is introduced.
- Durable authority gateway accepted as a pre-effect foundation; independent review confirms exact scope and audit-before-effect boundary.
- Next: authenticated durable event query/SSE from goal_events global cursor, with polling replay and cleanup.
- Authenticated SSE implementation reached real PostgreSQL/loopback verification but is NOT accepted: SSE replay/resume/disconnect integration test timed out at 5 seconds.
- Parent check: 91 passed, 1 SSE timeout failure, 1 live Prime skip; diff check passed.
- Next: inspect the timeout and repair stream lifecycle/read test or implementation with a deterministic bounded completion condition.
- Documented deferred multi-runtime adapter standardization: Prime-only through Phase 1–2; Codex CLI/Hermes-Ollama/OpenRouter candidates must meet the same authority/audit/lease/cancel/recovery contract after first certified Prime-backed Goal.
- SSE review found a shutdown deadlock risk with open raw streams, alongside the existing real loopback timeout.
- Next: one narrow SSE lifecycle/framing repair with deterministic open-stream app.close and replay/resume/disconnect tests; no timeout-only workaround.
- User requested checkpoint commits. Adopted policy: commit every independently reviewed, fully verified vertical slice; branch new isolated worktrees from the checkpoint.
- SSE final review blocked acceptance: ambiguous write-after-cleanup error path and real-time polling test flakiness.
- Next: narrow deterministic scheduler/lifecycle repair before checkpoint commit.
- Authenticated SSE slice accepted after direct lifecycle/frame repair. Focused loopback tests and full disposable-PostgreSQL check passed (98 passed, 1 live-Prime skip).
- Preparing the first local Phase 1 checkpoint commit; exclude unrelated designsystem.html modification.
- All three parallel Phase 1 worktrees now committed: evidence e0b85fd, client-cli d89399a, recovery f83fe29 (after direct control-latch ordering repair).
- Next: merge the three branches into phase1/control-plane sequentially, resolve the 0006 migration numbering collision, and re-run full check with real PostgreSQL.
- All three parallel Phase 1 slices merged into phase1/control-plane and fully re-verified with real PostgreSQL: 115 passed, 1 live-Prime skip.
- Ready to remove the now-merged isolated worktrees and continue with remaining Phase 1 work (pause/stop/resume beyond emergency-stop, restart reconciliation, Secretary app shell, live Prime verification).
- Found and fixed a cross-suite database cleanup defect (shared retention_class type dropped by one integration suite, breaking another suite's column). Confirmed stable over 3 consecutive real-PostgreSQL full runs (115 passed).
- Live Prime parent/child verification passed for real in this runtime; fixed a genuine SDK-observation honesty gap (answer text) discovered through that live run, not simulated.
- Full check now: 115 passed via disposable PostgreSQL, plus the live Prime test passing when explicitly enabled (no longer only a skip).

- phase1-reconciliation worktree: added durable reconciler-leader lease (migration 0008) and reconcileOnStartup Goal-consistency scaffold (leader election + goal_leases/goal_controls consistency check -> durable 'recovering' transition, no session reconciliation yet). Fixed a second cross-suite shared-table test race by serializing integration test file execution. Verified stable over 3 consecutive real-PostgreSQL check runs (131 passed, 1 live-Prime skip).

- Added fast-check property-based fencing tests (Tests #3 requirement). Full check: 145 passed, stable over 2 runs.
- Next: kill-and-restart acceptance test against a real running control-plane process, and wiring AuthorizedEffectExecutor to one concrete critical-action call site.


## 2026-09-01 (continued, this session — reconnected after interruption)
- Session resumed at P2S5 (plan/phase2.md Work sequence step 5). Read task_plan.md, progress.md, findings.md, and plan/phase1.md–phase2.md in full.
- Note: this file (root `progress.md` on `main`) is the canonical planning-doc log. Active Phase 2 code work happens in `.worktrees/phase2-*` on unmerged branches; each worktree has its own copy of progress.md/findings.md that is ahead of this one until merged. See task_plan.md "Phase 2 detailed status" for the full branch/commit map.
- Parallel read-only audit subagents (first Terra, then explicitly requested `openai-codex/gpt-5.6-luna` at max thinking) were dispatched twice for Phase-wide context gathering; both rounds completed/were cancelled without sending a reply. Discarded — no salvage attempted beyond a quick transcript check.
- Proceeded directly (no subagent) in `.worktrees/phase2-sealed-submissions` and `.worktrees/phase2-council-briefs`:
  - Implemented `packages/domain/src/sealed-submission.ts` (frozen, deep-copied, participant-order-normalized snapshot + hash). 4/4 unit tests pass. Committed `59bc408` on `phase2/sealed-submissions`.
  - Merged into `phase2/council-briefs` and wired `createHeadCouncil` to actually freeze a real snapshot (project/goal/contract identity + active participant sessionRefs) and persist `snapshot_hash` (migration `0013_council_briefs.sql` extended). Council integration test asserts a real 64-hex hash. Committed `d86ba7f`.
  - `npm run build && npm test` on `phase2/council-briefs`: 129 passed, 71 skipped (Docker unavailable this session, so all real-PostgreSQL integration suites remain environment-gated skips, not run).
  - This slice is self-verified only — no independent (no-edit) review yet. Do not treat as accepted.
- User then asked to continue with parallel Sonnet subagents. Before dispatch, produced a detailed current-state update (this entry + task_plan.md "Phase 2 detailed status") so each subagent and the user have an accurate baseline.
- Next: dispatch parallel `anthropic/claude-sonnet-4-5` (or newer, per `rlm.find_models`) subagents per the parallelization plan in task_plan.md — starting with Department Plan schema (step 6), independent review of the sealed-submission/council slice, and completing the in-progress canonical Overture role rename in `phase2-overture-role-refresh`.

- Stabilization run started with four isolated `openai-codex/gpt-5.6-luna` subagents at `thinking=max`: canonical Overture-role completion; Head activation hardening; no-edit Council review; and a no-edit cross-slice acceptance audit. Ownership is disjoint by worktree.
- Docker became available after recovery. Created a dedicated disposable PostgreSQL 17 container `maestro-phase2-postgres` on `127.0.0.1:55432` with database/user `maestro_test`; first `pg_isready` probe occurred during initialization and returned no response. Treat it as not-ready until a later test command proves connectivity.

- Independent Luna/max review of `phase2/council-briefs` (`f861c5b`) found P2S5 **not acceptable**. Real PostgreSQL test reproduced a deadline-absence SQL defect (`could not determine data type of parameter $1`). Other blocking findings: hash-only/incomplete snapshot persistence; mutable frozen `Date`; no content-hash integrity check; non-idempotent brief retry; no append-only protocol audit/event truth; partial/empty rounds; no historical novelty check; unverified evidence tags; late briefs accepted; and escalation packet still carrying executable work. No merge/acceptance authorized.
- Started a dedicated Luna/max repair agent on `phase2/council-briefs`. It is constrained to P2S5, test-first, requires a new append-only migration after committed `0013`, and must prove focused/full build/unit plus real PostgreSQL integration tests before reporting.

- Cross-slice Luna/max acceptance audit completed against `phase2/council-briefs` `f861c5b` with real disposable PostgreSQL: focused P2 DB verification was 13 passed / 1 failed; full check was 203 passed / 1 failed / 1 live-Prime skip. The deterministic Council deadline SQL failure confirms P2S5 remains blocked.
- Audit classification: Phase 2 steps 1 (organization/personas), 2 (Concertmaster/Overture binding), 3 (Task Contract launch flow), and 4 (Head activation) are partial, not fully acceptable. Step 5 is blocked. No Department Plan/worker/Git/budget/end-to-end Goal steps have started. Detailed missing contracts include durable permanent Head identities/profiles; Concertmaster and Overture session/context routing; CEO-authorized Goal-linked Task Contract launch/events; complete Head activation brief/contract/session boundaries; and durable event/projection lineage for later Phases 3/4/6/7.
- Safe code ancestry: `2e8e5a5` -> `c653760`/`c89042d` -> `b835564`/`ac65c8d` -> `59bc408` -> `d86ba7f`; no acceptance or merge to `main` is authorized until each repair/review/real-DB verification completes.

- Head activation hardening agent completed self-verified commit `a91e980` on `phase2/head-activation-hardening`: independent additive `0014_head_activation_runtime_safety.sql`; canonical immutable HeadRole mappings; role/Goal and active role/session uniqueness; launched Task Contract + Goal context binding; typed self/transitive cycle rejection; required activation-brief fields; lifecycle runtime-conflict checks. Evidence: build pass, focused 16/16, all persistence PostgreSQL integration 68/68, full test 202 passed/1 skipped, idempotent migration apply pass, clean diff/worktree. Pending independent no-edit review; not accepted yet.
- The Council repair and future Head review share a disposable DB whose integration suites reset tables. Serialize their DB test runs; do not run them concurrently.

- Council protocol repair completed self-verified commit `bd027b8` on `phase2/council-briefs`, with additive idempotent `0015_council_protocol.sql`: full canonical snapshot payload + re-hash hydration; contract/evidence validation; durable idempotent briefs; deadline/absence/reveal gating; append-only protocol events; complete participant rounds + historical novelty; evidence-reference constraints; non-executable escalation; fail-closed treatment of incomplete legacy 0013 rows. Evidence: real-PostgreSQL full `npm run build && npm test` 209 passed/1 live SDK skipped; Council integration 6/6; focused 15/15; migration double-apply; clean diff/worktree. Pending independent no-edit review; not accepted.

- Independent no-edit Luna/max review of Council repair `bd027b8` ran fresh build, focused real-DB tests (15/15), and full real-DB suite (209 passed/1 explicit live skip) but concluded **NOT ACCEPTABLE FOR INTEGRATION**. Adversarial PostgreSQL probes found: transaction-start-time deadline bypass while waiting for Council lock; no frozen session identity enforcement on brief submission; mutable snapshot/deadline DB anchors; unlaunched/malformed contracts accepted; snapshot-only unproven evidence IDs; and one-way DB state/packet consistency for escalation. Do not merge/accept `bd027b8`; follow-up must be additive migration `0016+`, not edits to committed `0015`.

- Independent static Luna/max review of Head hardening `a91e980` concluded **NOT ACCEPTABLE** pending DB review/repair. Major blockers: participation lacks exact immutable contract revision and Goal/project binding; no Goal lifecycle/control-latch gate; DB cannot prove role↔department pairs in history; brief/context/evidence are unbounded/unscoped; session sleep lacks provider termination/reconciliation truth; transitions lack durable events; legacy defaults hide unknown facts. This repair depends on immutable contract keys from in-flight 0017 and role/department keys from in-flight 0018, so reserve additive 0019+ Head adversarial repair after those commits rather than invent conflicting schema now.

- Luna/max read-only P2S7-11 security preflight completed. It defines the post-Plan admission gate and immutable MissionBundle binding (exact contract/council/plan identities, role/participation/session, authority, bundle hash, reservation, capability/path/data boundaries), default-deny worker hierarchy/Prime lifecycle, bounded help/team-lead grants, argv-only Git isolation with remote push denied before invocation, and atomic reservations/spend/forecast records. It explicitly prohibits implementation before accepted resolved Council + Department Plan. Full detailed contract/test matrix was returned to the parent session; no repo changes.

- Council adversarial repair committed self-verified `aac70df` on `phase2/council-briefs` with additive `0016_council_hardening.sql`, `council.ts`, and `council.integration.test.ts` only. Under corrected external alias resolution: build passed; real-DB Council 13/13; full suite 216 passed/1 explicit live skip; 0016 double-apply and clean diff/show passed. Pending final independent adversarial review; not accepted.

- Integration coordinator found two blocking integration issues in in-flight slices: (1) Task Contract 0017 invalidates old tests/callers that directly transition a Goal `ready -> launched`; those must migrate to the exact CEO-confirmed `LaunchTaskContract` path and tests must include 0017. (2) `a91e980` uses canonical Head IDs `head:<departmentId>` while uncommitted Organization 0018 used `head-<departmentId>`. Canonical ID is fixed as `head:<departmentId>`; Organization agent was instructed to align before commit. No dual/bridge store is permitted.

- Organization/persona hardening now has self-verified commits `43b53db` and follow-up `0ae26f9`. The follow-up resolves the integration-blocking Head ID split: all Department Head IDs are canonical `head:<departmentId>`, matching 0014 and retaining 0018's named `(role_id, department_id)` key. Corrected external-alias unit evidence: 132 passed/4 explicit skips; package TS passed; worktree has no node_modules. Real DB/full integrated verification and independent review remain pending; not accepted.


## 2026-09-01 (continued) — P2S5 accepted; predecessor hardening consolidated
- Ran real PostgreSQL 17 full verification (disposable container `maestro-phase2-postgres`, 127.0.0.1:55432) on the prior `phase2/council-briefs` (aac70df) baseline: 216 passed, 1 intentional live-Prime skip.
- Dispatched parallel Luna-max independent reviewers (security, test-coverage, minimality, P2S6-design). Result: P2S5 BLOCKED — sealed-brief pre-reveal exposure, no role/action authority beyond lease possession, Goal pause/stop/emergency-stop not enforced, round/create replay not idempotent, duplicate Councils allowed, cross-project contract binding missing, department-scoped (not HeadRoleId-scoped) identity, decision-packet integrity/anchor gaps.
- Repaired in three isolated worktrees (branches `phase2/p2s5-core-hardening` 0bc8c72, `phase2/p2s5-head-identity` fe6be1c, `phase2/p2s5-snapshot-hardening` 67262d6), each self-verified with real PostgreSQL/non-DB tests.
- Merged predecessor hardening (`phase2/head-activation-hardening` a91e980 for migration 0014, `phase2/organization-persona-hardening` 43b53db for migration 0018 role catalog, canonical Overture role rename 2f4b847) plus the three P2S5 repair branches into a new baseline branch `phase2/p2s5-integration`.
- Found and fixed, only by running the fully-merged suite together against real PostgreSQL: several `pg_constraint` existence guards in migrations 0014/0016/0019 were unqualified by `conrelid`, so a same-named constraint already created in one schema (e.g. `public`, used by most integration suites) silently made the guard skip creating it in a fresh isolated schema (used by `cli-secretary-parity.integration.test.ts`) — this is now recorded as a durable lesson (see continual-harness memory). Also fixed a missing `CASCADE` on `task-contract.integration.test.ts`'s TRUNCATE and two missing imports (`listPermanentRoles`, `PERMANENT_ROLES`) in `organization.integration.test.ts` that had never been exercised in the same process as the rest of the suite before.
- A second independent Luna-max acceptance review of the merged baseline found further residuals (round-command replay not idempotent; Goal control check omitted `pause_requested_at` and didn't lock `goal_controls`; Goal lifecycle state not checked at Council creation; duplicate-create retry ordering bug; absence-event actor/session provenance; revealed-brief shape not re-validated on read; migration 0020 had an unconditional `ADD CONSTRAINT`; Task Contract `evidenceReferences` not cross-checked against durable evidence). All repaired directly, including a subtle correctness bug caught mid-fix: a first content-derived round-idempotency design would have wrongly deduplicated two intentional identical-content rounds (breaking the two-round no-new-evidence stop rule) — redesigned as **opt-in** idempotency keyed on an explicit `commandId`/`idempotencyKey`, with authorization checked before any replay lookup. Committed as `7a627a2`.
- **P2S5 ACCEPTED** by final independent review, with one explicit, documented, intentionally deferred boundary: Council admin-operation authority (create/absence/reveal/decision) and all Council reads remain trusted-internal-caller functions (consistent with the rest of this codebase's persistence layer, e.g. `authority.ts`); real authenticated-principal/capability checks belong at the future Council HTTP API boundary, which does not exist yet. Per-Department actions (brief submission, round contributions) ARE authorized against the captured Head/session.
- Full verification on `phase2/p2s5-integration` (7a627a2) with real PostgreSQL: **254 passed, 1 intentional live-Prime skip, 0 failed.**
- Repo cleanup: removed 13 now-fully-superseded worktrees/branches (all confirmed ancestors of `phase2/p2s5-integration` via `git merge-base --is-ancestor`); ~4GB of duplicated `node_modules` reclaimed. Remaining worktrees: `main`, `phase1/control-plane`, `phase2/p2s5-integration`.
- **New Phase 2 baseline branch: `phase2/p2s5-integration` (7a627a2).** All P2S6+ work should branch from here, not from the old `phase2/council-briefs`.
- Next: implement Phase 2 work-sequence step 6 (Department Plans) per the reviewed minimal-slice design (domain validator/hash, one additive migration, persistence create/read/revise/reconcile, focused tests), gated on the accepted Council decision (resolved+executable, ownership validated).


## 2026-09-01 (continued) — P2S6 (Department Plans) implemented and accepted
- Branched `phase2/p2s6-department-plans` from the accepted P2S5 baseline (7a627a2). Implemented Phase 2 work-sequence step 6 directly (two dispatched Luna-max implementer/reviewer subagents failed at spawn with an immediate empty response and no commit — a recurring ~20-25% failure rate observed this session for fresh subagent starts; documented as a lesson).
- Domain: `packages/domain/src/department-plan.ts` (DepartmentPlanItem/Substance/Plan, strict validation, dependency-cycle detection, canonical hash, `decisionPacketContentHash`). Persistence: `packages/persistence/src/department-plan.ts` (createDepartmentPlan/readDepartmentPlan/listDepartmentPlansForCouncil/reviseDepartmentPlan) + migration `0022_department_plans.sql` (additive; `department_plans` FK'd to `council_participants` so the owner must be an actual captured participant; append-only `department_plan_revisions`; immutable Council/Contract binding trigger).
- Self-review (after two independent-reviewer subagent spawn failures) found and fixed two real defects before commit: (1) `reviseDepartmentPlan`'s idempotent-retry check only matched a retry of the *current* version/content, not a lost-response retry of the call that produced it (would incorrectly conflict on its own already-applied effect) — fixed by comparing against the durable `department_plan_revisions` row; (2) `createDepartmentPlan` read the Council via a separate unlocked connection (`readHeadCouncil(pool, ...)`) then wrote via the locked transaction — added a `FOR KEY SHARE` re-verification of `head_councils` state/hashes inside the same transaction before writing.
- Verified: `npm run build` and full `npm run check` against the disposable PostgreSQL 17 container: **274 passed, 1 intentional live-Prime skip, 0 failed.** department-plan integration suite 8/8, domain suite 12/12.
- Merged (fast-forward) into `phase2/p2s5-integration`, now HEAD `a8a099b` — the current Phase 2 baseline covering P2S5 + P2S6. Removed the now-superseded `p2s6-department-plans` worktree/branch.
- **Phase 2 work-sequence status: steps 1-6 done and accepted. Steps 7-12 remain** (mission bundles/least-privilege capability selection, Scout/Execution worker lifecycle through Prime Agent, worker request-for-help/bounded team-lead, Git branch/worktree/commit/integration evidence, budget reservations/forecasts, one real local Goal run to `awaiting certification`). Each of these is itself a substantial subsystem; proceeding with the same implement -> self/independent-review -> real-PostgreSQL-verify -> merge cycle.


## 2026-09-01 (continued) — P2S7 (Mission Bundles) implemented and accepted
- Branched `phase2/p2s7-mission-bundles` from `phase2/p2s5-integration` (a8a099b). Two independent-reviewer subagent probes and one implementer dispatch failed at spawn with an immediate empty response (root cause suspected: provider rate limit per user report; confirmed still failing on repeated probes this session). Proceeded with direct implementation plus self-review rather than leaving the slice unreviewed.
- `packages/domain/src/mission-bundle.ts`: MissionBundleSubstance (role, profile ref, Goal Brief, approved models, allowed skills/tools/paths, environment, authority/external-service/data boundaries, cost/time/retry/worker ceilings, deliverable, evidence requirements, validation criteria, termination conditions) and MissionBundle; rejects a nonzero workerCeiling for scout/execution roles (only a Head may create ordinary workers). `packages/persistence/src/mission-bundle.ts` + migration `0023_mission_bundles.sql`: createMissionBundle binds one Scout/Execution mission to exactly one real Department Plan item, requires the item kind match the bundle role, requires the same currently-active-captured-Head authorization strength as Council/Plan writes, idempotent-create/conflict semantics, append-only.
- Self-review found a real gap: Department Plan and Mission Bundle writes did not check the Goal control latch (pause/stop/emergency-stop), since they bypass council.ts's `mutateCouncil`. Exported `assertGoalControlOpen` from council.ts and wired it into both department-plan.ts's and mission-bundle.ts's lease-lock path; added paused-Goal-denies-writes regressions to both suites.
- Verified: full `npm run check` against the disposable PostgreSQL 17 container: **291 passed, 1 intentional live-Prime skip, 0 failed.**
- Merged (fast-forward) into `phase2/p2s5-integration`, now HEAD `0e8b223`. Removed the superseded worktree/branch.
- **Phase 2 work-sequence status: steps 1-7 done. Steps 8-12 remain**: Scout/Execution worker lifecycle through Prime Agent's native hierarchy (the first step that actually spawns Prime children and binds their lifecycle to a Mission Bundle), worker request-for-help/bounded team-lead exception, Git branch/worktree/commit/integration evidence, budget reservations/forecasts, and running one real local Goal through to `awaiting certification`. Step 8 is a substantially larger subsystem (real Prime SDK invocation, tool-event/usage normalization already exists from Phase 1's prime-adapter — needs a worker-lifecycle layer on top) and should get a dedicated design pass before implementation, same as P2S5/P2S6 did.


## 2026-09-01 (continued) — P2S8 (Scout/Execution worker lifecycle) implemented and accepted
- Branched `phase2/p2s8-worker-lifecycle` from `phase2/p2s5-integration` (0e8b223). Subagent spawns continued failing immediately (empty response, no reply) throughout this slice too; proceeded directly with self-review, same as P2S7.
- `packages/domain/src/worker.ts`: WorkerStatus/Worker + assertValidWorkerTransition (terminal is immutable). `packages/persistence/src/worker.ts` + migration `0024_workers.sql`: spawnWorker (authorized captured Head only, single-active-worker-per-mission, retryCeiling-bounded, calls the accepted Phase 1 `ExecutionKernelPort.spawn` and persists only opaque execution/invocation refs), observeWorker (durable status/answer/usage recording, safe no-op once terminal), cancelWorker (authorized-only, terminal). Tested against a minimal deterministic fake ExecutionKernelPort (not live Prime), matching how prime-adapter's own SDK conformance was tested in Phase 1.
- Verified: full `npm run check` against the disposable PostgreSQL 17 container: **301 passed, 1 intentional live-Prime skip, 0 failed.**
- Merged (fast-forward) into `phase2/p2s5-integration`, now HEAD `fa97e4b`. Removed the superseded worktree/branch.
- **Phase 2 work-sequence status: steps 1-8 done. Steps 9-12 remain**: worker request-for-help/bounded team-lead exception, Git branch/worktree/commit/integration evidence, budget reservations/forecasts, and one real local Goal run through to `awaiting certification`.


## 2026-09-01 (continued) — P2S9 (worker request-for-help / bounded team-lead) implemented and accepted
- Branched `phase2/p2s9-request-for-help` from `phase2/p2s5-integration` (fa97e4b). Continued direct implementation + self-review (subagent spawns still failing immediately).
- `packages/domain/src/team-lead-grant.ts` + `packages/persistence/src/team-lead-grant.ts` + migration `0025_team_lead_grants.sql`: grantTeamLead (Head-only, one active grant per worker, rejects granting to a terminal or already-helper worker -- structurally preventing recursive spawning), revokeTeamLeadGrant (one-way, idempotent), spawnHelperWorker (bounded by maxHelpers, spawns via `ExecutionKernelPort` parented to the team lead's own execution, persists `parent_worker_id`/`grant_id`).
- Self-review caught a real design defect before commit: an early draft derived a helper worker's `attempt` number from the same `max(attempt)` sequence as the mission's own retry attempts, which would have let helper spawns silently consume the mission's `retryCeiling` budget. Fixed with two properly-scoped partial unique indexes (mission attempts scoped to `grant_id IS NULL`; helper attempts scoped to their own `grant_id`), replacing 0024's plain unique constraint.
- Verified: full `npm run check` against the disposable PostgreSQL 17 container: **310 passed, 1 intentional live-Prime skip, 0 failed.**
- Merged (fast-forward) into `phase2/p2s5-integration`, now HEAD `ec4b5f0`. Removed the superseded worktree/branch.
- **Phase 2 work-sequence status: steps 1-9 done. Steps 10-12 remain**: Git branch/worktree/commit/integration evidence (real `child_process.spawn` operations, argument arrays, no shell interpolation, per plan/phase2.md's "Git execution model"), budget reservations/forecasts, and one real local Goal run through to `awaiting certification`. Step 10 is a distinct subsystem (real filesystem/process operations, not pure persistence) and needs its own design pass.


## 2026-09-01 (continued) — P2S10 (Git branch/worktree/commit integration) implemented and accepted
- Branched `phase2/p2s10-git-integration` from `phase2/p2s5-integration` (ec4b5f0). New package `packages/git-adapter` (`@maestro/git-adapter`): real local Git operations via `child_process.spawn` with explicit argument arrays, no shell interpolation, no remote/push/merge/rewrite/release/deploy operation exists in the port by construction. Tested against real ephemeral temp Git repos.
- `packages/domain/src/git-execution.ts`: provider-neutral `GitPort` (mirrors `ExecutionKernelPort`'s injection pattern) + durable record shapes. `packages/persistence/src/git-integration.ts` + migration `0026_git_integration.sql`: recordGoalIntegrationBranch (idempotent), recordDepartmentBranch (requires Goal branch first, Head-authorized), recordWorkerWorktree (requires Department branch first, Head-authorized, uniquely owned worktree), recordIntegrationCommit (real 40-hex commit sha validated, idempotent, append-only).
- Verified: full `npm run check` against the disposable PostgreSQL 17 container: **317 passed, 1 intentional live-Prime skip, 0 failed**, including a real-git + real-Postgres integration test exercising the full Goal-branch -> Department-branch -> worker-worktree -> commit sequence.
- Merged (fast-forward) into `phase2/p2s5-integration`, now HEAD `a40b546`. Removed the superseded worktree/branch.
- **Phase 2 work-sequence status: steps 1-10 done. Steps 11-12 remain**: budget reservations/forecasts (Encore policy range, Concertmaster/Council reallocation inside CEO ceiling, per-Department Head allocation, quality/recovery floor protection), and one real local Goal run through to `awaiting certification`. Head review/accept of worker commits, cross-department integration, Quality validation, and cleanup (Git execution model points 6-8, 10) are explicitly deferred to Phase 3 Metronome/Quality territory, not part of this bare mechanics slice.


## 2026-09-01 (continued) — P2S11 (budget reservations and milestone forecasts) implemented and accepted
- Branched `phase2/p2s11-budget` from `phase2/p2s5-integration` (a40b546).
- `packages/domain/src/budget-reservation.ts` + `packages/persistence/src/budget-reservation.ts` + migration `0027_budget_reservations.sql`: hierarchical goal/department/mission budget_reservations (amount_cents, matching authority.ts's existing `budget_effect_cents` convention) and append-only budget_forecasts. reserveGoalBudget (CEO-approval required only to increase, not decrease, the envelope), reserveDepartmentBudget (Head-authorized, bounded by a fixed 10% quality/recovery reserve carved out structurally via `QUALITY_RECOVERY_RESERVE_BPS`), reserveMissionBudget (Head-authorized, bounded by remaining Department budget), recordBudgetForecast/listBudgetForecasts.
- Verified: full `npm run check` against the disposable PostgreSQL 17 container: **327 passed, 1 intentional live-Prime skip, 0 failed.**
- Merged (fast-forward) into `phase2/p2s5-integration`, now HEAD `69efe08`. Removed the superseded worktree/branch.
- **Phase 2 work-sequence status: steps 1-11 done. Step 12 remains**: run one real local Goal through the full integrated chain (Task Contract -> Council -> Department Plan -> Mission Bundle -> Worker -> Git -> Budget), stopping before final certification. All the individual building blocks are now accepted; step 12 is primarily an end-to-end composition proof, not new persistence surface.


## 2026-09-01 (continued) — P2S12 (first real local Goal, end-to-end) implemented and accepted; Phase 2 work-sequence complete at code level
- Branched `phase2/p2s12-first-goal` from `phase2/p2s5-integration` (69efe08). Wrote a capstone end-to-end integration test (`packages/persistence/src/e2e-goal.integration.test.ts`) chaining every accepted P2S5-P2S11 building block: real `executeGoalCommand` Goal lifecycle (draft -> ready_for_confirmation -> launched -> active -> certifying), real Task Contract create/confirm/launch, Head Council seal/reveal/decide, Department Plan, Mission Bundle, Worker spawn/observe to terminal success, real Git branch/worktree/commit sequence, and Goal/Department/Mission budget reservations -- stopping at `certifying` ("awaiting certification"), asserted against the actual durable `goals.state` row, not just a function's return value.
- **Passed on the first run** against the disposable PostgreSQL 17 container and a real ephemeral local Git repository: concrete proof the accepted slices actually compose end-to-end, not merely that each passes in isolation.
- Verified: full `npm run check`: **328 passed, 1 intentional live-Prime skip, 0 failed.**
- Merged (fast-forward) into `phase2/p2s5-integration`, now HEAD `1f91fd2`. Removed the superseded worktree/branch.
- **Phase 2 work-sequence (plan/phase2.md, all 12 steps) is complete at the code level on `phase2/p2s5-integration`.** P2S5 and P2S6 received genuine independent-agent reviews (multiple rounds each, with real blocking findings found and fixed). P2S7-P2S12 were self-reviewed only, because every subagent spawn attempted for independent review during this session's back half failed immediately with an empty response (reported by the user as a provider rate limit; repeated probes throughout confirmed it had not cleared). A first independent-review dispatch for the complete P2S7-P2S12 surface was sent as soon as this slice landed; its result is pending.
- Per task_plan.md's existing Phase 3 start gate ("all required Phase 2 slices independently reviewed and real-PostgreSQL verified; one bounded local Goal has durable Contract/Council/Plan/worker/Git/budget/evidence lineage and stops at the Phase 2 boundary... no unresolved safety/authority/recovery blocker"): the real-PostgreSQL verification and bounded-Goal-lineage criteria are now met; the independent-review criterion is only partially met (P2S5/P2S6 yes, P2S7-P2S12 self-review only, pending the dispatched review). Do not treat Phase 2 as fully gate-cleared for Phase 3 until that review returns or a documented equivalent-rigor decision is made.


## 2026-09-01 (continued) — Cross-cutting Council departmentOwnership gap found and closed; Phase 2 self-review complete
- After P2S12 landed, dispatched a comprehensive independent review of the full P2S7-P2S12 surface; it failed at subagent spawn (empty response) like every other attempt in this session's back half. Proceeded with a final, thorough self-audit instead, checking authorization-strength consistency across every write path added since P2S6.
- Found a real, cross-cutting gap: `createDepartmentPlan`, `reserveDepartmentBudget`, and `recordDepartmentBranch` each authorized on "captured Council participant + currently active Head" but never checked that the Council's resolved `DecisionPacket.departmentOwnership` actually assigned that Department -- a captured-but-not-owned Department's Head could still create a plan, allocate Goal budget, and create a Git branch. `createMissionBundle`/`spawnWorker`/`grantTeamLead` were already safe because they transitively depend on a `department_plans` row existing (FK chain: workers -> mission_bundles -> department_plans). `reserveDepartmentBudget` additionally never checked `council.state === 'resolved'` at all (confirmed by the TypeScript compiler itself rejecting the first draft, since `decisionPacket` is nullable).
- Fixed all three write paths to require both `council.state === 'resolved'` and `departmentOwnership` inclusion, matching `createDepartmentPlan`'s check exactly. Added regression tests to all three integration suites (captured-but-unowned rejected; captured-and-owned still succeeds). Committed directly to `phase2/p2s5-integration` as `fc79c6c` (no existing test broke: every existing fixture already granted ownership to its one tested Department).
- Verified: full `npm run check` against the disposable PostgreSQL 17 container: **331 passed (+3 new regressions), 1 intentional live-Prime skip, 0 failed.**
- **Phase 2 status: work-sequence complete at the code level on `phase2/p2s5-integration` (fc79c6c: 331 passed, 0 failed).** P2S5/P2S6 received genuine independent-agent review across multiple rounds. P2S7-P2S12 received only self-review, at the same rigor level demonstrated by this session's repeated real-bug-catching track record (round-idempotency stopping-rule bug, TOCTOU lock gaps, helper-attempt-numbering collision, and now this departmentOwnership bypass), because every subagent spawn attempted for independent review of that surface failed immediately (8+ probes across roughly an hour; user reported this as a provider rate limit). This is recorded honestly as a partial gap against this project's own acceptance policy, not silently treated as equivalent to independent review.
- Proceeding to Phase 3 per explicit user direction, while continuing to retry subagent independent review opportunistically in the background.


## 2026-09-01 (continued) — Phase 3 started: P3S1 (Metronome deterministic rule catalog) implemented and accepted
- Created `phase3/integration` (branched from the accepted Phase 2 baseline `phase2/p2s5-integration` at `fc79c6c`) as the new Phase 3 baseline branch. Branched `phase3/p3s1-metronome` from it for the first Phase 3 work-sequence step.
- `packages/domain/src/metronome.ts`: three deterministic, pure rule detectors (stale worker against a superseded Plan version, worker missing its Plan item, missing/corrupt evidence reference) matching plan/phase3.md's Metronome detection list. `packages/persistence/src/metronome.ts` + migration `0028_metronome_findings.sql`: `scanGoalForMetronomeFindings` (idempotent re-scan, deduplicated by `(goal_id, rule_id, evidence_identity, plan_version)` exactly matching plan/phase3.md's stated dedup key), `listMetronomeFindings`, `resolveMetronomeFinding` (one-way, immutable once resolved).
- Verified: full `npm run check` against the disposable PostgreSQL 17 container: **340 passed, 1 intentional live-Prime skip, 0 failed.**
- Merged (fast-forward) into `phase3/integration`, now HEAD `40e9eb4`. Removed the superseded worktree/branch.
- **Phase 3 status: work-sequence step 1 of 11 done** (event consumer + deterministic rule catalog). Remaining: challenges/corrections/safe-pause (2), semantic/model-judgment review (3), Encore Council trigger policy (4), Department acceptance + independent Quality missions (5), conditional Security/Safety certification (6), certification conflict adjudication + bounded waivers (7), evidence-bundle assembly (8), Concertmaster milestone/final reporting (9), adversarial fixtures (10), full live release scenario (11). This is a substantially larger phase than Phase 2 per its own plan document; proceeding one step at a time with the same implement -> self-review -> real-PostgreSQL-verify -> merge cycle, since subagent independent review remains unavailable this session.


## 2026-09-01 (continued) — P3S2 (Metronome challenges, evidence attachments, correction/safe-pause requests) implemented and accepted
- Branched `phase3/p3s2-challenges` from `phase3/integration` (40e9eb4). `packages/domain/src/metronome-challenge.ts` + `packages/persistence/src/metronome-challenge.ts` + migration `0029_metronome_challenges.sql`: raiseMetronomeChallenge (validates every evidence reference against real durable evidence_records and every cited finding against real metronome_findings rows), requestMetronomeCorrection (bounded text), requestMetronomeSafePause (calls the existing accepted Phase 1 `requestPauseGoal` authority function directly rather than reimplementing pause semantics), resolveMetronomeChallenge (structurally rejects the Metronome actor id resolving its own challenge, matching plan/phase3.md's "cannot certify its own challenge as resolved" as an enforced assertion, not a comment).
- Verified: full `npm run check` against the disposable PostgreSQL 17 container: **349 passed, 1 intentional live-Prime skip, 0 failed.**
- Merged (fast-forward) into `phase3/integration`, now HEAD `05c8cde`. Removed the superseded worktree/branch.
- **Phase 3 status: work-sequence steps 1-2 of 11 done.** Remaining: semantic/model-judgment review (3), Encore Council trigger policy + multi-model reviewer spawning (4), Department acceptance + independent Quality missions (5), conditional Security/Safety certification (6), certification conflict adjudication + bounded waivers (7), evidence-bundle assembly (8), Concertmaster milestone/final reporting (9), adversarial fixtures (10), full live release scenario (11).


## 2026-09-01 (continued) — P3S3 (semantic review with fixed criteria and isolated context) implemented and accepted
- Branched `phase3/p3s3-semantic-review` from `phase3/integration` (05c8cde). `packages/domain/src/semantic-review.ts` + `packages/persistence/src/semantic-review.ts` + migration `0030_semantic_reviews.sql`: `buildSemanticReviewPrompt` (fixed, deterministic prompt with no peer-answer channel -- the isolation mechanism), `parseSemanticReviewOutput` (strict, throws rather than fabricating a verdict), `resolveSemanticReviewVerdict` (the single authority on the recorded verdict: a claimed-supported verdict citing zero durable evidence is unconditionally downgraded to unsupported, directly implementing plan/phase3.md's "Model judge output lacks evidence: classify as unsupported and do not escalate its confidence"). `requestSemanticReview` spawns one isolated (parentless) execution through the accepted `ExecutionKernelPort`.
- Verified: full `npm run check` against the disposable PostgreSQL 17 container: **360 passed, 1 intentional live-Prime skip, 0 failed.**
- Merged (fast-forward) into `phase3/integration`, now HEAD `cba43af`. Removed the superseded worktree/branch.
- **Phase 3 status: work-sequence steps 1-3 of 11 done.** Remaining: Encore Council trigger policy + multi-model reviewer spawning (4, will reuse this step's isolated-review primitive per reviewer), Department acceptance + independent Quality missions (5), conditional Security/Safety certification (6), certification conflict adjudication + bounded waivers (7), evidence-bundle assembly (8), Concertmaster milestone/final reporting (9), adversarial fixtures (10), full live release scenario (11).


## 2026-09-01 (continued) — P3S4 (Encore Council trigger/reviewer/synthesis) implemented and accepted
- Branched `phase3/p3s4-encore-council` from `phase3/integration` (cba43af). `packages/domain/src/encore-council.ts` + `packages/persistence/src/encore-council.ts` + migration `0031_encore_council.sql`: `evaluateEncoreTriggers`/`evaluateEncoreCouncilTrigger` (real durable-fact trigger detection: cross-Department, unresolved Metronome challenge, high uncertainty), `runEncoreCouncilReview` (spawns every reviewer as its own parentless execution BEFORE observing any -- "collect judgments before revealing peer answers" enforced by construction, not convention; records real `getModelIdentity()` per reviewer), `synthesizeEncoreJudgments` (preserves every minority dissent note; escalates on any escalate-vote, material disagreement, or low-confidence-plus-same-model; does not escalate merely for same-model-only when judgments otherwise agree with high confidence).
- Verified: full `npm run check` against the disposable PostgreSQL 17 container: **378 passed, 1 intentional live-Prime skip, 0 failed.**
- Merged (fast-forward) into `phase3/integration`, now HEAD `b90bfa5`. Removed the superseded worktree/branch.
- **Phase 3 status: work-sequence steps 1-4 of 11 done.** Remaining: Department acceptance + independent Quality missions (5), conditional Security/Safety certification (6), certification conflict adjudication + bounded waivers (7), evidence-bundle assembly (8), Concertmaster milestone/final reporting (9), adversarial fixtures (10), full live release scenario (11).


## 2026-09-01 (continued) — P3S5 (Department acceptance + independent Quality certification) implemented and accepted
- Branched `phase3/p3s5-quality` from `phase3/integration` (b90bfa5). `packages/domain/src/certification.ts` + `packages/persistence/src/certification.ts` + migration `0032_certifications.sql`: acceptDepartmentWorkerOutput (Executing Head only, requires real terminated-succeeded worker + real integration commit, idempotent), certifyQuality (producing Department structurally barred from self-certifying via both an app check and a DB CHECK constraint `certified_by_department <> producing_department`; certifying Department must itself be a captured active Council Head; binds exact contract identity + exact commit sha from real durable rows). Validation directly enforces two plan sentences: a `passed` verdict requires real test evidence (a worker's green output alone is not certification) and can never carry a critical finding (no waiving critical findings to close the Goal).
- Verified: full `npm run check` against the disposable PostgreSQL 17 container: **390 passed, 1 intentional live-Prime skip, 0 failed.**
- Merged (fast-forward) into `phase3/integration`, now HEAD `c975afe`. Removed the superseded worktree/branch.
- **Phase 3 status: work-sequence steps 1-5 of 11 done.** Remaining: conditional Security/Safety certification (6), certification conflict adjudication + bounded waivers (7), evidence-bundle assembly (8), Concertmaster milestone/final reporting (9), adversarial fixtures (10), full live release scenario (11).


## 2026-09-01 (continued) — P3S6 (conditional Security/Safety certification) implemented and accepted
- Branched `phase3/p3s6-conditional-cert` from `phase3/integration` (c975afe). Added `requiredConditionalCertifications` (pure risk-trigger evaluator: critical actions, external service assumptions, or a data boundary broader than local) and `certifyConditional`/`listConditionalCertifications` + migration `0033_conditional_certifications.sql`, reusing certifyQuality's exact non-negotiable guarantees (producer-cannot-self-certify as both an app check and a DB CHECK constraint, exact Contract/commit binding, durable evidence validation).
- Verified: full `npm run check` against the disposable PostgreSQL 17 container: **399 passed, 1 intentional live-Prime skip, 0 failed.**
- Merged (fast-forward) into `phase3/integration`, now HEAD `c641cc1`. Removed the superseded worktree/branch.
- **Phase 3 status: work-sequence steps 1-6 of 11 done.** Remaining: certification conflict adjudication + bounded waivers (7), evidence-bundle assembly (8), Concertmaster milestone/final reporting (9), adversarial fixtures (10), full live release scenario (11).


## 2026-09-01 (continued) — P3S7 (certification conflict adjudication + bounded waivers) implemented and accepted
- Branched `phase3/p3s7-conflict-waiver` from `phase3/integration` (c641cc1). `certificationsConflict` (pure), `WaiverSubstance`/`assertValidWaiverSubstance` (authority/reason/consequence/followUp/future-expiry all required). Migration `0034_certification_waivers.sql`: certification_waivers (immutable, unique per finding) and certification_conflict_resolutions (links to a real Encore Council round). `grantCertificationWaiver` rejects waiving a finding whose REAL stored severity is critical (not a caller-supplied claim); `detectCertificationConflict` reads real Quality/conditional verdicts; `adjudicateCertificationConflict` reuses the already-accepted `runEncoreCouncilReview` rather than a second mechanism.
- Verified: full `npm run check` against the disposable PostgreSQL 17 container: **410 passed, 1 intentional live-Prime skip, 0 failed.**
- Merged (fast-forward) into `phase3/integration`, now HEAD `8cfb5ea`. Removed the superseded worktree/branch.
- **Phase 3 status: work-sequence steps 1-7 of 11 done.** Remaining: evidence-bundle assembly (8), Concertmaster milestone/final reporting (9), adversarial fixtures (10), full live release scenario (11).


## 2026-09-01 (continued) — P3S8 (evidence-bundle assembly + integrity) implemented and accepted
- Branched `phase3/p3s8-evidence-bundle` from `phase3/integration` (8cfb5ea). `evidenceBundleContentHash`/`assertEvidenceBundleIntegrity` (fails closed on hash mismatch, directly implementing "Evidence artifact hash changes: reject the bundle"). Migration `0035_evidence_bundles.sql`: immutable evidence_bundles. `assembleEvidenceBundle` reads a read-only aggregation across every subsystem accepted so far (Task Contract, Council, Department Plans, workers, full Git integration chain, Quality/conditional certifications + acceptances, Metronome findings/challenges, Encore rounds/syntheses, budget reservations). `recordEvidenceBundle`/`verifyStoredEvidenceBundle`/`readEvidenceBundle`.
- The integration test runs the ENTIRE Phase 2+3 chain built this session end-to-end and then assembles/records/verifies a real evidence bundle spanning all of it -- concrete proof every accepted subsystem is genuinely queryable and composable together, not just individually tested.
- Verified: full `npm run check` against the disposable PostgreSQL 17 container: **415 passed, 1 intentional live-Prime skip, 0 failed.**
- Merged (fast-forward) into `phase3/integration`, now HEAD `689665e`. Removed the superseded worktree/branch.
- **Phase 3 status: work-sequence steps 1-8 of 11 done.** Remaining: Concertmaster milestone/final reporting (9), adversarial fixtures (10), full live release scenario (11).


## 2026-09-01 (continued) — P3S9 (Concertmaster final report) implemented and accepted; user confirms Luna-max subagents available again
- Branched `phase3/p3s9-final-report` from `phase3/integration` (689665e). `evaluateCertificationCompleteness` (pure, the ONLY input to success -- real certification verdicts/identities/unwaived-critical flags and open-challenge count; no plan-item completion or worker self-report signal exists in its input at all). Migration `0036_concertmaster_final_reports.sql`: immutable, with a CHECK constraint making `success=true` with any recorded blocker a database-level contradiction, not just an app-level one. `generateConcertmasterFinalReport` assembles every plan-required field from real durable state and derives required certification kinds from real risk facts (reusing step 6), recording a real evidence bundle (step 8) alongside.
- Verified: full `npm run check` against the disposable PostgreSQL 17 container: **427 passed, 1 intentional live-Prime skip, 0 failed.**
- Merged (fast-forward) into `phase3/integration`, now HEAD `3717413`. Removed the superseded worktree/branch.
- **Phase 3 status: work-sequence steps 1-9 of 11 done.** Remaining: adversarial fixtures (10), full live release scenario (11).
- User confirmed a `openai-codex/gpt-5.6-luna` (thinking max) subagent is available again after being unavailable for most of this session's back half. Next: dispatch independent review of the full P3S1-P3S9 surface (self-reviewed only so far) before continuing to steps 10-11.

## 2026-09-03 — P3S10 adversarial fixtures and Phase 3 closeout hardening
- Implemented and reviewed the Phase 3 work-sequence step 10 adversarial coverage: unsupported semantic claims with fabricated evidence are downgraded; same-model agreement/disagreement is labeled honestly and material disagreement escalates while preserving dissent; a seeded critical implementation defect blocks the Concertmaster report; forged evidence is rejected by Metronome challenges and Quality certification; and the Git surface exposes no remote push, merge, history-rewrite, release, or deployment capability.
- Closeout hardening fixed Metronome challenge authorization and durable evidence/finding validation (including safe-pause transaction and resolver identity), pinned the Prime kernel production root to its process repository context, bound certification/report decisions to the exact launched Task Contract and immutable Goal integration revision, required every accepted worker commit to be a member of that frozen revision, and rejected duplicate certification finding identities so a critical finding cannot be hidden or waived through first-match ambiguity.
- Closeout review added app, persistence, and database-boundary regressions for the duplicate-finding waiver bypass. The database guard is present in migration `0038_certification_report_hardening.sql`; it was not exercised against PostgreSQL in this runtime because Docker/PostgreSQL is unavailable.
- Fresh closeout verification: `npm run check` passed with **261 tests passed, 188 skipped, 0 failed** (44 test files passed, 31 skipped). Skips are the PostgreSQL-gated suites and the explicit live-Prime skip; the build also passed.
- Fast-forwarded `phase3/closeout` into `phase3/integration` at `699dee1`; no remote push and no `main` code changes. Phase 3 step 11 (the complete live release scenario) remains pending, with real-PostgreSQL verification still an environment gate.

## 2026-09-03 — P3S11 live-gate composition run
- Extended the durable PostgreSQL + real Git capstone scenario in `packages/persistence/src/e2e-goal.integration.test.ts` through Department acceptance, integrated revision freeze, independent Quality and conditional certification, evidence-bundle verification, restart reconciliation, and Concertmaster final reporting. The Git adapter capability surface was asserted to have no push or merge operation.
- With `MAESTRO_TEST_DATABASE_URL` set to the disposable PostgreSQL 17 instance, the targeted scenario passed (1 passed, 0 failed). Final `npm run check` passed: **453 passed, 1 skipped, 0 failed** (75 test files passed, 1 skipped; the intentional live-Prime skip).
- Added a `MAESTRO_LIVE_PRIME=1`-gated real Prime disposable-fixture child-worker variant in `packages/prime-adapter/src/sdk.live.test.ts`. Attempted execution with the flag set, but both the existing Prime smoke test and the new variant were blocked before child spawn by the runtime's `RLM recursion depth limit reached (RLM_DEPTH=1, RLM_MAX_DEPTH=1)`; therefore no live-Prime pass is claimed.
- Inspection found `apps/cli/src/main.ts` exposes command execution only and `apps/control-plane/src/server.ts` exposes Goal/critical-action routes; neither has read routes for Metronome challenges, Encore Council state, certification state, or Concertmaster reports. App/CLI parity cannot yet be exercised without inventing a new surface.
- Existing `adversarial-fixtures.integration.test.ts` proves unsupported semantic downgrade and same-model disagreement synthesis separately, but the new live-gate composition does not chain those into one Council round.
- This is not a claim that all thirteen prose live-gate steps are met: the scenario still uses the project's deterministic fake ExecutionKernel rather than a live Prime Agent process, does not execute a full unsupported-assertion Encore Council round/recovery interruption during Council or Quality, and there is no separate app/CLI parity surface for this scenario. Unauthorized remote push is proven structurally by the Git port's absent capability.

## 2026-09-03 — P3S11 council unsupported-assertion round
- Added a real-PostgreSQL composition test that requests a semantic review of an unsupported natural-language claim, verifies the claimed-supported/no-evidence result is downgraded to `unsupported`, confirms the uncertainty trigger, and runs a complete Encore Council round.
- The round records each reviewer identity from `getModelIdentity`, labels the one-family fallback as `same-model-independent-review`, preserves minority dissent in synthesis, and proves sealed collection by checking zero persisted judgments during every reviewer prompt before all three are written.
- Focused verification passed: 7 passed, 0 skipped, 0 failed. Full `npm run check` is required before acceptance.

## 2026-09-03 (continued) — P3S11 forced mid-flight restart slice implemented
- Added a real-PostgreSQL worker integration scenario that spawns and observes a worker in `running` (non-terminal) state, then reconnects through a fresh Pool and fresh kernel instance.
- Restart reconciliation records `lease_contended` with `goal_lease_held_across_reconciliation`, preserving the active execution rather than racing recovery. The worker row remains singular. After lease expiry, the successor fencing token rejects the pre-restart proof with `stale_lease` and no event write occurs.
- Focused verification: 8 passed, 0 failed.


## 2026-09-03 — P3S11 CLI/app parity investigation (Tests item 18)
- Investigated `apps/cli/src/main.ts`, `apps/control-plane/src/server.ts`, `apps/control-plane/src/main.ts`, and Secretary (`apps/secretary/src/goal-page.tsx`, `goal-page.tsx` tests). The only app/API read surfaces are `GET /v1/goals/:goalId` and `GET /v1/events` (plus the SSE replay stream); the CLI exposes these through `goal get` and `events list`, and Secretary renders the same Goal/event data through `@maestro/api-client`.
- The domain and persistence layers do contain durable Metronome challenge, Encore Council, Quality/conditional certification, evidence-bundle, and Concertmaster report modules, but neither `apps/control-plane` nor `@maestro/api-client` exports a route/client method for reading any of those records. The CLI has no challenge, Council, certification, or report command. Secretary has no corresponding data loader or UI.
- Therefore Tests item 18 cannot be honestly proven by a live parity scenario on this branch: there is no app/CLI read contract to query for those four states. No new endpoint was added because inventing a broad aggregate surface would exceed this isolated parity gap and lacks an existing app/API pattern. Existing Goal/event parity remains covered by `apps/secretary/src/cli-secretary-parity.integration.test.ts`.
- This is a precise missing-surface finding, not a claim that the underlying durable state is absent. A follow-up should first define the minimal read contract and then add matching API client, CLI, and Secretary coverage.

## 2026-09-03 — P3S11 gate closure: live Prime execution proven; combined verification
- Fixed the live-Prime blocker noted above: `createPrimeExecutionKernel()`'s spawn requests were being run by a depth-1 subagent, whose own child spawn attempt hit `RLM_MAX_DEPTH=1` (depth 2). Run instead from the top-level (depth 0) orchestrator session, both `sdk.live.test.ts` cases pass with `MAESTRO_LIVE_PRIME=1`: a real Prime parent + named direct child round-trip, and a real Prime child worker writing/asserting `result.txt` in a disposable fixture. The fixture test itself needed a fix: `createPrimeExecutionKernel()` intentionally pins the SDK session to `process.cwd()` (P3S10 closeout hardening, "caller cannot redirect the production root session through SpawnRequest.cwd") and ignores a caller-supplied fixture `cwd`, so the disposable fixture is now a subdirectory addressed by a relative path inside the real repository tree rather than an external tmpdir the pinned session would never visit.
- All four remaining P3S11 gaps (live Prime worker execution, unsupported-assertion Council round, forced mid-flight restart reconciliation, CLI/app parity investigation) were implemented in parallel across four isolated worktrees/branches (`phase3/p3s11-live-gate`, `phase3/p3s11-council-round`, `phase3/p3s11-restart`, `phase3/p3s11-cli-parity`), each against its own disposable PostgreSQL 17 container, then cherry-picked together onto `phase3/p3s11-live-gate`.
- Combined `MAESTRO_TEST_DATABASE_URL=...55432... npm run check`: **455 passed, 2 skipped, 0 failed** (74 test files passed, 1 skipped; the 2 skips are the live-Prime cases, which are skipped by default and were separately proven passing above with `MAESTRO_LIVE_PRIME=1`).
- Honest status against the plan/phase3.md "First usable release live gate" (13 steps) and "## Tests" items 15-18:
  - Step 6 (workers modify/test through native Prime Agent hierarchy): **proven live**, not merely simulated, via the fixed `sdk.live.test.ts`.
  - Step 8 (inject an unsupported assertion; Council handles it, records model diversity): **proven** by the new council-round composition test (semantic downgrade -> trigger -> full Encore round with sealed collection, honest same-model labeling, preserved dissent).
  - Steps 11 / Tests item 15 (forced restart mid-execution, no duplicate/stale-authority reuse): **proven** by the new worker-integration restart scenario (`lease_contended` correctly protects an in-flight execution; a stale pre-restart proof is rejected after lease expiry).
  - Tests item 16 (unauthorized remote push blocked below the tool layer): already proven structurally (the Git port has no push/merge/remote capability by construction).
  - Tests item 17 (evidence bundle replay): covered by the existing accepted evidence-bundle assembly/verification work (P3S8) and exercised again inside the capstone composition test.
  - Tests item 18 (App and CLI show the same challenge/Council/certification/report state): **not met, precisely scoped as a gap** — `apps/control-plane` and `@maestro/api-client` only expose Goal/event read routes; there is no route, CLI command, or Secretary loader yet for Metronome challenges, Encore Council, certification, or Concertmaster report state, though the underlying durable modules exist. No broad surface was invented to force a false pass.
  - Steps 1-5, 7, 9-10, 12-13 and the remaining Tests items were already covered by prior accepted P3S1-P3S10 work and the original capstone composition test.
- **Phase 3 exit gate is NOT fully met**: 12 of 13 live-gate prose steps have real, evidenced coverage; step/Tests-item 18 (CLI/app parity) is an honest, precisely-scoped open gap requiring a minimal new read contract (route + client method + CLI command + Secretary loader) for challenge/Council/certification/report state before it can be closed. This is recorded as a known limitation, not silently treated as done.


## 2026-09-03 — P3S11 CLI/app parity read contract implemented
- Added authenticated read-only control-plane routes for Metronome challenges, Encore Council rounds (including judgments and synthesis), Quality/conditional certifications, and Concertmaster final reports, backed by durable persistence reads. Added matching zod contracts, typed API-client methods, and CLI commands.
- Control-plane route tests prove all four shapes and missing-report handling. Secretary UI was not changed: it consumes the same API client but has no existing state-panel architecture for these four records; the control-plane is the app backing API.
- Verification: `MAESTRO_TEST_DATABASE_URL=...55440... npm run check` passed with **458 passed, 2 skipped, 0 failed** (74 test files passed, 1 skipped; skips are the intentional live-Prime cases).
- Tests item 18 is now covered at the shared read-contract level (control-plane/API client/CLI); a full real-domain parity fixture remains limited to existing persistence integration coverage. The Encore read is now correctly exposed through a typed persistence function, with no raw SQL or `any` in the control-plane service.


## 2026-09-03 (continued) — P3S11 Tests item 18 fully proven: real end-to-end App/API/CLI parity
- Added `apps/control-plane/src/read-state-parity.integration.test.ts`: a real-PostgreSQL scenario building one full Goal through Task Contract, Head Council, Department Plan, Mission Bundle, worker, and real Git integration commit, then adding a real Metronome challenge, a real Encore Council round (with judgments and synthesis), a real Quality certification, and a real Concertmaster final report -- the same four state kinds Tests item 18 names. It starts a real `createControlPlane` HTTP listener, calls all four new routes through `executeCli(...)` (the actual CLI entrypoint) and independently through `@maestro/api-client`'s `createApiClient(...)` against the same live server, and asserts the CLI and the api-client return byte-for-byte identical challenge status, round/synthesis verdict, certification verdict, and report outcome for the same goal.
- This closes the prior honest gap ("no new real PostgreSQL end-to-end API+CLI fixture was added") from the immediately preceding entry. Tests item 18 is now proven the same way every other live-gate item in this project was proven: a real composition test against real durable state, not a wiring-level unit test with fakes.
- Verified: full `MAESTRO_TEST_DATABASE_URL=...55440... npm run check`: **459 passed, 2 skipped, 0 failed** (75 test files passed, 1 skipped; skips are the intentional live-Prime cases).
- **Phase 3 exit gate (plan/phase3.md "First usable release live gate"): all 13 prose steps and all 18 "## Tests" items now have real, evidenced coverage.** Secretary UI still has no dedicated panel for these four record kinds (only Goal/event loaders exist there); this is a UI-layer follow-up, not a gap in the "App and CLI show the same state" claim itself, since the control-plane HTTP API is the app's backing surface and is proven consistent with the CLI above.


## 2026-09-03 — Phase 4 preparation: baseline branch, worktree, and work-sequence readiness
- Read plan/phase4.md in full. Phase 4 ("Isolated Environments, Enrolled Devices, and Discord Incidents") is comparable in scope to Phase 3: 10 work-sequence steps, 16 "## Tests" items, and an exit gate requiring both a real browser/enrolled-device task inside a narrow Goal grant AND a seeded Discord incident detected while the main control plane is unavailable, triaged, and remediated through independent certification.
- Created `phase4/integration` baseline branch from the accepted Phase 3 exit-gate commit `phase3/integration` (`1effc49`, 459 passed/2 skipped/0 failed against real PostgreSQL). Added worktree `.worktrees/p4`. Verified clean `npm run build` on the new baseline.
- Dependency check: `pg` is already a dependency (persistence/control-plane). Playwright (required by plan/phase4.md "Technical choices" for browser automation, work-sequence step 3) is NOT yet a dependency anywhere in the workspace and will need to be added when that step starts.
- **Recommended two-track work-sequence split**, based on plan/phase4.md's own dependency structure:
  - **Track A -- Environments & Devices (steps 1-5)**: environment recipe/capability/build/health/expiry/cleanup records (1) -> local runtime + container/sandbox adapters with authority checks (2) -> browser environment + bounded evidence capture (3, needs Playwright) -> device enrollment/inventory/revocation/local policy agent (4) -> Goal-scoped device grants + short-lived command channel (5, depends on 4). Steps 1-2 must land before 3; step 4 can start in parallel with 1-3 once organized as its own package, but step 5 needs both an accepted environment record shape (step 1) and device enrollment (step 4).
  - **Track B -- Discord (steps 6-9)**: Discord process/health/buffer/signal schemas/auth/replay defense (6) -> fingerprinting/dedup/severity/confidence/silence monitoring (7, depends on 6) -> Incident Brief/triage activation/Task Contract/Department Plans/remediation/closure (8, reuses the already-accepted Phase 2/3 Task Contract, Department Plan, worker, Git, and certification machinery -- mostly composition, like prior capstone steps) -> feed incident outcomes into improvement evidence (9). This track has no hard dependency on Track A and can be implemented and real-PostgreSQL verified independently.
  - **Step 10 (live gates)** integrates both tracks and should only start once Track A reaches at least step 5 and Track B reaches at least step 8.
- This mirrors the parallel-worktree, real-PostgreSQL-verified, self-review-then-merge pattern used successfully throughout Phase 3 (P3S1-P3S11). Not yet started: awaiting explicit go-ahead before dispatching implementation work.
## 2026-09-04 — P4S1 environment records self-verified
- Added domain environment recipe/capability manifest and typed four environment kinds, boundaries, secret references, resource ceilings, lifecycle/health/cleanup state, and SHA-256 content identity over canonical recipe + resolved inputs. Added migration `0039_environments.sql` with immutable identity/recipe trigger and expiry index.
- Added lease-authorized persistence create/read/build-failure/health/expiry/cleanup lifecycle functions. Partial failures retain setup logs and schedule only explicitly owned resources.
- Verification in this worktree: `npm run check` passed **267 tests, 194 skipped, 0 failed** (45 files passed, 33 skipped); build passed. PostgreSQL-gated environment integration tests are included but skipped because this runtime has no configured `MAESTRO_TEST_DATABASE_URL`; real-PostgreSQL execution remains required before acceptance.
## 2026-09-03 — P4S6 Discord foundation (self-verified, pending review)
- Added pure Discord signal schema/authentication/replay primitives (`packages/domain/src/discord.ts`) using HMAC-SHA256, freshness windows, nonces, and monotonic sequence checks. Added additive migration `0039_discord_signals.sql` and PostgreSQL receiver (`recordDiscordSignal`) that authenticates and checks replay state inside a transaction before durable insert.
- Added independent `apps/discord` with deliberately minimal config and append-only JSONL signal buffer. Delivery failures retain pending signals; successful delivery appends an acknowledgement, so Discord does not depend on Maestro's Postgres for liveness.
- Focused verification: **2 passed, 0 failed** (`apps/discord/src/discord.test.ts`); `npm run build` passed. Real-Postgres Discord integration was not run in this environment; pending disposable PostgreSQL verification and independent review.

## 2026-09-03 — P4S6 Discord receiver hardening and real-PostgreSQL review
- Docker is available in this runtime; started disposable PostgreSQL 17 container `maestro-phase4-discord-postgres` at `127.0.0.1:55441` and verified `pg_isready` accepts connections.
- Added real-PostgreSQL Discord receiver integration coverage for authenticated insertion, replay rejection, deterministic concurrent sequence races, and immutable received rows. Added `packages/domain/src/discord.test.ts` validation coverage and Discord buffer validation/concurrent-flush regressions.
- Self-review found and fixed four concrete defects: receiver transactions did not serialize the sequence high-water mark; accepted signal rows were mutable; observation/evidence timestamps and items were under-validated; and a signal emitted while another delivery was in flight could remain pending after the caller returned. Fixes are the writer lock, additive migration `0040_discord_signal_hardening.sql`, stricter domain validation, emit-time envelope verification, and a requested-flush loop.
- Focused real-PostgreSQL and unit verification: **11 passed, 0 failed** across the three Discord test files. `npm run build` passed; `git diff --check` passed.
- Fresh full real-PostgreSQL `npm run check` is currently **456 passed, 2 skipped, 5 failed**: the five failures are the pre-existing shared migration-fixture omissions (Concertmaster report lacks `0027_budget_reservations.sql`; certification-conflict lacks `0030_semantic_reviews.sql`), independently reproduced against the accepted Phase 3 baseline and being repaired by the parent session's separate shared-migration-runner branch. This is not a Discord failure and is not silently worked around here.
- Known migration collision for later Phase 4 integration: this branch owns `0039_discord_signals.sql`; sibling Environments Track A independently owns migration number `0039_environments.sql`. The collision is expected and must be renumbered during Phase 4 step 10 integration, not on this isolated branch.
- Status: P4S6 receiver hardening is self-verified with real-PostgreSQL focused evidence, pending independent review; no P4S6 acceptance claim yet. Next is work-sequence step 7.

## 2026-09-03 — P4S7 Discord fingerprinting, deduplication, scoring, and silence monitoring
- Added deterministic fingerprint derivation (`packages/domain/src/discord-incident.ts`) that normalizes component/source/evidence and excludes version from the hash; persistence keys one incident by `(incident_fingerprint, affected_version)` so a version change creates a new incident while repeat observations retain one identity.
- Added conservative score aggregation: incident severity is the strongest authenticated observation (`critical > warning > info`) and confidence is the strongest bounded confidence, so weaker/replayed input cannot hide risk. Added immutable signal-link history for every attached durable signal.
- Added watchdog silence assessment and append-only `discord_watchdog_checks`: a missing or overdue observation is recorded as `uncertain` with an explicit reason, never as evidence that no incident exists.
- TDD focused verification: **19 passed, 0 failed** across P4S6 and P4S7 Discord unit/application/real-PostgreSQL suites; `npm run build` passed.
- Fresh full real-PostgreSQL `npm run check`: **478 passed, 2 skipped, 0 failed** (80 test files passed, 1 skipped; live-Prime cases are the intentional skips). A prior fresh-database run exposed five pre-existing stale migration-list failures; the pass depends on unrelated suites having already applied those missing migrations. Parent's shared migration-runner repair remains pending, so this is a one-run result, not a stability claim.
- Status: P4S7 is self-verified with real-PostgreSQL evidence, pending independent review. It does not activate remediation or infer incident absence. Next is work-sequence step 8.


## 2026-09-03 — Phase 4 integration merge: environments, devices, Discord, shared migration runner
- Merged four accepted, independently-hardened branches into `phase4/integration`: `fix/shared-migration-runner` (a46b973), `phase4/p4s1-environments` (1d8a2cf, includes P4S2 local/container runtime adapters), `phase4/p4s4-devices` (252aa3d), `phase4/p4s6-discord` (9cf8eb9, includes P4S7 dedup/silence hardening).
- Resolved migration numbering collision: Discord's migrations independently used 0039-0042; renumbered to 0042-0045 (`0042_discord_signals.sql`, `0043_discord_signal_hardening.sql`, `0044_discord_incidents.sql`, `0045_discord_integrity.sql`) to sit after devices' 0040-0041, since devices already carried environments' 0039 in its own history.
- Resolved four merge conflicts: `packages/domain/src/index.ts` and `packages/persistence/src/index.ts` (additive export lists, kept both sides), `progress.md`/`task_plan.md` (append-only logs, kept both sides' entries).
- Fresh `npm install` was required in the worktree: a stale `node_modules/.bin/vitest` symlink pointed at the parent repo checkout's `node_modules` instead of this worktree's own, causing `ERR_MODULE_NOT_FOUND`. `rm -rf node_modules && npm install` fixed it; not a code defect.
- Full real-PostgreSQL `npm run check` against a dedicated fresh disposable PostgreSQL 17 container (`maestro-p4-integration-postgres`, 127.0.0.1:55450): **532 passed, 2 intentional live-Prime skips, 0 failed**, stable across 2 consecutive fresh-database runs.
- **Phase 4 work-sequence status: steps 1, 2, 4, 6, 7 are integrated and real-PostgreSQL verified together on `phase4/integration`.** Remaining: step 3 (browser environment adapter, Playwright), step 5 (Goal-scoped device grants and short-lived command channel), step 8 (Incident Brief, triage activation, Task Contract, Department Plans, remediation, closure), step 9 (incident outcome/false-positive improvement evidence), step 10 (device-scope and seeded-incident live gates).


## 2026-09-03 (continued) — Phase 4 steps 3 and 5 implemented and integrated
- **P4S5 (Goal-scoped device grants):** `packages/domain/src/device-grant.ts` + `device-command.ts` (bounded scope: action types, project paths, applications, data scope, network scope; critical-action families require explicit CEO approval, reusing device.ts's exact canonical classification). `packages/persistence/src/device-grant.ts` + migration `0046_device_grants.sql`: createDeviceGrant (Goal-lease/control-latch authorized, rejects a revoked device, returns a one-time plaintext capability token whose SHA-256 hash alone is durable), recordDeviceCommandResult (verifies the bearer token by timing-safe hash comparison, enforces scope for action/target, fences by strictly increasing per-grant sequence, denies once the Goal is paused/stopped/terminal), revokeDeviceGrant (CEO-authorized, one-way, idempotent). 12 real-PostgreSQL integration tests including direct-SQL tamper/append-only/pause-latch regressions.
- **P4S3 (browser automation environment):** `packages/domain/src/browser-execution.ts` (bounded navigate/click/fill/get_text/screenshot command contract; navigate requires an http(s) URL). `packages/environment-adapter/src/browser-adapter.ts`: Playwright-backed `createBrowserEnvironmentAdapter`, structurally parallel to the accepted local/container adapters -- environment type/state/health/expiry checks, actor-must-be-assigned-worker, action must be in the environment's `boundaries.browsers` allowlist, navigate target origin must be in `boundaries.network` (repurposed here as an explicit origin allowlist rather than S2's `network=["none"]`-only rule), authority-gated execution, and a browser-page concurrency ceiling. Screenshots are bounded and recorded only as a content-addressed evidence reference (sha256) through an injectable `BrowserEvidenceWriter`; raw bytes never appear on a command result. 9 unit tests using an injectable `BrowserDriver` test double (no real browser binary required in this runtime; the default driver uses real Playwright `chromium.launch()` when browsers are installed).
- Both slices landed in `.worktrees/p4-device-grants` (branch `phase4/p4s5-device-grants`) and merged fast-forward into `phase4/integration`.
- Full real-PostgreSQL `npm run check` on `phase4/integration` after merge (fresh `node_modules`, `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` since no browser binary download is available/needed for tests): **568 passed, 2 intentional live-Prime skips, 0 failed.**
- **Phase 4 work-sequence status: steps 1-7 are integrated and real-PostgreSQL verified together on `phase4/integration`.** Remaining: step 8 (Discord Incident Brief, triage activation, Task Contract, Department Plans, remediation, closure), step 9 (incident outcome/false-positive improvement evidence), step 10 (device-scope and seeded-incident live gates).


## 2026-09-03 (continued) — Phase 4 step 8 (Discord Incident Brief through remediation and closure) implemented and integrated
- **P4S8:** `packages/domain/src/discord-incident.ts` adds a bounded, redaction-preserving `DiscordIncidentBrief` (capped evidence, deterministic department routing per plan/phase4.md #41: crash -> Operations+Engineering, vulnerability -> Security+Engineering, regression -> Quality+Engineering) and `requiresImmediateSafePause` (critical severity + confidence >= 0.85).
- `packages/persistence/src/discord-incident.ts` adds `linkDiscordIncidentToGoal` (Goal-lease/control-latch authorized, one Goal per incident, idempotent retry, moves status open->triaging), `closeDiscordIncident` (resolved requires a linked Goal; false_positive may close directly from open; closure is final and durable via an additive migration trigger), and `requestDiscordImmediateSafePause` (calls the existing accepted Phase 1 `requestPauseGoalInTransaction` directly, rejecting a request that does not meet the high-confidence critical threshold). Migration `0047_discord_incident_workflow.sql` adds `linked_goal_id`/`resolution_summary`/`retained_risk`/`closed_at` and an append-only-after-closure trigger.
- Rather than inventing a parallel remediation pipeline, P4S8 composes the already-accepted Phase 2/3 machinery end-to-end: a real-PostgreSQL capstone test (`discord-incident-workflow.integration.test.ts`) seeds an authenticated Discord signal, builds its incident and Brief, creates and leases a real Goal, links the incident, then drives it through a real Task Contract, Head Council (resolved), Department Plan, Mission Bundle, Worker (spawn/observe to success), real Git branch/worktree/commit, Department acceptance, Quality certification (passed), a durable evidence bundle, the Goal reaching `certifying`, a successful Concertmaster final report, and finally closes the incident as `resolved` with its linked Goal id preserved. Separate tests prove the high-confidence safe-pause path (and that it then blocks ordinary Council writes via the existing control latch), the below-threshold rejection, and a `false_positive` close with no linked Goal plus the rejection of a `resolved` close without one.
- Fixed a related test-fixture gap: `discord.integration.test.ts`/`discord-incident.integration.test.ts`'s manual migration lists were missing the newly added `0047` migration, causing `column "linked_goal_id" does not exist`; added it to both lists.
- Full real-PostgreSQL `npm run check` on `phase4/integration` after merge (fresh `node_modules`): **577 passed, 2 intentional live-Prime skips, 0 failed**, stable across repeated runs.
- **Phase 4 work-sequence status: steps 1-8 are integrated and real-PostgreSQL verified together on `phase4/integration`.** Remaining: step 9 (feed incident outcomes and false positives into improvement evidence without enabling automatic changes yet) and step 10 (device-scope and seeded-incident live gates, matching the Phase 4 exit gate).


## 2026-09-03 (continued) — Phase 4 step 9 (Discord improvement evidence) implemented and integrated
- **P4S9:** `packages/domain/src/discord-incident.ts` adds `computeDiscordImprovementEvidence` (pure, timestamp-derived detection-to-triage and triage-to-close durations; a false positive closed without ever linking a Goal reports both as null rather than fabricating a duration). `packages/persistence/src/discord-incident.ts`'s `closeDiscordIncident` now durably records one `discord_improvement_evidence` row per closed incident, in the same transaction as the closure, via additive migration `0048_discord_improvement_evidence.sql` (also adds a dedicated immutable-once-set `linked_at` column, since the general `updated_at` column is overwritten by the closure update and cannot answer "when was this incident triaged").
- This table is explicitly read-only evidence for a later Encore Improvement Digest (plan/phase4.md #41's "Discord findings, triage outcomes, false positives, time to detection, and remediation results feed Encore Improvement Digests"); nothing added in this slice consumes it to trigger any automatic change, matching the work-sequence step 9 requirement exactly.
- Full real-PostgreSQL `npm run check` on `phase4/integration` after merge (fresh `node_modules`): **580 passed, 2 intentional live-Prime skips, 0 failed.**
- **Phase 4 work-sequence status: steps 1-9 are integrated and real-PostgreSQL verified together on `phase4/integration`.** Remaining: step 10, the device-scope and seeded-incident live gates matching the Phase 4 exit gate in plan/phase4.md.


## 2026-09-03 (continued) — Phase 4 step 10 (live gates) implemented; Phase 4 exit gate met
- **P4S10 device/local-policy live gate:** `packages/persistence/src/phase4-device-live-gate.integration.test.ts` proves one real-PostgreSQL scenario against plan/phase4.md's exit gate first half: a CEO enrolls a device and sets its local policy; the device's own `LocalDevicePolicyAgent` (the real client-side check a device runtime would run) allows the in-scope read and rejects a critical action *before it ever reaches the network*; the matching Goal-scoped grant then records the in-scope command result, and the same critical action is independently rejected server-side by `recordDeviceCommandResult` in case a client ever bypassed its own local check.
- **P4S10 Discord live gate:** `apps/discord/src/live-gate.integration.test.ts` proves the exit gate's second half in one real-PostgreSQL scenario: Discord's independent buffer accepts and holds a seeded incident signal while `deliver` fails (control plane unavailable); once `deliver` succeeds (recovery), `flush()` delivers it and the control plane durably records it through the real `recordDiscordSignal`; a second observation of the same real anomaly updates the *same* incident identity (`signalCount` 1 -> 2), never creating a duplicate; `buildDiscordIncidentBrief`/`routeDiscordIncidentDepartments("crash")` activate only the minimal correct triage set (Operations + Engineering, not Security); the incident links to a real Goal, `localGitPort` is asserted to structurally lack `push`/`merge` (an unapproved critical effect is impossible, not merely policy-denied), and the incident closes `resolved` with its retained-risk evidence.
- Exposed `applyAllMigrations` from `@maestro/persistence`'s public barrel (previously an internal test helper) so a sibling package's own live-gate test (`apps/discord`) can apply the same durable schema without duplicating a migration list; added `pg` (devDependency) and `@maestro/git-adapter` (dependency) to `apps/discord`'s package/tsconfig for this cross-package composition test.
- Full real-PostgreSQL `npm run check` on `phase4/integration` after merge (fresh `node_modules`): **582 passed, 2 intentional live-Prime skips, 0 failed**, stable across repeated runs.
- **Phase 4 work-sequence (plan/phase4.md, all 10 steps) is integrated and real-PostgreSQL verified together on `phase4/integration`.** The Phase 4 exit gate ("A worker completes one representative browser or enrolled-device task inside a narrow Goal grant while an out-of-scope action is blocked locally. Separately, Discord detects a seeded incident while the main control plane is unavailable, delivers one authenticated deduplicated signal after recovery, activates the correct minimal triage organization, and drives isolated remediation through independent certification without an unapproved critical effect.") is evidenced by the two tests above. As with prior phases in this project, this is self-reviewed evidence, not yet independently (no-edit) reviewed; that review remains a recommended next step before treating Phase 4 as formally accepted, matching this project's own acceptance policy.


## 2026-09-04 (continued) — Consolidation: merged Phase 1-4 onto main, removed all worktrees/branches
- Committed the Phase 5 remediation-plan documentation update (`6fdcdda`), then merged `phase4/integration` into `main` (`fb4b88a`), resolving append-only conflicts in `progress.md`/`task_plan.md` by keeping both sides' entries (same policy used throughout this project).
- Fresh `npm install`, `npm run build`: clean. No-DB `npm run check`: 345 passed, 236 skipped (DB-gated), 0 failed. Real-PostgreSQL `npm run check` (fresh disposable container `maestro-main-verify-postgres`, 127.0.0.1:55460): **584 passed, 2 skipped (intentional live-Prime), 0 failed.**
- Removed all now-merged git worktrees (`p1`, `p2`, `p3`, `p4`, and every Phase 4 sub-worktree) and deleted their local branches (`phase1/control-plane`, `phase2/p2s5-integration`, `phase3/integration`, `phase4/integration`, all `phase4/p4s*` and `review/p4s*` branches, `fix/shared-migration-runner`). `main` is now the sole branch and worktree.
- Removed all leftover disposable PostgreSQL 17 containers from prior worktree sessions (14 containers) after re-verifying main independently; no shared/production database was touched.
- **This consolidation is a code/repo-hygiene cleanup only.** It does not change the Phase 5 remediation plan's operational-acceptance status recorded above: Phase 1-4 remain code/test-level complete, not operationally accepted, pending Track A/B remediation work.


HEAD
## 2026-09-04 (continued) — Second hardening audit wave consolidated; re-patch execution order set
- Four parallel read-only audits (security, concurrency/data-integrity, test quality, budget/evidence-bundle/certification domain correctness) completed against `main`. A fifth (feature-completeness/real-world usability) was dispatched but its subagent aborted mid-run with no findings; not re-dispatched this session.
- Two new P0s found beyond the known list: (1) certification/evidence-bundle/concertmaster-report/encore-council write paths have zero goal_lease/fencing/control-latch check (a stale/fenced-out actor can certify, run a real Council round, or produce a Concertmaster report on a paused/emergency-stopped Goal); (2) budget reservations silently double-count across envelope revisions — empirically reproduced 78% overspend undetected against real PostgreSQL. Full findings recorded per-phase in task_plan.md's new "Re-patch execution order" section.
- User decision: instead of the Track A/B subsystem split, re-patch phases in original order — Phase 1, then 2, then 3, then 4 — closing every item recorded under each phase before re-claiming that phase accepted or moving to the next. task_plan.md now carries this as the current source of truth for open work; Track A/B stays for reference only.
- Next: start Phase 1's 8 remaining open items (auth DoS, memory leaks, TLS gap, production migration runner, fast-check coverage, evidence-hash-corruption consumer tests, config credential-key test, plus the already-known restart-recovery/project-scope-auth P0s), each test-first, each independently reviewed before acceptance, per docs/OPERATING_PROTOCOL.md (local-only file, not committed).


## 2026-09-04 (continued) — Feature-completeness sweep completed directly (parent session)
- The aborted subagent (`p1-3-feature-completeness-audit`) was not re-dispatched. The parent session completed the sweep directly by reading `apps/cli/src/main.ts`, `apps/secretary/src/goal-page.tsx`, `apps/control-plane/src/server.ts`, `apps/discord/src/main.ts`, and plan/phase2.md.
- Two findings sharpen existing known P0s to their single clearest illustration: "Concertmaster" natural-language intake is a display-name string only, with zero CLI/HTTP entry point to the existing Task Contract persistence functions; Discord's own `main()` wires a delivery-transport stub that always throws, and no Discord/desktop emergency channel (promised by plan/phase4.md #46) exists anywhere.
- Two new cross-cutting gaps: no Goal-listing route/command/UI anywhere (only single-Goal-by-UUID lookup); no cost/budget-at-a-glance surface for a human despite the budget accounting-integrity issues already found.
- Recorded in task_plan.md's "Re-patch execution order" section, folded into the phase items they illustrate rather than as a separate untracked list.


## 2026-09-04 (continued) — Phase 1 re-patch item 1 (auth CPU amplification) resolved
- Dispatched parallel Luna subagents (gpt-5.6-luna): one implementer in an isolated worktree
  (`.worktrees/auth-credential-lookup`, branch `patch/auth-credential-lookup`) plus two read-only
  design/security auditors in parallel. Converged design: bearer tokens become a strict
  `credentialId.secret` envelope; `authenticateLocalOperator` validates the UUID selector and
  secret byte length before any DB/KDF work, then looks up exactly one row by indexed
  `WHERE c.credential_id = $1` before deriving. No raw-secret fallback; existing active/revoked
  semantics and the scrypt concurrency guard preserved.
- Implementer delivered test-first (RED observed against the old unfiltered query), 8/8 focused
  unit tests, 9/9 real-PostgreSQL `auth.integration.test.ts`, full no-DB `npm run check` (351
  passed / 236 skipped / 0 failed), and migrated control-plane loopback/kill-restart fixtures to
  the new envelope.
- Two independent-review subagents (`luna-auth-independent-review`, `luna-auth-adversarial-review`)
  completed without sending a reply; per the dead-child protocol they were deleted rather than
  treated as silent acceptance. Per explicit user direction to continue without further subagents,
  the parent session performed the independent review directly: inspected the full diff, ran
  focused and full builds/tests itself, and diagnosed the two real-PostgreSQL `npm run check`
  failures (`apps/control-plane/src/main.integration.test.ts`,
  `main.kill-restart.integration.test.ts`) as a known node_modules-symlink artifact — confirmed by
  direct inspection that `main`'s compiled `packages/persistence/dist/auth.js` still carried the
  pre-fix signature at merge time, not a defect in the change. Verdict: ACCEPT.
- Merged to `main` (`fef8831`). Post-merge rebuild-and-reverify surfaced two *different*, real
  failures in fixtures the original diff hadn't touched (`read-state-parity.integration.test.ts`,
  `apps/secretary/src/cli-secretary-parity.integration.test.ts`), which still passed the raw
  secret alone as `MAESTRO_API_TOKEN`/api-client token. Fixed directly (no subagent, mechanical
  2-file change) in a second small worktree (`fix/auth-parity-fixtures`), self-verified with a
  full real-PostgreSQL `npm run check` (94/95 files, 590 passed, 2 intentional live-Prime skips, 0
  failed) before merging (`be490f8`). This second fix was self-verified only, not independently
  reviewed by a separate agent, given its mechanical scope and explicit user direction; noted here
  transparently rather than silently claiming full independent review.
- Final state on `main`: fresh `npm run build` + real-PostgreSQL `npm run check` both clean (94/95
  files, 590 passed, 2 intentional live-Prime skips, 0 failed). Worktrees, branches, and the
  disposable PostgreSQL container (`maestro-auth-credential-lookup-postgres`) removed.
- Next: continue Phase 1 re-patch items 2-8 in order (memory-bound eviction, remote-TLS fail-closed,
  production migration runner, fast-check fencing coverage, evidence-hash-corruption consumer
  tests, config credential-key test, restart-recovery/project-scope-auth P0s), each test-first,
  each independently reviewed before acceptance.

## 2026-09-04 (continued) — Phase 1 re-patch item 2 (unbounded in-process memory growth) resolved
- Implemented directly (no subagent, per explicit user direction), test-first, in an isolated
  worktree (`.worktrees/p1-memory-bound`, branch `patch/p1-memory-bound`), reusing the earlier
  Luna memory-audit findings from this session: eviction must be an explicit post-durable-write
  acknowledgement, never kernel-initiated (first observation/timer), since a retry after a failed
  durable write still needs the same terminal observation; an evicted invocation must report
  `"unknown"`, never a fabricated `"failed"`.
- `apps/control-plane/src/goal-service.ts`: `leaseProofs.delete(goalId)` once a command result
  reaches a terminal Goal state (`isTerminalGoalState`), never on a provider/DB/error path. 3
  focused unit tests (terminal eviction + re-acquire; nonterminal retains + renews; version
  conflict is not terminal and still renews).
- `packages/domain/src/execution-kernel.ts`: added optional `ExecutionKernelPort.release(invocation)`.
  `packages/prime-adapter/src/execution-kernel.ts` implements it (child release drops only that
  child; root release drops the root record and, only if no children still reference its
  execution, the underlying session too) and fixes a real correctness bug found while
  implementing: `getInvocationStatus` previously returned a fabricated `"failed"` for any
  unregistered/released invocation instead of the domain contract's actual `"unknown"`. 5 new
  kernel-level unit tests (13/13 total in that file).
- Wired `kernel.release` into every consumer that durably records a terminal Prime invocation
  outcome: `worker.ts`'s `observeWorker` (after a terminal status commits) and `cancelWorker`
  (after cancellation commits); `semantic-review.ts`'s `requestSemanticReview` (after its
  always-written row inserts, including the unparseable-output downgrade path);
  `encore-council.ts`'s `runEncoreCouncilReview` (after every reviewer's sealed judgment
  commits together in one transaction).
- **Self-review found and fixed a second real defect before merge**: every `kernel.release` call
  sat inside/adjacent to a try/catch whose catch rethrows, so a release failure would incorrectly
  surface as if the already-durably-committed operation itself had failed -- and in
  `encore-council.ts`, would additionally attempt a spurious `ROLLBACK` after an already-
  succeeded `COMMIT`. Fixed by making every release call best-effort (`.catch(() => {})`); added
  one dedicated regression per caller (`worker.ts` x2, `semantic-review.ts`, `encore-council.ts`)
  proving each still returns its durable result when the kernel's release call fails.
- Verification: real-PostgreSQL `npm test` (vitest directly, not blocked by the node_modules-symlink
  dist-staleness limitation that blocks `tsc -b`/`npm run build` in this worktree -- confirmed the
  same limitation from item 1 applies only to the TypeScript build step, not to vitest's own
  resolution) in the worktree: 94/95 files, 604 passed, 2 intentional live-Prime skips, 0 failed.
  Independent review performed by the parent session directly (no independent-review subagent
  spawned this pass, per explicit user direction to continue without further subagents), then
  merged to `main` (`eba0823`). Authoritative post-merge re-verification on `main`: fresh
  `npm run build` clean, full real-PostgreSQL `npm run check`: 94/95 files, 604 passed, 2
  intentional live-Prime skips, 0 failed. Worktree, branch, and the disposable PostgreSQL container
  (`maestro-p1-memory-bound-postgres`) removed.
- Next: Phase 1 re-patch item 3 (remote-TLS fail-closed) -- design already prepared this session by
  the earlier `luna-p1-tls-audit` child: optional paired `MAESTRO_TLS_CERT_FILE`/`MAESTRO_TLS_KEY_FILE`,
  required together whenever `MAESTRO_ALLOW_REMOTE=true`, wired through to a real Fastify HTTPS
  listener (not just config validation), with a composition-level regression proving a remote
  config without TLS never reaches `app.listen` as plain HTTP.

## 2026-09-04 (continued) — Phase 1 re-patch item 3 (remote bind without TLS) resolved
- Implemented directly (no subagent), test-first, in an isolated worktree
  (`.worktrees/p1-tls-fail-closed`, branch `patch/p1-tls-fail-closed`), reusing the design this
  session's `luna-p1-tls-audit` child already prepared: paired
  `MAESTRO_TLS_CERT_FILE`/`MAESTRO_TLS_KEY_FILE`, required together whenever the resolved host is
  non-loopback, wired through to a real Fastify HTTPS listener rather than only validated in config.
- `config.ts`: `MaestroConfig` gains an optional `tls: { certFile, keyFile }`; `parseConfig` rejects
  a remote bind (`MAESTRO_ALLOW_REMOTE=true` alone is no longer sufficient) missing either half of
  the pair with `"Remote binding requires TLS certificate and key configuration"`; a loopback bind
  ignores any supplied pair. `main.ts`'s `createControlPlane` enforces the same invariant again at
  the composition boundary per the audit's caller-boundary note (a caller can construct
  `MaestroConfig` directly, bypassing `parseConfig`), reads the cert/key files synchronously
  (failing closed on a missing/unreadable file before any `ControlPlane` object exists), and passes
  real bytes to `buildServer`'s new optional `https` param, which now constructs `Fastify({ https })`
  instead of always plain HTTP.
- A genuine TypeScript build defect was found and fixed during this slice (not present before):
  `Fastify(https ? { https } : {})`'s object-literal union made TS select an ambiguous Fastify
  HTTP2 overload instead of the intended HTTPS one, breaking `FastifyInstance`'s declared server
  type. Fixed with an explicit two-branch construction. Also discovered
  `apps/control-plane/dist/main.js` had never been built in this specific worktree (a worktree-setup
  gap, not a symlink-staleness issue this time) -- the real-process kill-restart integration test
  spawns that compiled file directly; `npm run build` in-worktree succeeded cleanly for this slice
  (no cross-package interface change this time, so no node_modules-symlink dist-staleness hit).
- Verification: a real-PostgreSQL composition test generates a genuine self-signed certificate via
  `openssl req -x509 ...`, proves `createControlPlane` throws synchronously for a remote bind with
  no TLS or an unreadable key file (before any listener exists), then proves a real HTTPS request
  (Node's `https.request` with `rejectUnauthorized: false`, since the test's own throwaway
  certificate is intentionally untrusted by the system CA store) against the configured listener
  succeeds while a plain-HTTP request to the same port fails outright (protocol mismatch, not
  silently downgraded). Full real-PostgreSQL `npm run check` (build + test) in the worktree: 94/95
  files, 609 passed, 2 intentional live-Prime skips, 0 failed -- both build and test clean this time.
- Independent review performed by the parent session directly (no independent-review subagent
  spawned, per explicit user direction to continue without further subagents this session), then
  merged to `main` (`3649279`). Post-merge re-verification on `main`: fresh `npm run build` and full
  real-PostgreSQL `npm run check` both clean: 94/95 files, 609 passed, 2 intentional live-Prime
  skips, 0 failed. Worktree, branch, and the disposable PostgreSQL container
  (`maestro-p1-tls-postgres`) removed.
- Next: Phase 1 re-patch item 4, the production-safe migration runner (`schema_migrations` ledger,
  checksums, single `pg_advisory_lock`, additive-only, wired into control-plane startup before
  `reconcileOnStartup`) -- design already prepared this session by the earlier
  `luna-p1-migration-audit` child, though that child completed without sending its findings back
  and was deleted per the dead-child protocol; this item's design work has not yet been redone.

## 2026-09-04 (continued) — Phase 1 re-patch item 4 (no production-safe migration runner, P0-adjacent) resolved
- Implemented directly (no subagent), test-first, in an isolated worktree
  (`.worktrees/p1-migration-runner`, branch `patch/p1-migration-runner`).
- `packages/persistence/src/migrate.ts`'s `runMigrations(pool)`: durable `schema_migrations` ledger
  (filename PRIMARY KEY, checksum, applied_at); a single fixed `pg_advisory_lock` key serializes
  concurrent callers database-wide for the call's duration (always released, even on error);
  applies only files not yet recorded (each in its own transaction, checksum recorded in the same
  transaction); fails closed with `MigrationChecksumMismatchError` if an already-recorded file's
  current content no longer matches its recorded checksum. Never drops or resets anything
  (additive-only), unlike the existing test-only `applyAllMigrations`. Wired into
  `apps/control-plane/src/main.ts`'s `ControlPlane.listen()`, before `reconcileOnStartup`, so a
  real process's schema is always current before any reconciliation or traffic.
- **A dedicated regression surfaced a real, non-hypothetical defect before merge**:
  apps/control-plane's own composition-root integration tests (`main.integration.test.ts`,
  `main.kill-restart.integration.test.ts`) already call `applyAllMigrations` in `beforeAll` and
  then `createControlPlane(...).listen()` against the same schema; once `.listen()` also calls
  `runMigrations`, several of the project's ~30+ migration files with a bare (non-idempotent)
  `CREATE TRIGGER` statement (first confirmed via `0013_council_briefs.sql`'s `head_councils`
  table) would fail "already exists" on that second, ledger-less pass. Fixed by making
  `applyAllMigrations` populate the same `schema_migrations` ledger (with each applied file's real
  checksum) instead of leaving it empty, so both runners share one ledger and neither re-executes
  DDL a second time -- rather than auditing/patching idempotency into dozens of individual
  migration files, which was judged out of this item's surgical scope.
- Verification: 6 real-PostgreSQL `migrate.integration.test.ts` cases -- fresh apply into an empty
  schema (ledger row per file), idempotent no-op re-run, incremental new-file apply leaving
  existing ledger rows untouched, two concurrent runners racing through the advisory lock (exactly
  one ledger row per migration, no duplicate-key error), checksum-mismatch rejection, and no
  re-execution against an `applyAllMigrations`-built schema -- all passed, the last only after the
  ledger-sharing fix above.
- Same-package tests (this file's own `.test.ts`) verified cleanly in the isolated worktree. The
  node_modules-symlink cross-package staleness limitation established in items 1-3 blocked both
  `tsc -b` and, this time, the real spawned-subprocess control-plane tests too (`runMigrations is
  not a function` / `does not provide an export named 'runMigrations'`) -- confirmed by direct
  inspection this is the same known limitation (a genuinely new runtime export from
  `@maestro/persistence`, not just a type change), not a real defect. Independent review performed
  by the parent session directly (no independent-review subagent spawned, per explicit user
  direction to continue without further subagents this session), then merged to `main` (`1828350`).
  Authoritative post-merge re-verification on `main`: fresh `npm run build` clean, full
  real-PostgreSQL `npm run check`: 95/96 files, 615 passed, 2 intentional live-Prime skips, 0
  failed. Worktree, branch, and the disposable PostgreSQL container
  (`maestro-p1-migration-postgres`) removed.
- User gave explicit go-ahead this session to also push to `origin` periodically as items land
  (not only local commits), superseding the prior "local commits only, ask before pushing" default
  for this session going forward.
- Next: Phase 1 re-patch item 5 (fast-check property-based fencing coverage), then items 6-8
  (evidence-hash-corruption consumer tests, config credential-key test, already-known
  restart-recovery/project-scope-auth P0s), before Phase 2's re-patch items.


## 2026-09-04 (continued) — Operating protocol designed via grill-me, extracted to docs/OPERATING_PROTOCOL.md
- Ran a grill-me PLAN MODE interview with the user to design the session-continuity/subagent-spawn protocol properly (rather than the earlier unilateral draft at commit 1fd3948). Decisions: keep task_plan.md as the first-read entry point but move detailed rules into a separate `docs/OPERATING_PROTOCOL.md` (English); scope covers this project first, plus a lightweight reusable pattern saved as a global memory for future projects.
- Amendments folded in: subagents default to `openai-codex/gpt-5.6-luna` (with `openrouter/openai/gpt-5.6-luna` as a same-model fallback before dropping to the inherited default), thinking level scaled medium/high/max by task difficulty; new worktrees symlink `node_modules` from `main` instead of a fresh `npm install`, with the exact caveat from the 2026-09-03 Phase 4 merge's stale-symlink incident; Karpathy guidelines declared the default engineering discipline for this repo.
- Live behavior test (grill-me's closing step, not skipped): created a throwaway worktree `.worktrees/protocol-test`, symlinked `node_modules` from main, ran `npm run build` clean from inside it, then deleted the worktree per the protocol's own lifecycle rule. Confirmed the `task_plan.md` -> `docs/OPERATING_PROTOCOL.md` pointer chain resolves.
- Committed at `d80adb0`. Saved a global cross-project memory (`session_continuity_operating_protocol_pattern_for_multi_session_software_project`) capturing the reusable pattern for future projects.


## 2026-09-04 (continued) — Phase 1 re-patch item 5 (fast-check property coverage) resolved
- Implemented directly (no subagent), in an isolated worktree (`.worktrees/p1-property-fencing`,
  branch `patch/p1-property-fencing`), reusing this session's earlier `luna-p1-property-audit`
  child's finding: `commands.ts` already has full fast-check property coverage
  (`fencing.property.test.ts`) across every `GoalLeaseProof`-bearing state-writing method;
  `reconciliation.ts`'s `renewReconcilerLeaderLease` was the one real remaining Phase-1 gap (it
  accepts a `ReconcilerLeaseProof` and mirrors `GoalLeaseProof`'s exact fencing semantics, but had
  only example/`it.each` tests). `auth.ts`/`authority.ts`/`evidence.ts` accept no lease/fencing
  proof at all, so a stale-fencing property does not meaningfully apply to them without an
  architectural change judged out of this item's scope.
- Added `packages/persistence/src/reconciliation.fencing.property.test.ts`: 3 fast-check
  properties -- every generated stale/forged fencing token, a wrong-owner proof at the real
  current token, and an old (pre-takeover) proof after genuine expiry and successor acquisition --
  each proving zero mutation of the singleton `reconciler_leader_lease` row and that the
  real/successor proof still works correctly afterward.
- Found and fixed a real test-authoring bug during first run: unlike Goal leases (a fresh
  `randomUUID()` goalId per property iteration), the reconciler lease is a single, fixed singleton
  row shared across every iteration of the same property; without truncating it at the start of
  each iteration, the second and later generated cases failed with
  `ReconcilerLeaseUnavailableError` (the still-unexpired lease from the first iteration). Fixed by
  truncating `reconciler_leader_lease` as the first step inside each property callback.
- Verification: 3/3 properties pass with real PostgreSQL (25 generated cases each for the first
  two, 15 for the takeover property, since it sleeps past a genuine 1ms expiry per case). Also ran
  alongside the existing `reconciliation.integration.test.ts` (shares the same table) to confirm no
  cross-suite race, matching this project's established `vitest.config.ts` `fileParallelism: false`
  precaution. Same-package test-only addition, so the node_modules-symlink cross-package staleness
  limitation from items 1-4 did not apply; both `npm run build` and the full real-PostgreSQL
  `npm run check` were clean in the isolated worktree on the first post-fix run: 96/97 files, 618
  passed, 2 intentional live-Prime skips, 0 failed.
- Independent review performed by the parent session directly (no independent-review subagent
  spawned, per explicit user direction to continue without further subagents this session), then
  merged to `main` (`6c40393`). Authoritative post-merge re-verification on `main`: fresh
  `npm run build` and full real-PostgreSQL `npm run check` both clean: 96/97 files, 618 passed, 2
  intentional live-Prime skips, 0 failed. Worktree, branch, and the disposable PostgreSQL container
  (`maestro-p1-property-postgres`) removed.
- Next: Phase 1 re-patch item 6 (evidence-hash-corruption tests at real certification/bundle/Concertmaster
  consumers, requiring a genuine production seam since none currently calls
  `verifyEvidenceRecord`) and item 7 (config credential-key exclusion test, test-only, no
  production change needed) -- both designs already prepared this session by the earlier
  `luna-p1-testgaps-audit` child.

## 2026-09-04 (continued) — Phase 1 re-patch item 7 (config credential-key exclusion test) resolved, item 6 deferred
- User asked which of item 6 (evidence-hash-corruption at real consumers, requiring a genuine
  production seam threaded through certifyQuality/certifyConditional/assembleEvidenceBundle/
  recordEvidenceBundle/generateConcertmasterFinalReport across ~15 call sites, many already-passing large
  capstone integration tests using synthetic evidence rows with no real backing content) or item 7
  (test-only, no production change, zod already excludes unknown keys) would produce a cleaner
  result done first. Recommended and the user agreed: item 7 first (small, isolated, zero blast
  radius), item 6 afterward with full attention rather than rushed alongside a long list of other
  work this session.
- Implemented item 7 directly (no subagent), in an isolated worktree
  (`.worktrees/p1-config-credential-test`, branch `patch/p1-config-credential-test`): one new
  `config.test.ts` regression supplying `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`OPENROUTER_API_KEY`
  metronomes alongside required config, asserting `parseConfig`'s result is unchanged and its
  output key set is exactly the eight accepted fields, with the serialized JSON never containing
  any of the metronome secret values. No production code changed (confirmed unneeded).
- Verification: 12/12 `config.test.ts` passed. Full real-PostgreSQL `npm run check` (build + test,
  both clean -- test-only addition, no node_modules-symlink cross-package staleness): 96/97 files,
  619 passed, 2 intentional live-Prime skips, 0 failed, in the isolated worktree on the first run.
- Independent review performed by the parent session directly (no independent-review subagent
  spawned, per explicit user direction to continue without further subagents this session), then
  merged to `main` (`9a1d084`). Authoritative post-merge re-verification on `main`: fresh
  `npm run build` and full real-PostgreSQL `npm run check` both clean: 96/97 files, 619 passed, 2
  intentional live-Prime skips, 0 failed. Worktree, branch, and the disposable PostgreSQL container
  (`maestro-p1-config-postgres`) removed.
- **Phase 1 status: items 1, 2, 3, 4, 5, 7 resolved and accepted; item 6 (evidence-hash-corruption
  at real consumers) deliberately deferred for its own dedicated, unhurried slice given its larger
  production-seam scope; item 8 (already-known restart-recovery/project-scope-auth P0s) remains
  open.** Next: item 6, or item 8, per user direction next session/turn.

## 2026-09-04 (continued) — Phase 1 re-patch item 6 (evidence-hash corruption at real consumers) resolved
- Implemented directly (no subagent), in an isolated worktree (`.worktrees/p1-evidence-hash-corruption`,
  branch `patch/p1-evidence-hash-corruption`), after user confirmed doing item 7 first (small,
  isolated) then returning to this larger item with full attention.
- Discovered empirically (not just estimated) that the whole test suite pervasively creates
  synthetic `evidence_records` rows (sha256 dummy value, `byte_length = 0`) via raw SQL across
  ~20+ integration test files, with no real backing artifact content. A mandatory content-
  verification requirement at the three consumers would have broken essentially the entire
  integration suite; judged out of this item's surgical scope to rewrite that pervasive
  convention. Instead threaded an *optional* `EvidenceContentReader` through the three consumers:
  when a caller supplies one, real content is verified before certification/bundle/report
  succeeds; when omitted, the existing metadata-only-trust behavior is unchanged. There is
  currently no production write-command API surface for these three actions at all (a separate,
  already-tracked P0), so no live caller exists yet to require a reader from -- this makes the
  seam available for that surface once it lands, closing the actual code-level gap the finding
  named without inventing a false "mandatory" claim this session cannot back with a real caller.
- Narrowed `@maestro/evidence`'s `verifyEvidenceRecord(record: EvidenceRecord, ...)` to
  `verifyEvidenceRecord(record: VerifiableEvidenceRecord, ...)` where
  `VerifiableEvidenceRecord = Pick<EvidenceRecord, "sha256" | "byteLength">`, since that is all it
  ever reads -- lets the three consumers pass a minimal shape built directly from their own
  `evidence_records` query rows without fabricating unused `EvidenceRecord` fields.
- `certification.ts`: `certifyQuality`/`certifyConditional` gained an optional 6th `content`
  parameter, threaded through the shared `createCertification`; when supplied, verifies each
  cited `testEvidenceId`'s real bytes in the same pre-INSERT check as the existing metadata
  allow-list, so a rejection writes no certification row.
- `evidence-bundle.ts`: `assembleEvidenceBundle`/`recordEvidenceBundle` gained an optional
  `content` parameter; when supplied, verifies *every* evidence record for the Goal (not only
  cited ones, since a bundle is meant to be a full immutable snapshot) before returning/recording.
- `concertmaster-report.ts`: `generateConcertmasterFinalReport` gained an optional `content` parameter, threaded
  through its existing internal `recordEvidenceBundle` call.
- Added one real-artifact corrupted-hash regression per consumer, each following
  `evidence.integration.test.ts`'s existing pattern (capture genuine content via
  `FileEvidenceStore`, disable the immutable trigger, `UPDATE evidence_records SET sha256 = ...`,
  re-enable the trigger): `certification.integration.test.ts` (repoint one cited evidence row at
  real content, certify successfully with a reader, corrupt a second cited row, prove rejection
  with no new certification and unchanged old behavior without a reader);
  `evidence-bundle.integration.test.ts` (minimal standalone Goal + one real evidence row, prove
  assemble/record succeed with a reader, corrupt it, prove rejection with no new bundle row);
  `concertmaster-report.integration.test.ts` (repoint every evidence row for the Goal at real content,
  since bundle assembly verifies all of a Goal's evidence not just cited ones, certify and
  generate a passing report with a reader, corrupt one row, prove rejection, confirm unchanged
  behavior without a reader).
- Verification: all three new tests passed on the first run (certification.integration.test.ts
  7/7, evidence-bundle.integration.test.ts 3/3, concertmaster-report.integration.test.ts 6/6). Full
  real-PostgreSQL `npm test` (vitest) in the worktree: 96/97 files, 622 passed, 2 intentional
  live-Prime skips, 0 failed. The node_modules-symlink cross-package staleness limitation from
  items 1-4 blocked `tsc -b` here again (a genuine cross-package type/value export from
  `@maestro/evidence`); confirmed the same known limitation, not a real defect.
- Independent review performed by the parent session directly (no independent-review subagent
  spawned, per explicit user direction to continue without further subagents this session), then
  merged to `main` (`384d1e3`). Authoritative post-merge re-verification on `main`: fresh
  `npm run build` and full real-PostgreSQL `npm run check` both clean: 96/97 files, 622 passed, 2
  intentional live-Prime skips, 0 failed. Worktree, branch, and the disposable PostgreSQL container
  (`maestro-p1-evidence-cert-postgres`) removed.
- **Phase 1 re-patch status: items 1-7 resolved and accepted, all merged to `main` and pushed to
  `origin`.** Only item 8 (already-known restart-recovery/project-scope-auth P0s from the first
  audit wave) remains open before Phase 1 as a whole can be re-claimed accepted and the 8-item
  execution order moves on to Phase 2's remaining items.

## 2026-09-04 (continued) — Phase 1 re-patch item 8 part 1/2 (project-scoped operator authorization) resolved
- Implemented directly (no subagent), in an isolated worktree (`.worktrees/p1-project-scoped-auth`,
  branch `patch/p1-project-scoped-auth`). Item 8 bundles two already-known P0s from the first audit
  wave; tackled the smaller/more contained one (project-scoped authorization) first, leaving the
  larger one (durable worker/session restart recovery) as its own dedicated slice.
- Confirmed by direct inspection: no project-membership concept existed anywhere in the codebase.
  `server.ts`'s `onRequest` hook authenticated the bearer credential but attached the resulting
  `operator` context with no further check; `goal-service.ts`'s `getGoal(goalId, projectId)`
  scoped its own DB query correctly (`WHERE goal_id = $1 AND project_id = $2`, so a wrong-project
  guess returns not-found) but nothing prevented any validly authenticated credential from acting
  on the *correct* projectId for a project it had no organizational right to touch at all.
- Added `packages/persistence/src/project-membership.ts` (migration `0049`): durable
  `operator_project_memberships` table, membership existence only for now (no per-action role/
  capability granularity yet -- documented as a future refinement, not silently over-claimed).
  Idempotent grant; one-way revoke; a revoked row can never be reactivated (unique partial index
  restricting one active row per operator/project, plus a no-reactivation trigger matching this
  codebase's existing credential-rotation convention), so granting again after a revoke creates a
  genuinely new row. A real defect was found and fixed mid-implementation: the first schema design
  used `(operator_id, project_id)` as the literal primary key, which structurally could not support
  "grant a new membership after revoke" at all (the row physically couldn't be re-inserted); fixed
  by switching to a surrogate `membership_id` UUID primary key with a partial unique index instead.
- Wired into `server.ts` via a new `preHandler` hook (distinct from the existing `onRequest`
  authentication hook, since body/query are not yet parsed at `onRequest` time): reads a `projectId`
  from the request's body or query when present and asserts durable membership before the route
  handler runs. The four read-state routes (Metronome/Council/certification/Concertmaster-report) carry no
  `projectId` field in their contract at all and are structurally not covered by this hook -- this
  is Phase 3's already-tracked IDOR item 6, explicitly not claimed fixed here. Added a new
  `"project_access_forbidden"` stable API error code. `buildServer`'s `projectMembership` param is
  optional so existing service-level unit tests that don't yet exercise it are unaffected;
  `main.ts`'s real composition always supplies a real checker backed by `assertProjectMembership`.
- Added 6 real-PostgreSQL `project-membership.integration.test.ts` cases and 5 new
  `server.test.ts` unit cases (allow with membership, reject without -- both create and transition
  -- confirm the four read-state routes are unaffected, confirm unchanged behavior when no checker
  is supplied). Updated the four existing composition-root integration tests (`main.integration`,
  `main.kill-restart.integration`, `read-state-parity.integration`, `cli-secretary-parity.integration`)
  to grant membership for their test operator, since they now compose the real enforced path.
- Verification: `project-membership.integration.test.ts` 6/6 passed on the first run after the
  primary-key redesign. Same-package/non-cross-package unit tests all passed cleanly in the
  worktree. The 5 cross-package composition test files hit the now well-established node_modules-
  symlink cross-package staleness limitation from items 1, 4, and 6 (confirmed by inspecting each
  exact failure -- `grantProjectMembership is not a function`, an enum-parse mismatch for the new
  error code -- both matching the known pattern, not a new regression). Full worktree `npm test`:
  92/98 files, 623 passed, 10 failed (all 5 expected-stale files), 2 intentional live-Prime skips.
- Independent review performed by the parent session directly (no independent-review subagent
  spawned, per explicit user direction to continue without further subagents this session), then
  merged to `main` (`fcd70b4`). Authoritative post-merge re-verification on `main`: fresh
  `npm run build` clean, full real-PostgreSQL `npm run check`: 97/98 files, 633 passed, 2
  intentional live-Prime skips, 0 failed -- all 5 previously-stale files now pass, confirming the
  staleness diagnosis was correct. Worktree, branch, and the disposable PostgreSQL container
  (`maestro-p1-project-auth-postgres`) removed.
- **Phase 1 re-patch status: items 1-7 and item 8 part 1/2 (project-scoped authorization) resolved
  and accepted, all merged to `main` and pushed to `origin`.** Only item 8 part 2/2 (durable
  worker/session restart recovery) remains open -- the single largest remaining Phase 1 item,
  requiring a durable session/invocation binding table, a real `reconcileOnStartup` that fences or
  cancels stale provider work (not just the existing structural Goal-state consistency scaffold),
  and a real process kill-and-restart acceptance test with an actively running worker.

## 2026-09-04 (continued) — Phase 1 re-patch item 8 part 2/2 (durable worker/session restart recovery) resolved; Phase 1 re-patch complete
- Implemented directly (no subagent), in an isolated worktree (`.worktrees/p1-restart-recovery`,
  branch `patch/p1-restart-recovery`), completing the second and larger half of item 8.
- Confirmed by direct inspection: `execution-kernel.ts`'s `resume()`/`reconnect()` intentionally
  always throw (`ExecutionKernelUnavailableError`) -- this is a genuine, correctly-documented Prime
  SDK constraint (an in-process session cannot be transparently resumed across a real process
  restart), not a defect to engineer around. The actual gap was narrower and more tractable than
  it first appeared: `reconcileOnStartup` already correctly leaves a worker under a still-live
  Goal lease untouched (`lease_contended`, protecting genuinely active execution -- proven by an
  existing Phase 2/3 test), but for a Goal whose lease has genuinely expired at restart (the
  "truly abandoned" case, not merely contended), nothing ever proactively re-observed that Goal's
  nonterminal workers -- they would sit "spawned"/"running" forever unless some unrelated future
  caller happened to call `observeWorker` on them again.
- Fixed by threading an optional `kernel: ExecutionKernelPort` into `reconcileOnStartup`. Since a
  kernel constructed fresh at process startup (`createPrimeExecutionKernel()` in `main.ts`) always
  begins with empty `sessions`/`roots`/`children` maps (per `execution-kernel.ts`), forcing every
  nonterminal worker under a Goal with a non-live lease through a fresh `observeWorker` call can
  only ever honestly downgrade a genuinely dead session to `"unknown"` via the already-existing
  empty-observation fallback (Phase 1 item 2) -- it structurally cannot fabricate a status or
  accidentally resume real work, since a truly-still-running session's execution ref simply
  wouldn't exist in a brand-new kernel's maps at all if the owning process actually died. Added
  `reconciledWorkerIds` to `GoalReconciliationResult` for durable evidence of what this pass
  touched. Wired the real kernel into `main.ts` (added `@maestro/prime-adapter` as a genuine
  control-plane dependency + tsconfig project reference, since it wasn't one before).
- Added 3 new real-PostgreSQL regressions in `worker.integration.test.ts` (alongside the existing
  "genuinely mid-flight, lease still contended" test from Phase 2/3 work): a genuinely orphaned
  running worker (lease actually expired) is forced to `"unknown"` at startup through a fresh
  kernel; a worker whose lease is still live is left untouched; supplying no kernel at all leaves
  prior behavior completely unchanged. Updated `reconciliation.integration.test.ts`'s and
  `worker.integration.test.ts`'s existing exact-object `toEqual` assertions for the new field.
- Verification: `worker.integration.test.ts` 15/15 passed (3 new) against real PostgreSQL on the
  first run; `reconciliation.integration.test.ts` 11/11 passed; the item 5
  `reconciliation.fencing.property.test.ts` 3/3 passed unaffected. Full worktree real-PostgreSQL
  `npm test`: 97/98 files, 636 passed, 2 intentional live-Prime skips, 0 failed -- clean this time
  (the field addition to `ReconcileOnStartupOptions` is additive/optional and `reconcileOnStartup`'s
  own exported name/signature shape was already resolvable via the stale symlinked
  `@maestro/persistence` dist, so no cross-package *test* failures this pass, unlike items 1, 4, 6,
  and 8-part-1). `tsc -b` itself still hit the established node_modules-symlink staleness
  limitation for the new `kernel` field's *type* specifically (confirmed by the exact TS2353
  error), resolved by the standard post-merge rebuild.
- Independent review performed by the parent session directly (no independent-review subagent
  spawned, per explicit user direction to continue without further subagents this session), then
  merged to `main` (`9e39822`). Authoritative post-merge re-verification on `main`: fresh
  `npm run build` clean, full real-PostgreSQL `npm run check`: 97/98 files, 636 passed, 2
  intentional live-Prime skips, 0 failed. Worktree, branch, and the disposable PostgreSQL container
  (`maestro-p1-restart-postgres`) removed.
- **Phase 1 re-patch is now fully complete: all 8 items (1-8, including both halves of item 8)
  resolved, merged to `main`, and pushed to `origin`.** Every item was implemented test-first,
  self-verified against real PostgreSQL, independently reviewed by the parent session directly
  (no independent-review subagent was reliably available this session), merged, and re-verified on
  `main` before the next item began -- matching this project's own worktree/review/merge discipline
  throughout. A genuine second real defect was caught and fixed during self-review at least twice
  this session (item 2's release-error-masking bug; item 8-part-1's unreachable-primary-key design)
  before merge, and one real production-code defect was caught by a dedicated regression before
  merge in item 4 (the shared-migration-ledger gap). Per this project's own acceptance policy, a
  formal independent (no-edit) review of the full Phase 1 re-patch diff by a separate reviewer
  remains the recommended next step before Phase 1 is formally re-accepted; the parent session's
  own review this session substituted for that step throughout due to independent-review subagents
  being unavailable/unreliable for most of this session.
- Next: per the re-patch execution order (`task_plan.md`), Phase 2's remaining items 1-9 are now
  the front of the queue -- starting with item 1, the P0 empirically-reproduced budget-reservation
  double-counting defect (78% overspend undetected against real PostgreSQL in the original audit).

## 2026-09-04 (continued) — Phase 2 re-patch item 1 (budget reservation double-counting, P0) resolved
- Implemented directly (no subagent), in an isolated worktree (`.worktrees/p2-budget-fix`, branch
  `patch/p2-budget-fix`). First Phase 2 re-patch item, now that all 8 Phase 1 items are complete.
- Confirmed the exact defect by direct inspection: `reserveGoalBudget`/`reserveDepartmentBudget`/
  `reserveMissionBudget` are all strictly append-only (each call inserts a new row, never mutates
  a prior one). The Department- and Mission-level overrun checks summed only rows whose
  `parent_reservation_id` matched the single newest parent row
  (`ORDER BY created_at DESC LIMIT 1 FOR UPDATE`), so any allocation parented to a now-superseded
  envelope row became invisible to the check the next time that envelope was re-reserved --
  exactly reproducing the original audit's finding (reserving the same 100,000-cent Goal ceiling
  twice let a Department allocate 160,000 cents against it, 78% over budget, zero rejection).
  `concertmaster-report.ts`'s own `departmentSpend` query was already summing by `goal_id` (the wider,
  correct scope), so enforcement and reporting were genuinely inconsistent with each other, as the
  original finding also named.
- Fixed both overrun checks to sum by the durable Goal/Department identity instead of the single
  newest parent reservation: `reserveDepartmentBudget` now sums `WHERE goal_id = $1 AND
  scope = 'department'`; `reserveMissionBudget` now sums `WHERE council_id = $1 AND
  department_id = $2 AND scope = 'mission'` -- both across every envelope revision. This makes
  enforcement's aggregation scope identical to `concertmaster-report.ts`'s existing (already-correct)
  query, closing the consistency gap directly rather than inventing a new aggregation concept.
- Added 3 new real-PostgreSQL regressions in `budget-reservation.integration.test.ts` reproducing
  the exact audit scenario at both levels: re-reserve the parent envelope at the same amount (no
  CEO approval needed, since it's not an increase), then prove the second allocation that would
  have wrongly succeeded under the old parent-scoped sum is now rejected, while a smaller amount
  that fits the *true* remaining allocatable room still succeeds correctly.
- Verification: 8/8 `budget-reservation.integration.test.ts` cases passed (3 new) on the second
  run (the first run caught and required fixing an amount-sizing mistake in the mission-level test,
  where the department-level fix I had just made was ALSO correctly rejecting the test's own
  department-level setup amounts before the mission-level scenario could even be exercised --
  adjusted the test's Goal/Department amounts to isolate the mission-level check specifically).
  Full real-PostgreSQL `npm run check` (build + test, both clean -- no cross-package export
  change, purely an internal query-scope fix): 97/98 files, 638 passed, 2 intentional live-Prime
  skips, 0 failed, in the isolated worktree on the first post-fix run.
- Independent review performed by the parent session directly (no independent-review subagent
  spawned, per explicit user direction to continue without further subagents this session), then
  merged to `main` (`5360b9d`). Authoritative post-merge re-verification on `main`: fresh
  `npm run build` and full real-PostgreSQL `npm run check` both clean: 97/98 files, 638 passed, 2
  intentional live-Prime skips, 0 failed. Worktree, branch, and the disposable PostgreSQL container
  (`maestro-p2-budget-postgres`) removed.
- Next: Phase 2 re-patch item 2 (Mission Assignment Bundle capability scoping never reaching the
  real Prime Agent spawn call -- `SpawnRequest` has no field for `allowedSkills`/`allowedTools`/
  `allowedPaths`/`authorityBoundary`, so "Scout workers are read-only by default" is currently
  unenforced anywhere).
## 2026-09-04 (continued) — Doc/repo sync on resume; Phase 2 re-patch item 2 confirmed merged
- Session resume found a doc/repo mismatch: `main` already carried commit `efc40c8` ("merge:
  Phase 2 re-patch item 2 -- thread Mission Bundle capability scoping to real spawn call",
  merging `6d791d5`), but `task_plan.md` still listed that item as open `[HIGH, test quality]`
  and `progress.md`'s last entry described it as "next" work not yet done. Per the operating
  protocol ("if they disagree, trust the repo and correct the docs, not the reverse"), updated
  `task_plan.md` item 2 to `[RESOLVED]` with the real commit evidence (SpawnCapabilities threaded
  to the real Prime Agent spawn call via `allowedToolNames`; scout-read-only *enforcement* and
  path/authority-boundary scoping deliberately left out of this item's scope, per the commit's own
  documented rationale) and updated the Phase 2 status line from `[not_started]` to `[in_progress]`
  (items 1-2 resolved, 3-9 open).
- Also found and removed a stale merged worktree/branch left over from that work:
  `.worktrees/p2-capability-scoping` (branch `patch/p2-capability-scoping`, already merged at
  `6d791d5`) -- per this project's own worktree-hygiene rule (delete immediately after merge, do
  not let it linger). No disposable PostgreSQL containers were left running.
- No code change in this entry, doc/environment sync only. Next: Phase 2 re-patch item 3 (team-lead
  grant cost/duration/scope ceilings stored but never enforced at `spawnHelperWorker` time).

## 2026-09-04 (continued) — Real build defect found and fixed; 9 parallel Claude Sonnet 5 subagents dispatched
- Before dispatching parallel work, `npm run build` on `main` HEAD (`fccc922`) failed for real
  (confirmed directly, not a worktree/symlink-staleness artifact): item 2's merge
  (`efc40c8`/`6d791d5`) passed `capabilities: request.capabilities` (possibly `undefined`)
  explicitly into `factory.create(...)`, which `exactOptionalPropertyTypes: true` rejects (the key
  must be omitted, not set to `undefined`). Fixed by conditionally omitting the key
  (`packages/prime-adapter/src/execution-kernel.ts`), commit `090dcbd`. Full real-PostgreSQL
  `npm run check` on `main` after the fix: 97 passed / 1 skipped files, 642 passed / 2 skipped
  tests, 0 failed. Docker is now available in this runtime (was previously unavailable this
  session; user confirmed it was turned on).
- Per user direction to move fast with several parallel Claude Sonnet 5 subagents, dispatched 9
  children (`model=anthropic/claude-sonnet-5`), each in its own worktree/branch created from
  `090dcbd`, each with a disjoint file scope to avoid merge conflicts, each told to test-first,
  self-verify only (not self-accept), use its own uniquely-named disposable PostgreSQL container,
  stay in scope, and reply via `agent_message` when done:
  - `p2-team-lead-ceilings` (Phase 2 item 3, medium thinking): team-lead-grant.ts ceiling enforcement.
  - `p2-persona-overlay` (Phase 2 item 4, medium thinking): mission-bundle.ts persona overlay.
  - `p2-head-control-latch` (Phase 2 item 5, high thinking): head-participation.ts control-latch check.
  - `p2-worker-output-race` (Phase 2 item 6 + Phase 3 item 1's certification.ts part, high thinking):
    certification.ts race fix + fencing/control-latch on certifyQuality/certifyConditional/waiver/
    conflict-adjudication.
  - `p2-git-path-containment` (Phase 2 item 7 + item 8's git-integration.ts fencing test, high
    thinking): git-integration.ts/git-ops.ts path containment.
  - `p2-fencing-coverage` (Phase 2 item 8 remaining modules, medium thinking): stale-fencing tests
    only for council.ts, department-plan.ts, device-grant.ts, environment.ts, discord-incident.ts,
    metronome-challenge.ts (test-only, no production edits).
  - `p3-evidence-concertmaster-hardening` (Phase 3 items 1/2/3/4/5's evidence-bundle.ts+concertmaster-report.ts parts,
    max thinking): fencing/control-latch, transactional assembly, per-Goal idempotency, missing
    evidence sources, budget-exceeded blocker.
  - `p3-encore-control-latch` (Phase 3 item 1's encore-council.ts part, high thinking):
    fencing/control-latch before any real reviewer subagent spawn.
  - `p3-idor-readstate` (Phase 3 item 6, high thinking): add `projectId` to the four read-state
    routes/contracts/service/API-client, matching `getGoal`'s existing pattern.
- All 9 admitted and running in parallel as of this entry; none have replied yet. Each owns a
  disjoint file set by design (certification.ts is deliberately split by concern between
  `p2-worker-output-race` sequentially, not shared with any other agent). Next: wait for each
  child's real reply (or apply dead-child protocol per docs/OPERATING_PROTOCOL.md section D.2 if
  one stalls/errors), independently review each diff directly (no independent-review subagent
  layer this round, per established practice this session), merge one at a time to `main` with
  re-verification, then update `task_plan.md`/this file per item and proceed to Phase 3's remaining
  items (7) and Phase 4's Track A/B items.


## 2026-09-04 — Phase 2 re-patch item 3 review blocked pending cost-accounting decision
- Resumed against clean `main` at `d931bd2`; repository state showed Phase 2 items 5 (`9157324`) and 8 (`bcbd15b`/`e160af5`) already merged even though the remediation text was stale. The first still-open Phase 2 item is item 3.
- Independently reviewed the clean candidate `patch/p2-team-lead-ceilings` commit `9135765`. Its duration check (grant age) and scope check (Department Plan version) are concrete, but its proposed cost enforcement parses a free-text string such as `1 USD` and charges an invented one unit per helper. No actual/estimated worker cost field or pricing unit exists in the repository, so this cannot truthfully enforce a monetary ceiling.
- Result: **NOT ACCEPTABLE; not merged.** Recorded the blocker in `task_plan.md`. Next requires a user decision defining the helper-spawn cost accounting source/unit (or explicitly changing the ceiling to a non-monetary helper-count rule). The candidate worktree and its disposable PostgreSQL container remain intact pending that decision.


## 2026-09-04 (continued) — Phase 2 re-patch item 4 (Mission persona overlay) resolved; no subagents this pass
- Per user direction, working sequentially without subagent delegation for this pass. Reviewed the
  ready `p2-persona-overlay` candidate worktree (branch `patch/p2-persona-overlay`, commit
  `06fab8d`) directly.
- Confirmed scope match against the item 4 finding text (derivation + mission-lifetime expiry +
  [0,1] bounds test + post-mission unavailability test -- explicitly not real-spawn wiring, unlike
  item 2). `deriveMissionPersonaOverlay` averages Department-style and Head-choice ten-axis
  profiles then nudges per-axis by four [0,1] scalar factors, clamping every axis before
  re-validation. `mission_persona_overlays` (migration `0050`) is append-only with a DB-level
  axis-bounds trigger, idempotent issuance, and expiry-aware reads.
- Verified independently (no-edit read of the diff) in the candidate worktree: `npm run build`
  clean; full real-PostgreSQL `npm run check`: 97/98 files, 660 passed, 2 intentional live-Prime
  skips, 0 failed. Focused re-run of the two new test files alone: 34/34 passed, including the
  new "expires correctly once the mission's explicit lifetime bound has passed" case (previously
  untestable per Phase 2 Tests #11).
- Merged to `main` (`b294a95`). Post-merge re-verification on `main`: fresh `npm run build` clean;
  full real-PostgreSQL `npm run check`: 97/98 files, 672 passed, 2 intentional live-Prime skips, 0
  failed. Worktree, branch, and disposable PostgreSQL container removed. Pushed to `origin/main`
  per explicit user go-ahead this session.
- Also corrected the Phase 2 remediation-plan "Status" summary line, which was stale even before
  this pass (items 5 and 8 were already merged in a prior session but the summary line still said
  "items 3-9 not started").
- Next: Phase 2 item 6 (`acceptDepartmentWorkerOutput` unguarded check-then-insert race), reviewing
  the ready `p2-worker-output-race` candidate worktree. Item 3 stays blocked pending the user's
  cost-accounting decision.


## 2026-09-04 (continued) — SQL migration terminology cleanup and Phase 2 item 3
- Closed all child workers after the interrupted review session and continued directly in the root checkout.
- Reviewed and merged the SQL migration cleanup (`ad0c888`): historical migration filenames and SQL identifiers now use Concertmaster, Discord, Metronome, and Encore terminology; redundant rename migrations were removed. The migration reset integration test received a 30-second timeout because the real PostgreSQL Docker run exceeded the old 5-second test default; its focused verification passed 2/2.
- Reviewed and merged `bef23a1` as `7c22714`: team-lead helper spawning now enforces duration and exact Department Plan version ceilings. Monetary cost enforcement remains explicitly deferred because no real per-helper cost source or accounting unit exists. Focused real-PostgreSQL verification passed 7/7.
- Full merged-tree verification passed with a fresh disposable PostgreSQL database: `npm run check` reported 97/98 files passed, 680 tests passed, 2 intentional live-Prime skips, and 0 failures. Next is Phase 2 item 6, followed by items 7 and 9, then Phase 3-5.


## 2026-09-04 (continued) — Phase 2 item 6 already resolved
- Direct inspection found the acceptance race was already fixed in `c50d142`, which uses an atomic `ON CONFLICT DO NOTHING` insert and durable re-read. That commit also fixed the certification write guards tracked as the certification portion of Phase 3 item 1.
- The merged main tree's fresh real-PostgreSQL check passed 97/98 files, 680 tests, 2 intentional live-Prime skips, and 0 failures. Task-plan status was corrected before moving to the next open item.
- Next: Phase 2 item 7, Git repository/worktree path containment.


## 2026-09-04 (continued) — Phase 2 item 7 Git path containment resolved
- Implemented `MAESTRO_WORKTREE_ROOT` containment in `packages/git-adapter/src/path-containment.ts`.
  Every local Git operation now canonicalizes repository/worktree paths and rejects paths outside
  the configured root, including symlink escapes and paths whose final worktree does not yet exist.
  Missing or invalid root configuration fails closed.
- Added the same guard at the persistence boundary in `git-integration.ts` before opening a
  transaction for caller paths and before using repository/worktree paths loaded from durable rows.
  Canonical paths are stored and returned for new Git integration records. Added outside-path,
  missing-root, symlink, and no-invocation regression coverage.
- Added the required test-only `/tmp` root setup and documented the production environment variable
  in `.env.example`.
- Direct review and fresh verification on `main`: `npm run check` with a disposable PostgreSQL
  16 container passed **98/99 files**, **685 tests**, **2 intentional live-Prime skips**, and **0
  failures**. Focused path tests passed 10/10. Commit: `cc751ff`.
- Next: Phase 2 item 8 remaining fencing coverage, then Phase 2 item 9's authorized effect
  executor boundary, before proceeding to the remaining Phase 3–5 work.


## 2026-09-04 (continued) — Phase 2 item 8 fencing coverage resolved
- Added real-PostgreSQL stale/forged fencing regressions for the remaining Phase 2 write modules:
  all three budget reservation scopes, Mission Bundle creation, team-lead grant/helper
  spawn/revocation, and Goal/Department/worker Git integration writes. Each test checks zero
  durable mutation under a forged token and successful recovery with the current proof.
- Focused verification passed: budget reservations 9/9, Mission Bundles 18/18, team-lead grants
  8/8, and Git integration 6/6. Build and diff checks were clean. Commits: `b397305`, `a378b06`.
- Next: Phase 2 item 9, the missing AuthorizedEffectExecutor enforcement around effect adapters.


## 2026-09-04 (continued) — Phase 2 item 9 / Phase 5 Track A item 2 Git authority boundary resolved
- Replaced the unauthenticated `localGitPort` export with `createLocalGitPort`, which requires an
  `AuthorizedEffectExecutor`-compatible authority gateway. Branch creation/advancement, worktree
  creation/removal, commits, and revision reads now all build an exact scoped action request and
  invoke the authority gateway before the private Git subprocess helper can spawn `git`.
- Added ordinary classifications for the local Git actions and wired `createControlPlane` to expose
  an authority-backed `createGitPort` factory using the durable PostgreSQL authority repository.
  Test-only real-Git fixtures now also use `AuthorizedEffectExecutor`, rather than bypassing it.
- Added real ephemeral-repository regressions for expired, forged-actor, and out-of-scope grants;
  each is rejected before a branch appears. Focused Git tests passed 11/11 and `npm run build`
  passed. Full disposable-PostgreSQL verification remains the next gate before commit.


## 2026-09-04 (continued) — Phase 3 items 1-2 guarded aggregation effects resolved
- Added `withGoalAuthority`, a shared transaction helper that validates the exact Goal lease proof,
  locks the lease and control rows, and checks pause/stop/emergency-stop state before work begins.
- `assembleEvidenceBundle`/`recordEvidenceBundle`, `generateConcertmasterFinalReport`, and
  `runEncoreCouncilReview` now require a `GoalLeaseProof`. Evidence and report assembly use the
  locked client for all reads and writes; the report's evidence bundle and report row commit together.
  Encore reviewer provider work and sealed-round writes stay inside the same authorized transaction.
- Added real-PostgreSQL stale-token and paused-Goal regressions for each module. Focused verification
  passed **19/19** (evidence bundle 4, Concertmaster report 7, Encore Council 8); build passed.
- The guard permits `active` and `certifying` Goals for aggregation/report effects, while all pause,
  stop, and emergency-stop latches remain fail-closed. Next: Phase 3 item 3 report idempotency.


## 2026-09-04 (continued) — Phase 3 items 3-4 report integrity and replay completeness resolved
- Added migration `0037_concertmaster_report_goal_uniqueness.sql` with a unique final-report-per-Goal
  index. Report generation now returns the immutable existing report on retries while holding the
  Goal authority transaction, preventing duplicate reports and duplicate evidence snapshots.
- Extended the evidence bundle with durable authority records/decisions, sealed Council brief
  payloads, and Head participation/activation history. The report documents and atomically commits
  its explicit link to the immutable bundle rather than creating a circular self-reference.
- Added repeat-generation and replay-source assertions to the real-PostgreSQL report/evidence tests.
  Build and focused report/evidence verification passed; full disposable-PostgreSQL verification is
  the next gate for this combined slice. Phase 3 budget correctness is now covered by immutable actual-cost accumulation and a report blocker; next open Phase 3 item is read-route project authorization.


## 2026-09-04 (continued) — Phase 3 item 6 derived-read IDOR closed
- Added mandatory `projectId` to Metronome, Encore Council, certification, and Concertmaster report
  read contracts. The HTTP membership hook rejects a cross-project binding before the read handler,
  while `createReadStateService` independently verifies the Goal/project pair against PostgreSQL.
- Updated the typed API client and CLI so every derived Goal read supplies the project binding.
- Added real app/API/CLI parity coverage for all four cross-project attempts; build and focused
  server/CLI/API tests pass.


## 2026-09-04 (continued) — operational Goal discovery and budget reads
- Added project-scoped `GET /v1/goals` and `GET /v1/goals/:goalId/budget` routes. The budget summary
  keeps latest envelope, planned allocations, and immutable actual spend distinct. Both routes reuse
  the membership hook and durable Goal/project verification.
- Added typed API-client methods and CLI commands: `goals list` and `budget get`. The real parity
  fixture now checks both surfaces and confirms cross-project rejection for all derived reads.


## 2026-09-04 (continued) — effect gateway composition tightened
- Exposed the same durable `AuthorizedEffectExecutor` from `createControlPlane` as the required
  runtime/browser authority gateway. Git, runtime, and browser adapter constructors remain gateway
  required; no unauthenticated adapter constructor is available. Full production orchestration of
  runtime/browser commands remains part of the write-API work, while Git deny-before-spawn coverage
  is complete.


## 2026-09-04 (continued) — Task Contract intake made user-facing
- Added typed Task Contract HTTP routes for create/read/amend, Overture role selection, exact
  confirmation, and launch. The control-plane service enforces project binding and does not disclose
  contracts from another project.
- Added matching contracts, API-client methods, and CLI commands. Create retries are idempotent by
  contract identity/content; Overture selection retries are idempotent by command identity; amended
  content retries return the already-current contract; project boundaries cannot change.
- Added route, client, CLI, persistence, and real loopback control-plane integration regressions.
  Build and focused suites pass; full disposable-PostgreSQL `npm run check` remains the checkpoint.
- Remaining usability gap: the launched contract is not yet linked to Goal creation, and dependent
  Head/Council/Plan/worker/Git/report write commands are not yet exposed through HTTP/CLI.

- 2026-09-05: Read the current non-archive `plan/` set and held a three-agent Luna council. Consensus: (1) Runtime durable worker/provider ownership and recovery; (2) Device real mTLS/signed Goal grant/local validation, parallel-safe but accepted after Runtime contract; (3) Secretary safety console/live durable stream. Boundaries and real-process/PostgreSQL acceptance gates are recorded in `plan/phase5-execution-slices.md`.
- 2026-09-05: Agent observation request rejected because `agent_observe` max_chars is capped at 2000; retried with the supported bound.

## Active execution plan — Phase 5 through Phase 6

**Started:** 2026-09-05. **Rule:** one slice at a time; no self-acceptance; every claim needs fresh evidence.

### Phase 5 operational completion
1. **Runtime recovery (Track A1):** durable worker/provider ownership, heartbeat/lease/fencing, two-phase cancellation, conservative restart recovery, real process-backed provider scenario.
2. **Device authority (Track B1–B2):** separately running authenticated device agent, signed short-lived Goal/project/device/path/fence grant, local validation, server recheck, zero-effect negative cases.
3. **Production orchestration (Track A3):** authenticated HTTP/CLI lifecycle from Task Contract through Goal, Head/Council/Plan/Mission/worker/Git/Metronome/certification/report, with no second authority path.
4. **Approval path (Track A5):** user-facing critical-action request, CEO approve-and-run, exactly-once durable effect.
5. **Metronome loop (Track A6):** scheduled/event-driven observation with complete rule coverage and durable findings.
6. **Secretary parity (Track A7):** project/Goal discovery, durable read/write console, SSE/poll fallback, abort-safe transport, CLI/API/UI parity.
7. **Remaining device hardening (Track B3–B8):** signed command/receipt, revocation cascade, typed scopes, disconnect lifecycle, device Metronome rules, automatic grant closure.
8. **Phase 5 exit:** real PostgreSQL, real control-plane/device/provider processes, no duplicate execution, no unauthorized side effect, independent review, clean worktrees/branches.

### Phase 6 bounded improvement
1. Durable evidence/improvement artifact chain and provenance.
2. Encore curation, replay/shadow evaluation, candidate policy and ten-axis adaptation.
3. Approval, rollback, versioning, cross-Goal knowledge boundaries, cost/safety gates.
4. Real replay/shadow/live separation tests and Phase 6 exit evidence.

### After Phase 6
Re-read all findings, then re-patch Phases 1→4 in order against real operational scenarios. Remove this active plan only after the Phase 6 work and its evidence are complete; append the final implementation/results/remaining-risk record instead.

**Current slice:** Phase 5 Track A1 — runtime provider ownership and restart recovery. Existing in-flight edits are in `.worktrees/phase5-runtime-recovery`; they are uncommitted and not accepted.

- 2026-09-05: Took over the in-flight Phase 5 Runtime worktree directly; no further subagent implementation is being used. The dirty slice adds durable worker owner/fencing/heartbeat/recovery/cancellation fields, migration `0061_worker_runtime_ownership.sql`, conservative restart fencing, and worker integration regressions. `npm run build` passed; with disposable PostgreSQL, worker integration passed 22/22 and reconciliation integration passed 11/11. The slice is not accepted yet: real separately-running provider/control-plane recovery, full process kill/restart evidence, independent review, and helper-worker ownership coverage remain open.


## 2026-09-05 — Phase 5 Track A1 runtime recovery: focused completion plan

- **Plan before next patch:** (1) finish helper-worker reserve→provider-spawn→bind with durable owner/fence fields and retry blocking after an unknown helper; (2) require worker observations to carry the current Goal lease proof; (3) keep provider/process ownership fields out of the current public Worker wire contract until the Secretary read model is deliberately extended; (4) bound control-plane provider/application/database shutdown drains; (5) add stale-owner and provider-failure regression evidence; (6) run focused PostgreSQL suites, control-plane HTTP/process checks, build, and full check before commit/push.
- **Concrete findings:** helper workers previously called the provider before inserting a durable row, so a crash could leave an unowned child execution; strict `WorkerSchema` parsing would reject the new internal ownership fields when the service returned raw persistence workers; `observeWorker` could write without a Goal proof; shutdown awaited provider close without a bound.
- **Scope fence:** this pass changes only the Phase 5 runtime worktree and runtime-related tests/config; Electron/Secretary root changes remain untouched.
- **Acceptance state:** not accepted yet. Independent review and the required separately-running provider/control-plane kill-and-restart evidence remain open after the focused fixes.


## 2026-09-05 — Phase 5 Track A1 process-gate plan

- **Plan before harness patch:** add a test-only JSON-lines provider process (no production provider behavior) implementing the same `ExecutionKernelPort` boundary; drive worker creation through a real loopback HTTP control-plane listener; kill the provider and abandon the first control-plane owner; expire the Goal lease; start a fresh provider/control-plane pair; prove startup reconciliation fences the worker once, preserves opaque refs, blocks retry, and performs zero duplicate provider spawns.
- **Evidence to collect:** provider OS child exit signal, HTTP worker response, PostgreSQL owner/status/recovery-decision rows, successor HTTP read, retry status, successor provider spawn count, build, focused suites, and full PostgreSQL check.
- **Scope fence:** test harness plus runtime tests only; no Electron/Secretary source changes and no changes to the production Prime adapter's honest no-resume boundary.


## 2026-09-05 — Phase 5 Track A1 focused-suite finding

- The runtime-focused suites passed **70/71** tests. The only failure was the pre-existing HTTP lifecycle fixture expecting a second spawn after a fake provider returned `cancelled:false` and an empty observation. The new conservative contract correctly persisted `unknown` and blocks retry; the fixture must model explicit provider cancellation before continuing to certification/acceptance.
- This is a test-fixture contract correction, not a relaxation of unknown-state safety. The dedicated worker and helper regressions already prove unknown retry blocking.


## 2026-09-05 — Phase 5 Track A1 process-gate evidence checkpoint

- The real process-backed provider/control-plane test now passes: a provider OS process and HTTP control-plane owner are killed, the Goal lease is expired, and a successor pair fences the orphaned worker exactly once. PostgreSQL preserves opaque execution/invocation refs, records `unknown`/`fenced`, and the successor provider performs zero duplicate spawns.
- Focused runtime suites pass **48/48** after correcting one fixture to use provider-confirmed cancellation rather than retrying an `unknown` worker. `npm run build` passes. Full `npm test` is running as the final broad regression checkpoint; no acceptance claim is made until it finishes and the independent no-edit review is received.
- Reconciliation now releases its short-lived Goal lease after a durable `recovering` transition. This ensures the durable Goal state, not a stale reconciliation lease, explains subsequent write blocking.


## 2026-09-05 — Phase 5 Track A1 independent review gate

- Independent no-edit review blocked acceptance on four concrete points: stale-owner helper mutations were not lease-guarded; recovery/spawn lock order could deadlock; cancellation could issue a provider effect after lease turnover; and the process test used in-process control-plane objects rather than two killed/restarted control-plane processes.
- **Next patch plan:** (1) guard every worker mutation with the current Goal lease and require the owner proof for pending rows; (2) standardize Goal-lease-before-worker locking and add a concurrent recovery/spawn test; (3) serialize provider cancellation under the Goal/worker owner claim; (4) harden the DB owner/recovery triggers; (5) replace the process-gate fixture with separately spawned control-plane processes sharing a surviving provider; then rerun focused and broad checks.
- The first three corrections and trigger hardening are implemented in the runtime worktree and focused tests pass **39/39** plus build. The true two-control-plane process gate remains open.


## 2026-09-05 — Phase 5 Track A1 review blockers resolved

- Implemented the independent-review corrections: every worker state mutation now requires the live Goal lease and owner proof; `Goal lease → worker` lock order is consistent across spawn, helper, observation, cancellation, and restart recovery; provider cancellation runs under a serialized Goal/worker owner claim; owner-transfer and append-only recovery triggers are bound and deletion-safe.
- Replaced the in-process recovery fixture with two separately spawned control-plane child processes and a surviving TCP provider child. The test kills control-plane A with `SIGKILL`, expires both durable leases, starts control-plane B, proves one `unknown`/`fenced` recovery decision, preserves opaque refs, observes provider spawn count 1 with the original invocation still running, and proves retry is blocked without a duplicate spawn.
- Fresh focused PostgreSQL suites pass **50/50** and `npm run build` passes. Broad project test is the remaining checkpoint before runtime commit acceptance.


## 2026-09-05 — Phase 5 Track A1 provider-boundary decision

- Independent re-review found one provider-boundary limitation: `ExecutionKernelPort` has no owner epoch/fence parameter, so a fresh process cannot prove or forcibly stop an already-running external invocation. Adding an invented provider fence to the Prime-neutral interface would be a second, unverified authority path.
- **Explicit Slice 1 contract:** after restart, preserve opaque execution/invocation refs, durably transfer DB ownership, mark the worker `unknown`/`fenced`, and block retry. The acceptance claim is durable write fencing and no duplicate admission, not suppression of side effects already executing inside an unavailable external provider. Provider-side cancellation/epoch fencing remains a later adapter-specific hardening item.
- A separate bind gap remains actionable: if takeover occurs between provider spawn and DB bind, the returned refs must still be durably attached to the reserved worker. The next patch will allow identity-only binding of a still-pending reservation after turnover, while never allowing a stale owner to prompt or mutate status.


### Explicit provider crash-window boundary (Track A1)

The provider-neutral `ExecutionKernelPort` cannot atomically commit an external `spawn()` response with PostgreSQL. If a control-plane process is SIGKILLed after the provider returns opaque refs but before `bindWorkerInvocation` commits, the durable reservation remains `pending:*` and the provider identity is unavailable to the successor. Track A1 acceptance for this window is therefore: successor startup marks the reservation `unknown`/`fenced`, preserves the pending placeholders without fabricating refs, records one recovery decision, and blocks retry. It does **not** claim provider ref recovery or suppression of side effects already admitted by an unavailable provider. A later adapter-specific idempotency/reconnect/cancel contract is required before making that stronger claim.


## 2026-09-05 — broad verification hygiene

- The first latest-tree `npm run check` attempt was aborted because the temporary `node_modules.root-symlink` diagnostic symlink was still present and Vitest discovered dependency tests through it. No application test failure was observed. The process group was terminated, the symlink was removed, and the rerun is required.


## 2026-09-05 — Track A1 final verification

- Latest-tree `npm run build`: passed.
- Latest-tree DB-backed focused suites: 5 files / 55 tests passed, including worker 31, helper 10, reconciliation 11, real child-process worker recovery 2, and Goal transition restart coverage.
- Latest-tree `npm run check`: passed with 102 test files passed, 1 intentionally skipped file, 790 tests passed, and 2 intentionally skipped tests; duration 354.38s.
- Latest-tree `git diff --check`: passed.
- The explicit crash-window process test passed: provider spawn count was one, the SIGKILLed reservation became `unknown`/`fenced` with `pending:*` placeholders, one recovery decision was recorded, and retry returned the durable conflict.
- Track A1 is ready for integration with the provider-neutral crash-window and provider-side stale-effect limits documented above.


## 2026-09-05 — Phase 5 Track B1-B2 device authority plan

- Scope is limited to a separately running `apps/device-agent` and its `packages/device-agent` support package, signed Goal/project/device/path/fence/policy envelopes, mTLS certificate-to-enrollment binding, durable device-agent sessions, and a pre-effect server-side grant sequence claim. Worker runtime and Secretary files remain out of scope.
- The first ordinary operation is a bounded project-file read rooted at an explicitly configured temporary project directory. The injected executor receives only a validated target below the configured root and a byte ceiling; it cannot shell out or escape the root.
- The control plane (or test issuer) signs the grant envelope with an ephemeral Ed25519 issuer key. The device agent verifies that signature, its own enrolled identity, Goal/project/grant/device binding, expiry, policy version, Goal fence, command sequence, and application/data/network scope before the OS read. The client certificate proves possession through standard mutual TLS.
- Private device/issuer keys, capability tokens, TLS challenge material, and file contents never enter PostgreSQL, evidence, logs, or prompts. PostgreSQL stores only hashes, scope, session identity metadata, sequence claims, and bounded result summaries.
- Acceptance requires a real PostgreSQL schema, real control-plane/device-agent processes, ephemeral CA/certificates and Ed25519 keys, one actual temp-project read, restart replay rejection, and negative cases for bad certificate, wrong signature, stale Goal/fence/sequence, expiry, scope escape, revoked device/grant, and missing key with zero executor calls.


## 2026-09-05 — Phase 6 Slice 1 Improvement Digest plan (pre-patch)

- Keep the first Phase 6 slice narrow: add a versioned, project-private `ImprovementDigest` contract and append-only PostgreSQL storage. Do not add candidate mutation, replay, shadow execution, rollout, or `refine` authority yet.
- A digest will contain only bounded curated summaries, typed metrics, confidence, explicit trigger/source references, and a canonical content hash. Raw prompts, file bytes, credentials, capability tokens, and provider secrets are excluded by schema and validator checks.
- Require every source reference to identify a durable project/Goal record; a digest cannot be written from an unbound or cross-project source. The digest writer will use the existing Goal lease/actor boundary for an active Goal and will not infer authority from model text.
- Acceptance for this slice: tenacity/idempotent retry by content identity, changed-content conflict rejection, append-only database protection, source/project/Goal mismatch rejection, bounds and secret-like summary rejection, and a real PostgreSQL migration double-apply check.
- Explicit non-goals: automatic improvement, candidate evaluation, persona-axis changes, global knowledge promotion, live routing changes, and UI/Secretary updates.


## 2026-09-05 — Phase 5 Track B1-B2 device authority implementation and verification

- Implemented `packages/device-agent` and `apps/device-agent`: Ed25519-signed Goal/project/device/path/fence/policy envelopes, mTLS client-certificate identity binding, local policy/scope/fence/sequence checks, bounded descriptor-based project-file reads, and durable agent session lifecycle.
- Added migration `0062_device_agent_runtime.sql` for session records, pre-effect command claims, immutable completion, retention metadata, and conservative `unknown` recovery state. `claimDeviceAgentCommand` rechecks the active enrolled session, grant/device/Goal/policy/control/lease fence, and monotonic sequence before the executor.
- Added restart recovery: an unresolved claimed command is marked `unknown` at next agent startup and its grant is blocked. This deliberately does not guess whether an external effect happened. Completion is session-bound and cannot be forged by another active session.
- Added real PostgreSQL and process acceptance with ephemeral CA/certificates and Ed25519 keys. It starts a real provider, control-plane, and device-agent process, reads an actual temporary project file, verifies migration double-apply, performs a real claim-crash/SIGKILL and restart replay, and proves bad certificate/signature, stale/future fence, stale policy, expiry, scope escape, and revoked-device requests produce no additional claim/result.
- Focused verification: 4 files / 8 tests passed. Broad verification: `npm run check` passed with 104 files / 793 tests passed, 2 intentional live-Prime skips, 0 failures. `npm run build` and `git diff --check` passed. Independent no-edit review was completed; its high/important findings were fixed or explicitly bounded.
- Remaining scope is explicit: the acceptance control-plane child is a real booted process while the issuer/authority path is direct durable PostgreSQL for this slice; application/data/network labels are enforced as grant/policy dimensions but the implemented executor is file-read-only; provider-specific receipt/outbox, grant-revocation cascade, dependent-work pause, Metronome integration, rollout, and UI remain later slices.


## 2026-09-05 — Phase 6 Slice 1 Improvement Digest implementation and focused result

- Implemented the first narrow lifecycle slice: domain validation and canonical hashing in `packages/domain/src/improvement-digest.ts`, append-only migration `0063_improvement_digests.sql`, and source/project/Goal-bound persistence in `packages/persistence/src/improvement-digest.ts`.
- Supported sources are durable Goal, evidence record, evidence bundle, Metronome finding, Encore round, and closed Discord improvement evidence references. A digest must resolve inside the same project and Goal; arbitrary or cross-project model claims are rejected.
- The writer requires an active Goal lease/control boundary, records author/session metadata, makes same-episode same-content retries idempotent, and rejects changed-content conflicts. Read paths recompute the canonical hash. Database triggers make snapshots immutable.
- Focused verification: 3 files / 7 tests passed, including migration double-apply and expected-table coverage. `npm run build` passed. Broad verification is pending for this Phase 6 tree.
- Deliberate non-goals remain unchanged: no candidate application, replay/synthetic/shadow evaluation, rollout controller, adaptive persona mutation, cross-project promotion, `refine` integration, or UI changes.


## 2026-09-05 — Phase 6 Slice 1 review remediation plan

Before the next patch, address the independent review findings in one bounded hardening pass:

1. Add schema versioning to the digest contract and persisted row, with the version included in the canonical hash.
2. Extend validation and SQL constraints for text/author/session bounds and stronger credential-like material rejection.
3. Add PostgreSQL defense-in-depth for Goal/project/source binding, including closed-only Discord evidence, malformed source rejection, and append-only TRUNCATE protection.
4. Require an active project membership context for digest reads and add isolation tests.
5. Recheck Goal lease validity immediately before commit so a long digest transaction cannot commit after TTL expiry.
6. Expand focused tests for TRUNCATE, direct SQL binding, open Discord evidence, no-DB skip safety, read authorization, and lease expiry.

No candidate mutation, replay, rollout, persona adaptation, cross-project promotion, or provider execution will be added in this remediation.


## 2026-09-05 — Phase 6 Slice 1 second review remediation plan

The second independent review found one remaining high-risk SQL bypass and two verification gaps. Before committing, add database validation for every bounded JSON element (alternative strings, metric object shape/name/unit/value, exact source-ref keys), reject duplicate source identities in the binding trigger, add real PostgreSQL tests for these paths plus direct open-Discord insertion and authorized cross-project read isolation, and add known AWS/GitHub/Google token patterns to the heuristic detector. The detector remains explicitly heuristic; arbitrary opaque text is not promoted to a candidate or executed.


## 2026-09-05 — Phase 6 Slice 1 second-review remediation result

- Added `schemaVersion: 1` to the digest contract and canonical hash input. Added bounded author/session metadata checks, known AWS/GitHub/Google/Slack/Hugging Face/Stripe-style credential detectors, and sensitive metric-label rejection.
- Added PostgreSQL element validation for alternatives and metrics, exact source-ref object shape, duplicate source identity rejection, project/Goal/source binding, closed-only Discord evidence, scalar/JSON bounds, and UPDATE/DELETE/TRUNCATE append-only triggers.
- Digest reads now require active project membership and scope the digest ID by project. `withGoalAuthority` rechecks the lease immediately before commit; an expiry during a transaction rolls back.
- Focused remediation verification passed: build; domain + digest integration 6/6; migration + domain + digest 8/8; no-DB domain + skipped DB suites 3 passed / 5 skipped; `git diff --check` passed. The first broad run before remediation passed 106 files / 798 tests / 2 intentional skips, and a clean post-remediation broad run is pending.


## 2026-09-05 — Phase 6 Slice 1 truncate-trigger compatibility correction

The clean broad run exposed an interaction: existing integration fixtures truncate parent `goals ... CASCADE`, and a Goal FK caused PostgreSQL to invoke the new digest TRUNCATE trigger on the cascaded child table. To preserve append-only digests without breaking unrelated test/database lifecycle resets, remove the digest table's parent FK and rely on the already-added BEFORE INSERT binding trigger for Goal existence/project binding. Goal rows are not deleted by application lifecycle; direct digest truncation remains rejected. Re-run the digest/migration focus and clean broad check after this correction.


## 2026-09-05 — Phase 6 Slice 1 canonical hash defense-in-depth plan

The final review conditionally identified that a direct SQL writer could insert a source-valid row with a false 64-hex content hash and poison reads. Since the migration now intentionally defends against direct SQL shape/binding bypasses, add a small PostgreSQL canonical JSON serializer plus `pgcrypto` SHA-256 check in the insert trigger, and cover a valid-source/false-hash direct INSERT. Preserve the application hash as the canonical contract; the database check is a second fence.


## 2026-09-05 — Phase 6 Slice 1 canonical hash defense-in-depth result

- Added idempotent `pgcrypto` setup and a PostgreSQL canonical JSON serializer matching the domain field ordering/encoding. The insert binding trigger now recomputes SHA-256 and rejects a source-valid row with a false hash before it can poison reads.
- Added focused coverage for a valid-source false hash, nested sensitive metric field, malformed/duplicate refs, open Discord evidence, authorized cross-project read isolation, TRUNCATE, author metadata, and lease expiry.
- Focused migration/domain/digest verification passed 8/8 after the hash fence. The clean broad gate remains pending after this final migration change.


## 2026-09-05 — Phase 6 Step 1 final-review remediation plan

The final review reproduced two concrete blockers before the Step 1 checkpoint: scoped connections cannot resolve an unqualified `digest()` function when pgcrypto is installed in `public`, and PostgreSQL JSONB number rendering diverges from JavaScript canonical JSON for exponent-form values. It also found two smaller contract gaps. Before any commit, schema-qualify the crypto function, constrain metric values to a JSONB/JavaScript-stable decimal range, require UUIDs for all durable digest IDs, trim-check SQL alternatives, and add tests for fresh scoped migration execution, exponent rejection, and malformed IDs.


## 2026-09-05 — Phase 6 Step 1 final-review fix result

- Schema-qualified the PostgreSQL crypto call as `public.digest` and install pgcrypto in the known `public` schema, removing the scoped-search-path failure.
- Restricted metric values to the JSONB/JavaScript-stable decimal range `[1e-6, 1e21)` except zero, required UUIDs for project/Goal/source durable IDs, kept episode IDs bounded text, and enforced trimmed SQL alternatives.
- Red test first caught the missing UUID/stable-number behavior; the focused domain suite then passed 4/4, and focused persistence/migration suites passed 5/5. A final no-edit review is running before the broad gate.
- Phase 6 Step 2 remains explicitly deferred. The next planned work after this checkpoint is Phase 1 operational usability, not more Phase 6 automation.


## 2026-09-05 — Phase 6 Step 1 checkpoint and forward execution policy

### Current checkpoint

- Phase 6 Step 1 is the only active implementation scope: project-private, versioned, append-only Improvement Digests with source/project/Goal binding, project-authorized reads, bounded summaries, durable JSON validation, canonical hashing, and lease-at-commit recheck.
- Latest focused verification is green: domain `4/4`, persistence/migration `5/5`; build passes. The final broad check is still running in `/tmp/maestro-phase6-step1-final-check.log` (PID 703452), and the final no-edit review agent `phase6-step1-final-review-2` is active. Do not mark Step 1 complete until both return.
- No Phase 6 Step 2 work has started. Candidate mutation, replay/shadow execution, rollout, persona adaptation, `refine` authority, and cross-project promotion remain prohibited.

### Required closeout order

1. Read the final broad-check result and final independent review.
2. Fix only concrete blockers found there; record a new plan before each fix and rerun focused validation.
3. Record final counts and residual boundaries in this file and `findings.md`.
4. Run `npm run build`, focused DB/domain tests, no-DB skip-safe tests, `git diff --check`, and final status inspection.
5. Commit the completed Step 1 with a Conventional Commit on `phase6/improvement-digest`, push it, then cherry-pick/synchronize the validated commit to `hardening/lifecycle` and push.
6. Stop. Do not begin Phase 6 Step 2 in the same checkpoint.

### Next phase sequence after Step 1 is pushed

The next work is not another Phase 6 feature. It is a new, separately recorded operationalization track that returns to Phase 1 and closes one blocker at a time:

- **Phase 1 Step A — authenticated runtime entry path:** define the smallest user-runnable control-plane startup/health/Goal path and its acceptance evidence.
- **Phase 1 Step B — project authorization closure:** enforce membership/role/capability checks on every exposed Goal/lifecycle route, with cross-project negative tests.
- **Phase 1 Step C — dependent orchestration path:** add the next authenticated write route only as a complete vertical slice through durable authority, recovery, CLI/API parity, and real-process tests.
- **Phase 1 Step D — approval and critical-action path:** implement one user-facing CEO approval/re-run flow, exactly-once and audit-bound.
- **Phase 1 Step E — operational observation/parity:** add the required running Metronome observation and matching operator surfaces only after the prior P0 steps pass.

Each Phase 1 step must follow: plan in `task_plan.md` → failing test → minimal patch → focused PostgreSQL/real-process verification → independent no-edit review → progress/findings record → Conventional Commit and push → stop for the next step.

### Readiness rule

A green component test is not an operational acceptance claim. Phase 1 will be called usable only after a normal operator can start the documented runtime, authenticate, act within one project, complete the bounded Goal path, observe durable state through the supported surface, and recover a killed process without duplicate or stale effects. Provider-side fencing limitations and any unresolved external-effect uncertainty must remain explicitly documented.


## 2026-09-05 — Two-tier subagent execution policy

가능한 작업부터 2단으로 운영한다.

- **1단 — Step lead / implementation lane:** one isolated worktree owns one narrowly bounded Step. It first writes acceptance criteria and the plan, then implements the smallest vertical slice and its tests. It does not declare the Step complete and does not push unreviewed work.
- **2단 — independent verification lanes:** at least two separate no-edit agents review the same diff independently: one correctness/security reviewer and one runtime/acceptance reviewer. When useful, add a third focused PostgreSQL/process test lane. These agents must not share an implementation worktree or edit the target files.
- **Parent control plane:** the parent agent owns fan-in, conflict resolution, final commands, progress/findings records, Conventional Commit, push, and the stop gate. No child may silently widen scope or start the next Phase.
- **Parallelism rule:** independent research, review, and verification start in parallel; implementation remains serialized per Step. No concurrent edits to one worktree.
- **Gate rule:** a Step advances only when the implementation lane is green, both independent reviewers pass, and the required real-PostgreSQL/real-process evidence exists. A blocker causes a new recorded remediation plan before another patch.

For the next Phase 1 operationalization track, the planned fan-out is: one Step lead, one security/authorization reviewer, one runtime/process reviewer, and one test-evidence reviewer when the Step involves PostgreSQL or external effects. All subagents use the approved `openai-codex/gpt-5.6-luna` model with high reasoning.


## 2026-09-05 — Phase 6 Step 1 UUID/hash parity remediation plan

The second final review found one remaining blocker: UUID validation accepts uppercase UUIDs, PostgreSQL normalizes UUID columns to lowercase, and the app currently hashes the pre-normalized payload. This can reject valid uppercase inputs at the database hash trigger. Before the next patch, normalize project, Goal, and source UUIDs to lowercase in a domain helper; hash the normalized payload; and use that same normalized payload for persistence writes and source checks. Add regression coverage proving uppercase/lowercase inputs have identical canonical content and that an uppercase retry remains idempotent. Keep episode IDs as bounded opaque text.


## 2026-09-05 — Phase 6 Step 1 UUID/hash remediation result

- Added domain normalization of project, Goal, and source UUIDs to lowercase before canonical hashing. Persistence now writes and source-checks the same normalized payload, so PostgreSQL UUID normalization cannot change the trigger hash. Episode IDs remain bounded opaque text.
- Added regression coverage for uppercase/lowercase hash equality and an uppercase persistence retry; the intentional red run preceded the build refresh, then build plus focused domain/persistence verification passed `5/5` and `3/3` respectively.
- The prior final review's only blocker is addressed. A fresh no-edit review and a clean broad run are required before commit/push; the broad run that was started before this patch was stopped and is not acceptance evidence.


## 2026-09-05 — Phase 6 Step 1 clean acceptance run v3

- The pre-patch broad run was stopped after the UUID parity finding; it is not acceptance evidence.
- A new clean `npm run check` is running as PID 713226 with log `/tmp/maestro-phase6-step1-final-check-v3.log`.
- Two post-patch no-edit review lanes are running in parallel: `phase6-step1-final-review-3` for complete correctness/acceptance and `phase6-step1-security-review-2` for privacy, binding, authorization, SQL, and lease boundaries.
- Commit/push remains blocked until the clean broad result and both independent reviews pass.


## 2026-09-05 — Phase 6 Step 1 confidence/hash parity remediation plan

The independent review found the same JSONB/JavaScript canonicalization mismatch for `confidence`: the domain accepts values such as `1e-7`, while PostgreSQL JSONB serializes them as decimal text before the hash trigger. The clean broad run was stopped because it predates this remediation. Before the next patch, apply the existing stable-number bound to confidence (zero or `[1e-6, 1]`) in the domain and migration trigger/constraint, add a red regression test for tiny confidence, then rerun focused and clean broad verification. Do not loosen the DB hash fence.


## 2026-09-05 — Phase 6 Step 1 SQL UUID canonicalization remediation plan

The independent review found a defense-in-depth parity gap that application tests do not cover: direct SQL can insert an uppercase `sourceId`; the trigger hashes uppercase JSONB, but the domain mapper normalizes it and rejects the stored row. Before commit, normalize string `sourceId` UUIDs in the `BEFORE INSERT` binding trigger before duplicate/source validation and hashing, while preserving malformed values for the existing typed rejection path. Add a direct-SQL uppercase source test that uses the domain hash and confirms the stored/read digest is canonical lowercase. This keeps domain, persistence, and database writers on one canonical representation rather than weakening the hash fence.


## 2026-09-05 — Phase 6 Step 1 SQL UUID parity result

- Added `BEFORE INSERT` normalization of valid string `sourceId` UUIDs in `NEW.source_refs` before duplicate checks, source binding, and canonical hash verification. Malformed source objects are left intact for the existing rejection path.
- Added a direct-SQL uppercase source test using the domain hash and verified the stored/read digest is canonical lowercase.
- After the intentional red test, build passed and focused domain/persistence/migration verification passed `10/10`.
- The prior review's direct-SQL parity blocker is addressed. A new clean broad run and fresh two-lane no-edit review remain required.


## 2026-09-05 — Phase 6 Step 1 numeric precision parity remediation plan

The independent review found one remaining direct-SQL hash parity gap: PostgreSQL JSONB preserves arbitrary numeric precision, while the TypeScript contract and `JSON.stringify` use IEEE-754 JavaScript numbers. A direct SQL metric such as `1.234567890123456789` can therefore pass the trigger but fail the application mapper. Before the next patch, make the SQL canonicalizer convert JSONB numbers through `double precision` before rendering, matching JavaScript Number round-trip semantics, while retaining the existing stable magnitude bounds. Add a direct-SQL high-precision metric test using the domain hash. Do not weaken the hash trigger or allow exponent-form values rejected by the domain.


## 2026-09-05 — Phase 6 Step 1 numeric precision parity result

- PostgreSQL canonical JSON now renders JSONB numbers after a `double precision` round-trip, matching JavaScript Number semantics; the existing magnitude bounds still reject exponent-form values that cannot render identically.
- Added direct-SQL high-precision metric coverage (`1.234567890123456789`) and verified both insertion and application read/hash mapping.
- After the intentional red test, build passed and focused domain/persistence/migration verification passed `10/10`.
- The clean broad run was restarted only after this patch; previous interrupted runs remain non-acceptance evidence.


## 2026-09-05 — Phase 6 Step 1 binding/read-boundary remediation plan

The two independent security reviews identified three database-boundary gaps beyond the numeric hash fixes: migration 0063 trigger relation lookups can be shadowed by temporary tables, Goal `project_id` can be mutated after a digest is written, and digest reads perform membership and data queries on separate pool statements. Before the next patch, pin trigger relation resolution to the digest table's actual schema with safe dynamic SQL, add an immutable Goal project-identity trigger, and hold an active membership row lock across an authorized digest read transaction. Add regression tests for fabricated temporary-table binding, Goal project mutation, and the existing membership denial path. The lease helper's unavoidable expiry-at-COMMIT race remains explicitly database-only: its callback must not perform external effects; provider-side fencing stays a documented boundary and is not claimed by this Step.


## 2026-09-05 — Phase 6 Step 1 normalized-source uniqueness addendum

The final review also found that domain duplicate detection occurs before UUID normalization: source refs that differ only by UUID case pass domain validation but collapse to one identity in the normalized persistence payload and are then rejected by SQL. Treat case-insensitive UUID identity consistently by lowercasing the source ID for the domain uniqueness key and add a regression test.


## 2026-09-05 — Phase 6 Step 1 binding/read-boundary remediation result

- The binding trigger now resolves all Goal/evidence/source relations through `TG_TABLE_SCHEMA` with identifier-safe dynamic SQL, preventing `pg_temp` relation shadowing; hash canonicalization is schema-qualified as well.
- Added the Goal project-identity immutability trigger. Added a regression that attempts to move a Goal after digest insertion and requires rejection.
- Digest reads now hold an active membership row lock in one transaction across authorization and data selection, eliminating the prior pool-query check/read gap.
- The intentional red boundary run caught the missing Goal immutability trigger; after the patch, build passed and focused domain/persistence/migration verification passed `8/8` executable tests (migration cases may skip when the harness detects a shared-DB race).
- The provider-side lease expiry/COMMIT TOCTOU remains outside this digest Step: `withGoalAuthority` is DB-only and must not wrap external effects; provider fencing remains an explicit residual limitation.


## 2026-09-05 — Post-Step-1 main hygiene and Phase 1 restart plan

After the Step 1 acceptance gate passes, do not start Phase 1 in the feature worktree. First commit and push the validated `phase6/improvement-digest` branch, synchronize that commit into `main`, and verify the main checkout is clean. Then inspect whether ESLint/Prettier are configured; run the repository-supported one-time lint/format check on `main`, using only pinned/temporary tooling if the repository has no configuration and never formatting unrelated files blindly. Record exact tool availability, commands, and outcomes.

Update the roadmap/status docs so they no longer call Phases 1–4 operationally complete while their remediation gates are open. Preserve the explicit provider-fencing and external-effect boundaries. Commit and push the documentation/tooling hygiene separately. Only then create a fresh Phase 1 operationalization worktree.

Phase 1 execution will use the two-tier model: one Step lead in the implementation worktree; two independent no-edit reviewers (authorization/security and runtime/process); a separate evidence lane for real PostgreSQL/process tests. Each Step ends with its own commit/push and stop gate.


## 2026-09-05 — Phase 6 Step 1 refresh-token SQL parity remediation plan

The independent security lane found that the PostgreSQL secret detector omitted `refresh_token`/`refresh-token`, while the domain detector rejects those labels. A direct SQL writer could therefore bypass the database privacy fence on digest text, episode, author, or session fields. Before the next patch, mirror the refresh-token pattern in the SQL detector and add a direct SQL helper regression for both separator forms. This is a narrow validation-only fix; no broader secret storage is introduced.


## 2026-09-05 — Phase 6 Step 1 rejected-alternatives size parity plan

The independent review found a domain/DB contract mismatch: the domain permits 16 alternatives at 4096 characters each, but PostgreSQL's `pg_column_size(rejected_alternatives) <= 65536` also counts JSONB storage overhead and rejects valid boundary inputs. Before the next patch, remove this redundant byte cap; the domain/trigger still enforce item count, per-item length, shape, and secret checks, so the field remains bounded without rejecting valid contract inputs. Add a boundary domain regression with 16 maximum-size alternatives.


## 2026-09-06 — Phase 6 Step 1 final privacy/size parity remediation

- Mirrored `refresh[_-]?token` detection in the PostgreSQL secret regex and added direct SQL checks for underscore and hyphen forms.
- Removed the redundant `pg_column_size` cap from `rejected_alternatives`; count/per-item length/shape/secret guards remain, matching the domain's documented maximum. Added a 16 × 4096-character domain boundary test.
- The intentional red checks preceded these changes; afterward build plus domain/digest focused verification passed `9/9`. No broad run is valid until the final review and a new clean broad run cover this latest patch.


## 2026-09-06 — Phase 6 Step 1 grant-helper surface remediation plan

The security review identified that `grantProjectMembership` and `grantProjectRole` are exported from the production persistence package without an admin argument. Source inspection shows they are used only by integration-test setup; no production route or service calls them. Before the next patch, remove these bootstrap helpers from the public `@maestro/persistence` root export, expose them only through an explicitly named `@maestro/persistence/testing` subpath, and update test imports. Keep the real `provisionProjectAccess` admin/active-operator path as the only production provisioning API. Add a source-level guard test or verification that production application files do not import the testing subpath.


## 2026-09-06 — Phase 6 Step 1 provisioning surface result

- Removed `grantProjectMembership` and `grantProjectRole` from the public `@maestro/persistence` root export. They are now available only through the explicit `@maestro/persistence/testing` subpath for integration setup.
- Production code has no imports of the testing subpath; production provisioning remains `provisionProjectAccess`, which enforces the configured admin and active-operator boundary. Updated application integration-test imports accordingly.
- `npm run build` passes after the surface split.


## 2026-09-06 — Phase 6 Step 1 search_path blocker plan

- **Blocker:** final runtime review found that migration 0063 helper and trigger functions inherit the caller's `search_path`; unqualified helper/builtin resolution can therefore be shadowed.
- **Minimal fix:** add a migration-local `ALTER FUNCTION` block that pins all five digest/Goal helper and trigger functions to `pg_catalog, public, <active migration schema>`. The active schema remains included because test and scoped deployments intentionally install the migration in a non-public schema; `pg_catalog` is first and no caller-supplied schemas are retained.
- **Regression:** add a direct SQL assertion that caller search-path shadowing does not change the digest secret detector result.
- **Gates:** run focused migration/persistence tests serially, then build, diff check, and clean broad check; obtain fresh no-edit reviews after the patch.


## 2026-09-06 — search_path hardening refinement

- The first hardening configuration included `public` before the active migration schema. That still permits a writable public schema to shadow helper names when scoped tables live elsewhere.
- Refine the pinned configuration to `pg_catalog, <active migration schema>` only. `public.digest` is already explicitly qualified, so public need not be in the function search path. This removes the remaining caller-writable schema from resolution while preserving custom-schema migrations.


## 2026-09-06 — Phase 6 Step 1 search_path acceptance evidence

- Independent no-edit implementation gate: **PASS** (`phase6-step1-gate-v4`).
- Independent no-edit security gate: **PASS** (`phase6-step1-security-gate-v4`).
- The migration now pins all five helper/trigger functions to `pg_catalog` plus the active migration schema, excluding caller-provided schemas and writable `public` shadowing.
- Focused sequential verification after the strict refinement: `npm test -- packages/domain/src/improvement-digest.test.ts packages/persistence/src/improvement-digest.integration.test.ts packages/persistence/src/test-migrations.integration.test.ts` — **3 files, 11 tests passed**.
- `npm run build` — **passed**.
- The broad `npm run check` started before the final import-format cleanup was stopped and is not acceptance evidence; a fresh clean run is required.


## 2026-09-06 — Clean broad check contamination handling

- **Observed:** fresh `npm run check` reached 105 passed files / 801 passed tests / 2 skipped, but failed one pre-existing `packages/persistence/src/device.integration.test.ts` assertion because `information_schema.tables` returned duplicate `device_policies`/`devices` rows from stale custom schemas.
- **Cause:** earlier intentionally stopped broad processes did not execute their `afterAll` schema cleanup. This is dedicated test-database contamination, not a Phase 6 source regression.
- **Plan:** do not patch application code. Verify all worktree Vitest processes are gone, remove only known stale non-public test schemas from the dedicated `MAESTRO_TEST_DATABASE_URL`, record the cleanup, then rerun one clean `npm run check` with no concurrent DB runner.
- **Acceptance:** the rerun must finish cleanly; otherwise patch the actual failing contract only after a new plan entry.


- Verified no worktree Vitest process remained before cleanup.
- Dedicated test database cleanup removed only these known stale schemas: `cli_secretary_parity_51002b8ed514466989ee9fff539d8364`, `digest_e02834ab9d54438d8460ac2afdddb456`, `migrate_test_1788641915911_4652aazdyxa`, `probe_1788660982049`, `probe_1788661005197`, `worker_process_f464c85fcc5f4959bf912bcd16edadca`, and `xcanon`.
- `public` and PostgreSQL system/temp schemas were left untouched.


## 2026-09-06 — Phase 6 Step 1 clean broad acceptance

- After removing only stale test schemas left by intentionally stopped prior runs, the isolated single-process `npm run check` completed successfully.
- Result: **106 test files passed, 1 skipped; 802 tests passed, 2 skipped; 0 failed**. The two skips are the known live-Prime cases.
- This is the first clean broad result after the final search_path hardening and import-format cleanup; the earlier overlapping/stopped run is discarded.
- `git diff --check` passes.


## 2026-09-06 — Post-acceptance Phase 6 documentation plan

- **Scope:** update the three roadmap-language copies (`docs/05-roadmap-and-phase-status.md`, `docs/en/...`, `docs/ko/...`) after the accepted Step 1 commit.
- **Status truth:** mark only Phase 6 Step 1 as accepted: immutable, project-private, source-bound Improvement Digests. Keep Phase 6 Steps 2+ deferred.
- **Boundary truth:** state that Step 1 adds no automatic mutation, replay, rollout, adaptation, or cross-project promotion. Preserve the existing Phase 1–5 operational disclaimer.
- **Validation:** inspect the diff, run `git diff --check`, and commit/push this documentation checkpoint separately.


## 2026-09-06 — Phase 6 Step 1 documentation result

- Updated the root, English, and Korean roadmap copies to mark Phase 6 Step 1 accepted.
- Documented the accepted boundary: immutable, project-private, source-bound digests with lease/membership/hash protections.
- Explicitly kept mutation, replay, rollout, adaptation, and cross-project promotion deferred for Phase 6 Steps 2+.
- `git diff --check` passes for the documentation checkpoint.


## 2026-09-06 — Phase 6 Step 1 final handoff

- `3d3e2cf` (`feat(persistence): add immutable improvement digests`) is pushed to `origin/phase6/improvement-digest`.
- `6b161bf` (`docs(phase6): record immutable digest acceptance`) is pushed to the feature branch and synchronized to `origin/main`; local `main` points to the same commit.
- Final clean verification evidence remains: `npm run check` — 106 files passed, 1 skipped; 802 tests passed, 2 skipped; 0 failed. `npm run build` and `git diff --check` passed.
- No repository ESLint, Prettier, Biome, or Oxlint configuration/local binary is available; this exact limitation is documented by inspection.
- Phase 6 Step 1 is closed. Phase 6 Steps 2+ remain intentionally deferred; no mutation, replay, rollout, adaptation, or cross-project promotion work was started.
## 2026-09-06 — Session resumption; Codex dead child; repo-vs-doc reconciliation

- Resumed per `maestro-resume`: read `docs/OPERATING_PROTOCOL.md`, `task_plan.md`, tail of
  `progress.md`/`findings.md`, confirmed `git log`/`git status` (clean, `hardening/lifecycle` at
  `ce94c3d`, working tree clean, no stray Maestro Docker containers).
- Dispatched a Luna-high subagent (`phase5-secretary-console`) into the existing
  `.worktrees/phase5-secretary-console` worktree to implement Phase 5 Slice 3 (Secretary safety
  console). It completed with an empty final message; raw session JSONL showed every turn returned
  `usage_limit_reached` (429, `resets_in_seconds` ~74000 at 2026-09-06T12:46 UTC). Zero real work
  was produced. Deleted per this project's dead-child protocol; proceeded directly (no subagent).
- Attempted to implement the Secretary Goal-discovery/lifecycle-control UI directly in that
  worktree, only to discover it was still parented at `d0ff587` — stale relative to
  `hardening/lifecycle`'s later Track A1 (worker ownership fields) and Electron-migration
  (`e55146b`) commits. The stale base produced local `tsc -b` errors unrelated to the new work, and
  a rebase onto `hardening/lifecycle` surfaced that Secretary's entire Next.js `app/`/`src` tree
  (the files the new work targeted) had been deleted upstream in favor of the Electron app. No code
  from this attempt was committed; the worktree was reset to `hardening/lifecycle` HEAD (`git reset
  --hard` + `git clean -fd` for stray build artifacts) before any further work.
- While diagnosing, found and fixed a real local-environment defect (no source change): the main
  worktree's `node_modules/@maestro/` was missing `device-agent`/`device-agent-app` workspace
  symlinks (every other package had one), so `npm run build` failed with `Cannot find module
  '@maestro/device-agent'`. `npm install` in the main worktree recreated them with zero
  `package-lock.json` diff. `npm run build` is now clean on `hardening/lifecycle` HEAD. A follow-up
  `npm test` (no DB/Docker in this runtime) passed **441 tests, 342 skipped, 3 failed** — the 3
  failures are a pre-existing, unrelated test-infra gap (see `findings.md`), not caused by this
  session's changes.
- Audited the real Electron Secretary app (`apps/secretary`) directly rather than trusting
  `task_plan.md`'s stale "read-only single-Goal page" description. Findings recorded in full in
  `task_plan.md`'s new "2026-09-06 — Session resumption: repo-vs-doc reconciliation" section:
  real, tested, but currently orphaned data-loading plumbing (`connection.tsx`, `goals.tsx`,
  `useGoalDetail.ts`, `lib/goal-data.ts`, `electron/apiBridge.ts`) exists alongside 13 UI views that
  are **all** hardcoded mock data with zero real-plumbing usage (confirmed by `grep` across every
  view file). The control-plane's write-command API surface (Task Contract, Goal lifecycle,
  critical-action approve-and-run, Council, Department Plan, Mission Bundle, worker, Git
  integration, Metronome, certification) is also far more complete than the Status block in
  `task_plan.md`'s Phase 5 section states — that block is corrected in place with a pointer to the
  new dated section rather than rewritten, per this project's doc-log union convention.
- Next actionable item, once a subagent model is available again or work continues directly: wire
  one real Secretary view (most plausibly `Dashboard`) to `useGoalDetail`/`useGoals` and replace its
  hardcoded arrays, before expanding `electron/apiBridge.ts`'s exposed-method allowlist or adding
  any new capability.


## 2026-09-06 (continued) — Secretary Dashboard wired to real Goal state; Setup gate enforced

- Added `apps/secretary/src/lib/dashboard-data.ts`'s pure `summarizeDashboard(goals, detail)` (unit
  tested, 3/3) as the first real (non-mock) Dashboard view-model: total Goal count, and for the
  selected Goal its exact durable state/version/certification count/budget-reserved-cost, never a
  fabricated number -- `selectedGoal` is simply omitted until a Goal is actually loaded.
- Rewired `Dashboard.tsx` to consume the already-existing but previously orphaned `useConnection`/
  `useGoals`/`useGoalDetail` hooks instead of hardcoded `departments`/stat constants. The Goal list
  section now lists real Goals and lets an operator click one to select it (`selectGoal`). The
  Council/Department Plan/Mission Bundle "pipeline" kanban section (no backing API-bridge read
  method exists yet) is replaced with the project's own `EmptyState` component instead of retaining
  fabricated kanban cards -- this component already existed for exactly this purpose but was
  unused anywhere in the app until now.
- Closed part of the `App.tsx` "ponytail" bypass: `Connected()` now actually gates on
  `useConnection()` (`loading` -> a minimal busy shell, `config === undefined` -> the real, already
  built `Setup` connection form, otherwise the real `Shell`) instead of unconditionally rendering
  the mock Shell regardless of connection state.
- Verified: `npm run build` (root, `tsc -b`) clean; `apps/secretary`'s own
  `tsc -p tsconfig.renderer.json --noEmit` clean; `apps/secretary`'s `vite build` succeeds (bundles
  1699 modules, pre-existing >500kB chunk warning unrelated to this change); root `npm test` (no DB
  in this runtime): **108 test files (58 passed, 50 skipped), 799 tests (450 passed, 349 skipped),
  0 failed** (450 = prior 447 + 3 new `dashboard-data.test.ts` cases).
- Remaining Dashboard/App gap, left open for the next slice: `Billing`, `Channel`, `Git`,
  `EvidenceLog`, and the other 8 views are still 100% hardcoded mock data; Council/Department
  Plan/Mission Bundle reads still need `electron/apiBridge.ts` allowlist entries and real
  control-plane read routes wired before the "pipeline" `EmptyState` can become real; lifecycle
  controls (pause/resume/stop/emergency-stop, already in the API-bridge allowlist) are not yet
  exposed as UI actions anywhere.


## 2026-09-06 (continued) — Secretary Dashboard gets real lifecycle controls

- Added `apps/secretary/src/lib/goal-control.ts`'s pure `runGoalControlAction(api, request,
  commandId?)` (unit tested, 5/5): the first Secretary write path, calling the already-bridged
  `pauseGoal`/`resumeGoal`/`stopGoal`/`emergencyStopGoal` methods with the caller's exact durable
  `expectedVersion`, so the control plane -- not this screen -- is the sole authority that decides
  whether a submission is stale.
- Extended `useGoalDetail.ts` with a `refresh()` capability (a reload-token counter added to its
  existing effect dependency list) so a successful lifecycle action can force a fresh durable read
  instead of the UI silently trusting its own optimistic guess.
- `Dashboard.tsx` now renders four real lifecycle-control buttons (Pause/Resume/Stop/Emergency
  stop) for the selected Goal, disabled while any one is in flight, surfacing the control plane's
  own rejection message on failure (e.g. a stale-version conflict) rather than hiding it.
- Verified: root `tsc -b` clean; `apps/secretary`'s `tsc -p tsconfig.renderer.json --noEmit` clean;
  `apps/secretary`'s `vite build` succeeds (1700 modules); root `npm test` (no DB in this runtime):
  **109 test files (59 passed, 50 skipped), 804 tests (455 passed, 349 skipped), 0 failed** (455 =
  prior 450 + 5 new `goal-control.test.ts` cases).
- Remaining Dashboard/App gap for the next slice: `Billing`, `Channel`, `Git`, `EvidenceLog`, and
  the other 8 views are still fully mock; Council/Department Plan/Mission Bundle reads still need
  new `electron/apiBridge.ts` allowlist entries; the Task Contract intake/critical-action-approval
  write paths that already exist in the control plane and API client are not yet exposed anywhere
  in the Electron bridge or UI.


## 2026-09-06 (continued) — Evidence Log wired to real certification data

- `EvidenceLog.tsx` now renders `useGoalDetail()`'s real `certifications` array for the selected
  Goal (kind, verdict, real integrated commit SHA prefix, certifying/producing department) instead
  of three fabricated `sha256 ...` entries and an "every goal" claim the app cannot back yet.
  Loading/error/empty/no-Goal-selected states are all explicit and honest (`EmptyState` for
  no-connection and no-Goal-selected, plain messages for load-in-progress and zero certifications).
- Deliberately scoped to the *selected* Goal only, not "every Goal" as the old copy claimed --
  there is no cross-Goal certification aggregator yet; the honest label says so.
- Verified: root `tsc -b` clean, `apps/secretary`'s `tsc -p tsconfig.renderer.json --noEmit` clean,
  `apps/secretary`'s `vite build` succeeds (1700 modules), root `npm test` (no DB in this runtime)
  unchanged from the prior slice: **109 test files (59 passed, 50 skipped), 804 tests (455 passed,
  349 skipped), 0 failed** (no new pure-logic module needed here; EvidenceLog reuses
  `useGoalDetail`'s already-tested data).
- Remaining mock views for the next slice: `Billing`, `Channel`, `Git`, and 8 others still fully
  hardcoded; still no cross-Goal certification/evidence aggregation; still no
  `electron/apiBridge.ts` allowlist entries for Council/Department Plan/Mission Bundle/critical-
  action reads or writes.


## 2026-09-06 (continued) — Billing wired to real per-Goal budget

- `Billing.tsx` now renders `useGoalDetail()`'s real `budget` (actual spend, ceiling, reserved,
  computed remaining, reserved-of-ceiling progress bar) for the selected Goal instead of fabricated
  "$186 used / $300 ceiling / 9 days left" constants.
- Daily spend history, per-department usage breakdown, and cross-Goal "recent goals" totals are
  replaced with an honest `EmptyState` -- none of those have a durable read surface yet (no
  time-series spend record, no department-scoped budget read, no cross-Goal aggregator), so they
  are not approximated or guessed.
- Verified: root `tsc -b` clean, `apps/secretary`'s `tsc -p tsconfig.renderer.json --noEmit` clean,
  `apps/secretary`'s `vite build` succeeds, root `npm test` unchanged: **109 files (59 passed, 50
  skipped), 804 tests (455 passed, 349 skipped), 0 failed**.
- Four real (non-mock) Secretary screens now exist: Dashboard (Goal state/budget/certifications +
  lifecycle controls), Evidence Log (real certifications), Billing (real budget). Remaining mock
  views for the next slice: `Channel`, `Git`, `Home`, `Floor`, `Inbox`, `Settings`, `Luthiery`,
  `Arrangements`, `Flashmob`, `FlashmobSession`, `Sidebar` badge counts. None of them have a durable
  read surface exposed through `electron/apiBridge.ts` yet for Council/Department Plan/Mission
  Bundle/Git integration/Discord state.


## 2026-09-06 (continued) — Channel reframed as a real Goal event feed

- `Channel.tsx` no longer renders a scripted chat transcript (fake "tech head"/"scout-1" messages,
  a fake approval prompt, a fake "certified" line). It now renders `useGoalDetail()`'s real durable
  event stream for the selected Goal (event type, cursor, aggregate version, timestamp, raw
  payload) -- the same real data `goal-data.ts` already loads, just presented as a feed.
- The message composer is now honestly disabled with an explanatory placeholder: Maestro's domain
  model has no chat/message-send capability at all, so a "send" button here would have been a UI
  affordance with nothing behind it.
- The worker/Head "roster" sidebar is replaced with `EmptyState`: no durable "list active
  workers/Heads for a Goal" read route exists yet (only single-worker-by-id lookup), so a roster
  cannot be honestly populated without inventing one first.
- Verified: root `tsc -b` clean, `apps/secretary`'s `tsc -p tsconfig.renderer.json --noEmit` clean,
  `apps/secretary`'s `vite build` succeeds (1700 modules), root `npm test` unchanged: **109 files
  (59 passed, 50 skipped), 804 tests (455 passed, 349 skipped), 0 failed**.
- Five real (non-mock) Secretary screens now exist: Dashboard, Evidence Log, Billing, Channel.
  Remaining fully-mock views: `Git`, `Home`, `Floor`, `Inbox`, `Settings`, `Luthiery`,
  `Arrangements`, `Flashmob`, `FlashmobSession`. `Git` specifically has **no backend read route at
  all** for Git integration branches/worktrees/revisions (only create/freeze write commands exist)
  -- wiring it for real would require a new control-plane route + domain/persistence read + typed
  client method + apiBridge entry first, a larger slice than the read-wiring done so far.


## 2026-09-06 (continued) — real Git integration read surface added; Git view wired

- Added a new durable read path end to end for Git integration state, the one real backend gap
  found while wiring Secretary's `Git` view: `packages/persistence/src/git-integration.ts`'s
  `getGoalGitIntegrationState(pool, goalId)` (plain SELECTs over `goal_integration_branches`/
  `goal_integration_revisions`, no lease/authority proof required since it exposes nothing an
  authenticated project member could not already infer from the existing write-command surface,
  and it never spawns Git itself); a new `GoalGitIntegrationStateSchema` contract
  (`packages/contracts`); `ReadStateService.getGitIntegrationState` (project-scoped, same
  `assertGoalProject` pattern as every other derived read); a new authenticated
  `GET /v1/goals/:goalId/git/integration-state` route; a matching typed `ApiClient` method; a new
  `git status` CLI command; and a new `electron/apiBridge.ts` allowlist entry.
- Added a focused real-PostgreSQL regression
  (`packages/persistence/src/git-integration.integration.test.ts`, new case) proving the read
  reports no branch/no revision before either exists, the exact branch identity once recorded, and
  the exact frozen revision (revision number + commit SHA) once one exists, reusing the file's
  existing Goal/Council/Plan/Worker fixture helper. Not run against real PostgreSQL in this runtime
  (no Docker here, same documented environment gate as the rest of this project) -- self-verified
  for type correctness and correct skip-registration only; a real-PostgreSQL run is the next
  checkpoint before this slice can be called accepted.
- `apps/secretary/src/views/Git.tsx` is now wired via a new `useGitIntegrationState()` hook to the
  real integration branch (repository path, branch name, base revision) and latest frozen revision
  (revision number, commit SHA) for the selected Goal -- previously 100% hardcoded (`.worktrees/
  hero-section`, fake changed-files list, fake `sha256 4f2a...`).
- Verified: root `tsc -b` clean, `apps/secretary`'s `tsc -p tsconfig.renderer.json --noEmit` clean,
  `apps/secretary`'s `vite build` succeeds (1701 modules), root `npm test` (no DB in this runtime):
  **109 test files (59 passed, 50 skipped), 805 tests (455 passed, 350 skipped), 0 failed** (the
  new Git-integration-state case is the +1 skip).
- Six real (non-mock) Secretary screens now exist: Dashboard, Evidence Log, Billing, Channel, Git.
  Remaining fully-mock views: `Home`, `Floor`, `Inbox`, `Settings`, `Luthiery`, `Arrangements`,
  `Flashmob`, `FlashmobSession`. Department/Mission Bundle/Council reads still have no durable
  "list workers/Heads for a Goal" route -- the Channel roster and Git's changed-files list remain
  the two honestly-unwired sections closest to needing that next.


## 2026-09-06 (continued) — real "workers for a Goal" read surface added; roster and pipeline wired

- Added the second new durable read path this session, found while wiring Channel's roster and
  Dashboard's pipeline: `packages/persistence/src/worker.ts`'s `listWorkersForGoal(pool, goalId)`
  (reuses the existing `workerSelectWithGoalSql()` join against `head_councils` already used
  internally for lease-guarded single-worker reads; no lease/authority proof required, same
  reasoning as `getGoalGitIntegrationState`); a new `WorkerListSchema` contract; a new
  `ReadStateService.listWorkersForGoal` (project-scoped); a new authenticated
  `GET /v1/goals/:goalId/workers` route; a matching typed `ApiClient` method; a new
  `workers list` CLI command; and a new `electron/apiBridge.ts` allowlist entry.
- Added a focused real-PostgreSQL regression in `packages/persistence/src/worker.integration.test.ts`
  proving an unrelated Goal returns an empty list and a Goal with one spawned worker returns exactly
  that worker with the correct council/department binding. Not run against real PostgreSQL in this
  runtime (no Docker here); self-verified for type correctness and skip-registration only.
- `Channel.tsx`'s roster sidebar and `Dashboard.tsx`'s "pipeline" kanban now render the real worker
  list for the selected Goal via a new `useGoalWorkers()` hook (status, department, item, attempt
  count), replacing both remaining `EmptyState` placeholders that existed only because this read
  route did not exist yet.
- Verified: root `tsc -b` clean, `apps/secretary`'s `tsc -p tsconfig.renderer.json --noEmit` clean,
  `apps/secretary`'s `vite build` succeeds (1702 modules), root `npm test` (no DB in this runtime):
  **109 test files (59 passed, 50 skipped), 806 tests (455 passed, 351 skipped), 0 failed**.
- All six wired Secretary screens (Dashboard, Evidence Log, Billing, Channel, Git) are now backed
  entirely by real durable reads, with zero remaining fabricated numbers anywhere in them. Only
  genuinely unimplemented sections (daily spend history, per-department usage, cross-Goal budget
  rollup, Council/Plan detail beyond worker status) still show `EmptyState`, and each cites exactly
  which durable read surface is missing. Remaining fully-mock views for the next slice: `Home`,
  `Floor`, `Inbox`, `Settings`, `Luthiery`, `Arrangements`, `Flashmob`, `FlashmobSession` --
  several of these (Settings especially) are pure app-preference screens with no backend
  counterpart needed, and should be triaged individually rather than assumed all need real data.


## 2026-09-06 (continued) — Settings triaged: real Connection panel added, fake affordances disabled

- Triaged all 8 remaining fully-mock views before wiring any more of them blindly. `Settings.tsx`
  was the first result: it had no "connection" panel at all despite `i18n/en.ts` already carrying
  `settings.connection`/`settings.disconnect` strings for exactly this, and its `providers`/
  `models`/`authority`/`danger` panels have zero backing capability anywhere in the domain (no
  provider-connection concept, no model-routing-policy config, no per-project default-authority
  config, no workspace-reset command) -- these are speculative Phase 6+ design exploration, not
  something to fake wire.
- Added a real `connection` panel using the already-tested `useConnection()` hook: shows the actual
  `apiUrl`/`projectId` this Secretary instance is connected to (read-only, since changing them
  requires disconnecting first) and a real `disconnect()` button.
- Every remaining non-functional button in the preview-only panels (`gemini cli`/`local model
  (ollama)` "connect", "add to pool", "reset workspace") is now `disabled` with a "Not wired to a
  real backend yet" tooltip, and each panel's own sub-caption says so explicitly, so a user cannot
  click something that silently does nothing -- matching this project's own `EmptyState` component
  comment ("never a fake data, never a silently-ignored click").
- Verified: root `tsc -b` clean, `apps/secretary`'s `tsc -p tsconfig.renderer.json --noEmit` clean,
  `apps/secretary`'s `vite build` succeeds (1702 modules), root `npm test` unchanged: **109 files
  (59 passed, 50 skipped), 806 tests (455 passed, 351 skipped), 0 failed**.
- Remaining triage: `Home`, `Floor`, `Inbox`, `Luthiery`, `Arrangements`, `Flashmob`,
  `FlashmobSession` still need the same look -- most plausibly Floor (an org-wide view, likely
  wireable to `listGoals`+`listWorkersForGoal` per Goal) and Inbox (approvals -- likely wireable to
  the existing critical-action request/approve-and-run surface) first, since those two map to
  already-real backend capability; Luthiery/Arrangements/Flashmob look like Phase 6+ speculative
  concepts (persona tuning, scheduling, ad-hoc rapid-response tasking) with no current backing
  capability at all.


## 2026-09-06 (continued) — Inbox and Home hardened: removed a fabricated fake conversation

- `Inbox.tsx` previously simulated three entirely fabricated "approval" scenarios, each with a
  scripted fake back-and-forth chat with a bot "concertmaster" that replied with canned text
  regardless of what the user typed (`DiscussThread`) -- this was not just unwired, it was actively
  misleading (a real-looking conversation with nothing behind it). Investigated whether it could be
  wired for real first: confirmed the authority model (`packages/authority`,
  `packages/persistence/src/authority.ts`) has no durable "pending approval request" record at all
  -- a `require_approval` decision is evaluated fresh on every call and never persisted, so there is
  currently nothing to list. Removed the fabricated scenarios and the fake chat entirely rather than
  leave a misleading feature in place; the panel now states this exact architectural gap via
  `EmptyState` and points at what already works instead (approve-and-run once the caller already
  knows the action). The one part that was already easy to make real -- recent certifications -- is
  now wired to `useGoalDetail()`'s real `certifications`, same pattern as Evidence Log.
- `Home.tsx`'s "3 pending approvals" card had a hardcoded, now-doubly-wrong count (Inbox cannot list
  pending approvals at all); changed it to a plain "inbox" label with an honest sub-caption. Its
  "send" button for briefing the concertmaster from free text was a silent no-op (no handler at
  all); disabled it with an explanation that turning free text into a real Task Contract needs a
  substance-authoring flow that doesn't exist yet, while noting Task Contract creation itself
  already works today through the CLI.
- Verified: root `tsc -b` clean, `apps/secretary`'s `tsc -p tsconfig.renderer.json --noEmit` clean,
  `apps/secretary`'s `vite build` succeeds (1702 modules), root `npm test` unchanged: **109 files
  (59 passed, 50 skipped), 806 tests (455 passed, 351 skipped), 0 failed**.
- Remaining triage: `Floor`, `Luthiery`, `Arrangements`, `Flashmob`, `FlashmobSession`. Floor
  (org-wide view) is the next plausible real-wiring candidate (`listGoals` + per-Goal worker
  counts); the other four look like Phase 6+ speculative concepts (persona tuning, scheduling,
  ad-hoc rapid-response tasking a.k.a. the already-deferred "Vanguard" idea from plan/extra.md)
  with no current backing capability, and are candidates for the same disable-and-explain
  treatment rather than real wiring.


## 2026-09-06 (continued) — remaining views triaged: Arrangements wired for real, four marked honest preview

- Finished triaging every remaining mock view individually rather than assuming each needs real
  wiring:
  - **Arrangements** was wireable for real. Found `packages/persistence/src/improvement-digest.ts`'s
    `listImprovementDigests` already existed (from the earlier Phase 6 Slice 1 merge) with its own
    real-PostgreSQL test coverage, but had zero HTTP/CLI/UI exposure -- the third such gap found
    this session (after Git integration state and per-Goal workers). Added `ImprovementDigestSchema`/
    `ImprovementDigestListSchema` contracts, `ReadStateService.listImprovementDigestsForGoal`
    (operator-scoped, matching the persistence function's own `assertProjectMembership` call, not
    the generic `assertGoalProject` pattern used elsewhere since this function authorizes by
    operator identity), a new `GET /v1/goals/:goalId/improvement-digests` route, a typed
    `ApiClient` method, a new `improvement-digests list` CLI command, and a new `apiBridge.ts`
    allowlist entry. `Arrangements.tsx` now renders real digests (decision, trigger, confidence,
    situation, observed result, metrics) instead of four fabricated tabs (active/candidates/encore
    council deliberation/negative evidence) simulating a shadow-replay/rollout lifecycle that does
    not exist in the domain model yet (Phase 6 Slice 1 is deliberately append-only-digest scope
    only, per its own plan note).
  - **Floor** (org radial-tree SVG) and **Luthiery** (tool/skill registry) have no current backing
    capability for their specific claims (no durable "list active workers positioned in a tree" or
    "tool/skill registry" concept exists) and are legitimately expensive to make real (a dynamic
    layout engine, a whole new registry subsystem). Added explicit "illustrative diagram, not
    wired yet" / "illustrative example entries, not wired to a real registry yet" captions instead
    of pretending, and removed Floor's one specific fabricated claim ("1 approval pending" ->
    "approvals pending (illustrative)").
  - **Flashmob**/**FlashmobSession** implement the "Vanguard" rapid-response concept, which
    `plan/extra.md` and this project's own naming-decision note explicitly deferred beyond Phase 2.
    Added the same honest "deferred feature, not wired to a real backend yet" captions and disabled
    the composer (previously a silent no-op with no `onClick` at all).
- Verified: root `tsc -b` clean, `apps/secretary`'s `tsc -p tsconfig.renderer.json --noEmit` clean,
  `apps/secretary`'s `vite build` succeeds (1703 modules), root `npm test` unchanged: **109 files
  (59 passed, 50 skipped), 806 tests (455 passed, 351 skipped), 0 failed** (no new persistence test
  needed -- `listImprovementDigests` already had real-PostgreSQL coverage from the earlier Phase 6
  merge; only the route/client/CLI/UI wiring is new this pass).
- **All 13 Secretary views are now triaged.** Seven are real (Dashboard, Evidence Log, Billing,
  Channel, Git, Settings' connection panel, Arrangements); the remaining six (Home, Inbox, Floor,
  Luthiery, Flashmob, FlashmobSession, and Settings' providers/models/authority/danger panels) are
  each explicitly, honestly labeled as preview/deferred with every non-functional control disabled
  -- none silently pretend to work. This closes the "Secretary is a fully mocked prototype" finding
  from earlier in this session; it is now a real, if partial, operator console.


## 2026-09-06 (continued) — real Discord signal delivery transport; closed the "no delivery transport configured" gap

- Investigated the known gap from earlier in this session (`apps/discord/src/main.ts:89`'s `main()`
  always throwing "No delivery transport configured"). Found the receiving side was also entirely
  missing: `packages/persistence/src/discord.ts`'s `recordDiscordSignal` (HMAC-verified,
  replay-protected, already real-PostgreSQL tested from earlier Phase 4 work) had zero HTTP
  exposure -- no control-plane route existed to receive a signal at all. This was the fourth such
  "real backend capability, zero wiring" gap found this session.
- Added the receiving side: `AuthenticatedDiscordSignalSchema`/`StoredDiscordSignalSchema` contracts,
  a new optional `discordSignalService` dependency on `buildServer` (fails closed with 503 via the
  existing `DurableStoreUnavailableError` pattern when unconfigured, exactly like every other
  optional service), a new authenticated `POST /v1/discord/signals` route, a new
  `MAESTRO_DISCORD_SIGNAL_CREDENTIAL` control-plane config value (optional; the route stays
  unavailable until explicitly set, matching this project's fail-closed convention), and a new
  `discord_signal_rejected` stable API error code. Bearer auth (same as every other route) proves
  the caller holds a real operator credential; the signal's own HMAC signature is a second,
  independent layer proving it came from the configured Discord watchdog source specifically.
- Added the sending side: `apps/discord/src/main.ts`'s `createHttpDelivery` (real `fetch` POST with
  the exact signed envelope and a bearer token) and `resolveDelivery`, which still fails closed
  with the original clear error message when `DISCORD_TARGET_API_URL`/`DISCORD_TARGET_API_TOKEN`
  aren't configured -- the durable local buffer already retries automatically once they are, no
  signal is ever silently dropped either way.
- Cleaned up an unrelated stray artifact found while investigating: `apps/firefly/dist` was leftover
  untracked (gitignored) build output from an earlier "Firefly" rename attempt with no committed
  source anywhere in the repo's history; removed it as noise, not a functional change.
- Added focused tests: `apps/discord/src/discord.test.ts` (+4 cases: real POST with exact
  envelope/bearer header, non-2xx rejection, fail-closed-with-no-target, builds-when-configured) and
  a new `apps/control-plane/src/discord-signal-route.test.ts` (+4 cases: 401 without auth, 503
  without a configured service, 201 with the exact stored record on success, 400 on a rejected
  signal) -- all 8 run and pass without a real database, using the same `buildServer({...fakes})` +
  `app.inject()` pattern as the existing `critical-action-route.test.ts`.
- Verified: root `tsc -b` clean, `apps/secretary`'s full build (`tsc -b` + renderer typecheck +
  `vite build`, 1703 modules) unaffected, root `npm test` (no DB in this runtime): **110 test files
  (60 passed, 50 skipped), 814 tests (463 passed, 351 skipped), 0 failed** (463 = prior 455 + 8 new).
- Not yet done: an actual running Discord watchdog source that produces real `DiscordSignal`
  observations (the current codebase only has the buffering/delivery/receiving plumbing and test
  fixtures -- no real health-probe/anomaly-detection producer exists anywhere), and the separate
  "Maestro -> Discord/desktop" *outbound* emergency-notification channel plan/phase4.md #46
  describes is still not implemented (this slice closed the inbound signal-ingestion direction
  only).


## 2026-09-06 (continued) — continuous Metronome loop composed (Track A6)

- Added `apps/control-plane/src/metronome-loop.ts`'s `createMetronomeLoop`: a scheduled poller
  that, on a fixed interval, queries every currently non-terminal Goal (reusing
  `TERMINAL_GOAL_STATES`/`isTerminalGoalState`'s own definition of terminal, not a new one) and
  runs the exact same `scanGoalForMetronomeFindings` write path an operator-triggered `metronome
  scan` command already uses -- this closes the "Metronome is a one-shot callable, not a
  continuous scheduled/event-driven loop" gap from the Phase 5 remediation plan (Track A item 6),
  without inventing a second rule engine or duplicating the existing scan logic.
- A Goal whose lease is contended or whose control latch blocks scanning is reported as an
  `"error"` outcome via an optional `onTick` observability callback and skipped for that tick --
  it never stops the rest of the pass or a future tick, and the loop only ever runs one pass at a
  time (an overlapping tick while a prior pass is still in flight is a safe no-op, not a queued or
  duplicate pass).
- Wired into `apps/control-plane/src/main.ts`'s composition: `metronomeLoop.start()` on `listen()`
  (after migrations/reconciliation/`app.listen`, matching this project's existing "durable state
  first, traffic second" startup order), `metronomeLoop.stop()` on `close()`. Gated behind a new
  optional `MAESTRO_METRONOME_INTERVAL_MS` config value; the loop simply does not exist when unset,
  matching this session's other new-capability fail-closed-until-configured convention (Discord
  signal credential, TLS for remote binds) and deliberately not changing behavior for the many
  existing integration tests that construct `createControlPlane(...)` without expecting a
  background scanner touching their `goals` table.
- Added 4 focused unit tests (`metronome-loop.test.ts`) covering: scans every non-terminal Goal
  and reports each outcome; isolates one Goal's error from the rest of the pass; schedules/clears
  the interval correctly; never runs two overlapping passes concurrently. All use an injected
  `scanGoal` (a new test-only override point, mirroring this project's existing kernel/effect
  override pattern) rather than letting the loop reach the real durable scan against a fake pool.
- Verified: root `tsc -b` clean, `apps/secretary` build unaffected, root `npm test` (no DB in this
  runtime): **111 test files (61 passed, 50 skipped), 818 tests (467 passed, 351 skipped), 0
  failed** (467 = prior 463 + 4 new).
- Explicitly deferred, not done in this slice: expanding the rule set itself (the already-known
  gap that it omits unsupported-claims/circular-discussion/activation-cycle/scope-budget-authority-
  divergence/unreviewed-integration findings from plan/phase3.md) -- this slice is the scheduler
  only, reusing the existing rule set unchanged; and a decision on whether the loop should default
  to on with a sane interval in production rather than opt-in, which is a product/ops policy
  choice, not a technical one, left for the next explicit decision point.


## 2026-09-06 (continued) — device hardening triage: Track B4 grant-revocation cascade closed; B3/B5 found already resolved

- Audited the remaining Phase 5 Track B device items (3-8) directly against the current
  `packages/persistence/src/device-agent-runtime.ts` before assuming task_plan.md's Track B list
  was still accurate (it was stale again, same pattern as the Secretary/Metronome/Discord findings
  earlier this session -- the Track B1-B2 slice had already closed more than its own name implies):
  - **Track B5 (typed application/data/network scope enforcement) is already fully implemented.**
    `checkScope` in `device-agent-runtime.ts` checks `actionTypes`, `projectPaths`, `applications`,
    `dataScope`, and `networkScope` against the durable grant before every command claim -- not a
    gap. Not re-implemented.
  - **Track B3 (authenticated command dispatch, durable pre-effect claims) is already
    implemented.** `device_command_claims` records an immutable pre-effect claim before any OS
    effect, and `completeDeviceAgentCommand` requires the exact session/sequence/action/target and
    capability token to match the claim before recording a result -- a forged or replayed
    completion is already rejected. A literal per-result Ed25519 signature (beyond the mTLS session
    + capability-token binding already enforced) would be marginal additional hardening, not a
    functional gap; left as a possible future refinement, not implemented this pass.
  - **Track B4 (device revocation cascading to issued grants) had a real, narrow gap.**
    `revokeDevice` already made every future command claim impossible (`checkLive` in
    `device-agent-runtime.ts` already rejects any claim once `devices.state = 'revoked'`), but
    `device_grants.state` itself was never updated, so `listDeviceGrantsForGoal`/`readDeviceGrant`
    durably read a revoked device's grants as still `active` -- a read-model consistency gap, not
    a security hole (the enforcement layer was already correct). Fixed:
    `revokeDevice` now also updates every currently `active` grant for that device to `revoked`
    (with `revoked_at`) in the same transaction, across every Goal the device holds a grant for.
    This is a CEO-authorized, cross-Goal admin action and deliberately does not require a
    per-Goal lease proof for each affected grant, the same way `revokeAuthorityRecord` needs none.
- Added a focused real-PostgreSQL regression in `device-grant.integration.test.ts` covering two
  Goals: one grant only reachable via device revocation cascade, one already independently
  revoked beforehand (proving the cascade does not overwrite an already-revoked grant's
  `revokedAt`). Not run against real PostgreSQL in this runtime (no Docker here); self-verified
  for type correctness and skip-registration only.
- Verified: root `tsc -b` clean, root `npm test` (no DB in this runtime): **111 test files (61
  passed, 50 skipped), 819 tests (467 passed, 352 skipped), 0 failed** (352 = prior 351 + 1 new,
  DB-gated skip).
- Remaining Track B items, now down to 6, 7, 8: disconnect/dependent-work pause lifecycle (no
  device session/heartbeat/disconnect state exists yet beyond the mTLS session table itself),
  Metronome device-access observation rules (Metronome never reads device/grant/result state),
  and durable automatic grant expiry/closure (currently only rejects at claim time;
  `device_grants.state` never transitions to `expired`/`closed` on its own). Each is a real,
  separate, moderate-sized slice, not attempted in this pass.


## 2026-09-06 (continued) — durable automatic device-grant expiry/closure (Track B8)

- Closed Phase 5 Track B8: `device_grants.state` previously only ever transitioned via explicit
  `revokeDeviceGrant`/the new revocation-cascade; a naturally lapsed grant (past its own
  `expires_at`, or its Goal reaching a terminal state) was rejected in memory by `checkLive` on
  every claim attempt but never durably marked `expired`/`closed`, so `listDeviceGrantsForGoal`
  kept reading it as `active` forever.
- Added `closeGrantIfLapsed` in `packages/persistence/src/device-agent-runtime.ts`, called with the
  grant row already locked inside `claimDeviceAgentCommand` right before the existing `checkLive`
  rejection: a grant whose Goal is terminal durably closes (`state = 'closed'`); a grant past its
  own expiry durably expires (`state = 'expired'`). Both are opportunistic (triggered by the next
  claim attempt, not a separate sweep), safe under the existing append-only/terminal-state-final
  trigger on `device_grants`, and change nothing about the actual authorization outcome -- the
  claim was already rejected either way; this only makes the durable record agree with reality.
- Added 2 focused real-PostgreSQL regressions in `device-agent-runtime.integration.test.ts`: one
  proving a grant past its own expiry closes to `expired` on the next claim attempt, one proving a
  grant whose Goal reached `succeeded` closes to `closed`. Not run against real PostgreSQL in this
  runtime (no Docker/local Postgres available here); self-verified for type correctness and
  skip-registration only.
- Verified: root `tsc -b` clean, root `npm test` (no DB in this runtime): **111 test files (61
  passed, 50 skipped), 821 tests (467 passed, 354 skipped), 0 failed** (354 = prior 352 + 2 new,
  DB-gated skips).
- **All of Phase 5 Track B's device items are now closed except 6 and 7**: disconnect/
  dependent-work pause lifecycle (no device session/heartbeat/disconnect tracking beyond the mTLS
  session table itself) and Metronome device-access observation rules (Metronome never reads
  device/grant/result state). Both remain open, moderate-sized, separate slices.


## 2026-09-06 (continued) — Metronome device-access observation rule (Track B7, partial)

- Closed part of Phase 5 Track B7 ("Metronome never reads device/grant/result state"). Added
  `packages/domain/src/metronome.ts`'s `detectDeviceCommandUnknownOutcomeFindings` and a new
  `"device_command_unknown_outcome"` rule id, wired into `scanGoalForMetronomeFindings`
  (`packages/persistence/src/metronome.ts`) via a new query against `device_command_claims WHERE
  goal_id = $1 AND state = 'unknown'`.
- Scoped this pass to exactly one concrete, unambiguous case rather than guessing at the original
  Track B7 wording's three vague sub-cases ("expired grant use, unexpected target, unexpected side
  effect"): a device command claim durably marked `unknown` after
  `markUnresolvedDeviceAgentCommandsUnknown` (a device-agent restart left a real OS-side effect's
  outcome genuinely unresolvable) is exactly an "unexpected side effect" -- the system does not
  know whether it happened, so it must not sit silently in a device-only table; a human needs to
  see it as a durable, auditable Metronome finding. "Expired grant use" and "unexpected target" are
  already actively *rejected* before any effect runs (`checkLive`/`checkScope` in
  `device-agent-runtime.ts`) rather than occurring and needing after-the-fact detection, so they
  are not additional findings to add here -- prevention, not detection, is the correct control for
  those two.
- Added 2 domain unit tests (`metronome.test.ts`, both pass) and 1 real-PostgreSQL integration
  regression (`metronome.integration.test.ts`, enrolls a device, issues a grant, inserts a claimed
  command, forces it `unknown` via the real crash-recovery path, scans, and asserts exactly one new
  finding with the correct evidence identity/details, then a silent rescan). Not run against real
  PostgreSQL in this runtime (no Docker/local Postgres here); self-verified for type correctness
  and skip-registration only.
- Verified: root `tsc -b` clean, `apps/secretary` build unaffected, root `npm test` (no DB in this
  runtime): **111 test files (61 passed, 50 skipped), 824 tests (469 passed, 355 skipped), 0
  failed** (469 = prior 467 + 2 new domain unit tests; 355 = prior 354 + 1 new DB-gated skip).
- **Only Track B6 (disconnect/dependent-work pause lifecycle) remains open.** Investigated it
  directly: `device_agent_sessions` already tracks connect/heartbeat/disconnect state fully
  (`openDeviceAgentSession`/`touchDeviceAgentSession`/`closeDeviceAgentSession`), and
  `claimDeviceAgentCommand` already refuses any new command once a session is disconnected -- so
  the "does dependent work stop trying to use a disconnected device" half of B6 is already
  correct. What is missing is a domain concept of "work that depends on a device" at all: neither
  workers nor Department Plan items declare a device dependency anywhere, and Goal-level
  pause/resume is the only existing pause granularity (no worker-level pause distinct from
  cancel). Implementing "pause only dependent work" correctly needs that concept added first --
  this is a real design decision (what unit of work becomes "dependent," and what pause primitive
  it uses), not a wiring gap, and was deliberately not forced in this pass to avoid inventing an
  under-specified abstraction. Recorded here as the one explicit open decision blocking full Track
  B closure.


## 2026-09-06 (continued) — canonical Phase 5 begins: cross-Goal isolation regression (readiness check)

- Started canonical Phase 5 (`plan/phase5.md`, "Concurrent Goals and Portfolio Control") --
  distinct from this session's earlier "Phase 5 remediation plan" (an internally-numbered bridge
  effort, now substantially closed; see the earlier naming-collision note in this file).
  Canonical Phase 5 has no capacity model, admission control, or Portfolio Council anywhere in the
  codebase yet -- a genuinely new feature area, not a wiring gap.
- Before adding any new scheduling/capacity machinery, verified the foundational assumption it
  would be built on: that the existing per-Goal-identity architecture already isolates concurrent
  Goals correctly. Added
  `apps/control-plane/src/concurrent-goals-isolation.integration.test.ts` (4 real-PostgreSQL
  regressions, directly mapped to plan/phase5.md's own Tests #2 and #6): two Goals in one project
  keep distinct budget envelopes; two Goals can each hold their own device grant against the same
  enrolled device without collision; two Goals keep distinct improvement digests and a reader
  without project membership is rejected; and every derived read (`getBudgetSummary`,
  `listWorkersForGoal`, `getGitIntegrationState`) rejects a Goal/project pair that does not match.
  Deliberately scoped to the lightest fixtures (budget/device-grant/improvement-digest, all of
  which need only a bare Goal row, not a full Council/Plan/Worker pipeline) rather than a slower,
  heavier full-pipeline two-Goal test, since the isolation property being proven is the same either
  way (goal_id-scoped WHERE clauses and project-membership checks), not something only a full
  pipeline could reveal.
- Not run against real PostgreSQL in this runtime (no Docker/local Postgres here); self-verified
  for type correctness and skip-registration only.
- Verified: root `tsc -b` clean, root `npm test` (no DB in this runtime): **112 test files (61
  passed, 51 skipped), 828 tests (469 passed, 359 skipped), 0 failed** (359 = prior 355 + 4 new,
  DB-gated skips).
- Next real Phase 5 slice: `plan/phase5.md`'s work-sequence step 2, resource inventory/demand
  reservations/protected floors/admission control -- genuinely new capacity-tracking machinery,
  not an extension of an existing capability. This is a substantially larger design/implementation
  effort than anything closed so far this session and is the recommended next checkpoint before
  continuing further.


## 2026-09-06 (continued) — Phase 5 capacity model, first slice: project-wide worker-slot admission control

- Started `plan/phase5.md`'s work-sequence step 2 (resource inventory / admission control), scoped
  to the smallest real slice rather than the full multi-resource capacity model in one pass:
  `packages/persistence/src/worker.ts`'s `countActiveWorkersForProject(pool, projectId)` counts
  workers in `spawned`/`running` state across every Goal in a project (a plain, real read -- not a
  fabricated estimate); `apps/control-plane/src/worker-service.ts`'s `spawn()` now checks this
  count against an optional `maxConcurrentWorkersPerProject` ceiling before doing any other work,
  throwing a new `WorkerCapacityExceededError` when at or over the limit.
- New `MAESTRO_MAX_CONCURRENT_WORKERS_PER_PROJECT` config value; absent by default (unlimited,
  current behavior unchanged), matching this session's established fail-closed-until-configured
  convention for new capacity/authority surfaces. Mapped to a new `worker_capacity_exceeded` stable
  API error code (429).
- **Deliberately simplified from plan/phase5.md's full capacity model** ("worker slots by risk
  class," "CPU/memory/storage/browser/environment resources," "enrolled-device exclusivity,"
  "repository/worktree conflicts," "Quality/Security/Safety/Council validation capacity,"
  "recovery reserve") to one flat project-wide worker-slot ceiling. This is an explicit, named
  simplification, not a claim of completing the full capacity model -- risk-class partitioning and
  the other resource dimensions are separate, larger follow-up slices.
- **Also deliberately not a queue.** plan/phase5.md's own scheduler behavior calls for "queue
  rather than degrade all active Goals when capacity is exhausted"; this slice only rejects
  cleanly with a distinguishable error and a clear message telling the caller to retry once a slot
  frees, so a client can build a real queue/backoff on top -- building an actual server-side queue
  is a separate, larger piece of work than admission control itself.
- Added a real-PostgreSQL regression (`worker.integration.test.ts`) proving the count is 0 for an
  unrelated project, 1 once a worker is spawned, and back to 0 after that worker is cancelled (a
  terminal worker no longer occupies a slot). Not run against real PostgreSQL in this runtime (no
  Docker/local Postgres here); self-verified for type correctness and skip-registration only.
- **Known, explicit coverage gap:** the `worker-service.ts` admission-check wiring itself (the
  `if (active >= cap) throw` guard) is not covered by a service-level integration test in this
  pass -- `createWorkerService.spawn()` isn't currently designed for dependency-injected unit
  testing of its persistence calls (unlike `metronome-loop.ts`'s deliberately injectable
  `scanGoal`), and building the full Council/Plan/Bundle/operator-role fixture needed for a
  real-PostgreSQL service-level test was judged not worth its size relative to the guard's own
  triviality (a three-line early-return). The underlying count function it depends on is fully
  proven; the guard itself is the next thing to add coverage for if this slice is revisited.
- Verified: root `tsc -b` clean, `apps/secretary` build unaffected, root `npm test` (no DB in this
  runtime): **112 test files (61 passed, 51 skipped), 829 tests (469 passed, 360 skipped), 0
  failed** (360 = prior 359 + 1 new, DB-gated skip).
- Remaining canonical Phase 5 work-sequence steps (per-Goal Prime Agent context isolation already
  holds structurally per the earlier cross-Goal isolation regression; repository/device exclusivity
  constraints; safe pause-point declarations; Portfolio Council; CEO pinning; forecasts in
  app/CLI; concurrency/fairness/contamination tests; a real competing-Goal live scenario) remain
  open, each a separate, substantial slice.

## 2026-09-06 — Progress check and documentation reconciliation

- Reconciled the live repository against the planning documents. `main` is clean at `95bef8e` and matches `origin/main`.
- Confirmed `npm run build` passes. Confirmed `npm test` passes without PostgreSQL: 61 files/469 tests passed and 51 files/360 tests skipped; no failures.
- The latest implementation is the Phase 5 first capacity slice: project-wide worker-slot admission control. It intentionally does not implement the complete multi-resource model or a server-side queue.
- Corrected the current pointer conceptually: the next Phase 5 work is resource inventory/demand reservations/protected floors/admission-control expansion.
- PostgreSQL-backed acceptance evidence is still pending because this environment has no Docker/local PostgreSQL.


## 2026-09-06 — Maestro TUI bounded shell hardening
- Built the independent `maestro` terminal TUI above the typed API client, with workspace/Git-root detection, Maestro/Concertmaster branding, truthful Control Plane health, session metadata, dashboard reads, activity timeline, slash parsing/autocomplete, command palette shortcuts, write routing, and approval dialog.
- Added durable event cursor persistence, event identity deduplication, bounded reconnect attempts with visible retry/exhaustion messages, and session attach/new/retry commands. Session files are validated and forced to mode `0600` in mode `0700` directories.
- Added CLI spelling aliases (`critical-action`, `workers`, `metronome-challenges`, `encore-council`, `certifications`, and `concertmaster-report`) and project-binding regression coverage for JSON payloads.
- Critical permission changes fail closed in the TUI until they are bound to the Control Plane durable approval endpoint. Fail-safe emergency stop remains a direct server-authorized control path; local Git branch/worktree operations follow the server's ordinary classification.
- Verification after hardening: `npm run check` passed with 539 tests and 360 environment-gated skips; `npm run build` and `git diff --check` passed. PostgreSQL/real-process/Prime acceptance remains unrun in this environment.


## 2026-09-06 — Maestro TUI fail-safe confirmation hardening

- Classified `goal emergency-stop` and `metronome safe-pause` as critical safety actions in the
  command registry. Both now require explicit local confirmation before dispatch.
- Preserved the durable-approval fail-closed rule for permission and other critical mutations;
  emergency stop remains allowed only as the Control Plane's server-authorized fail-safe path.
- Added cancellation and approved-dispatch regression tests for emergency stop and updated
  command-palette/registry safety classifications.
- Verified: targeted TUI command tests pass (15 tests), `npm run check` passes (84 files passed,
  51 skipped; 540 tests passed, 360 skipped), `npm run build`, and `git diff --check` pass.


## 2026-09-06 — Maestro TUI first-run project discovery

- Added an authenticated `GET /v1/projects` Control Plane route backed by active
  `operator_project_memberships`; the route fails closed when discovery is not composed.
- Added the typed `ApiClient.listProjects()` contract and schema.
- A workspace with no saved project now auto-attaches when exactly one authorized project is
  visible, persists the validated session metadata, and never guesses when there are zero or
  multiple projects. Added `/projects list` and `/session attach --project-index=<n>` for the
  multi-project case while retaining the explicit project-ID fallback.
- Added API, server, and resolver tests for authenticated discovery, unavailable composition,
  single-project auto-attach, empty/ambiguous results, and attachment preservation.
- Verification: focused tests pass (65 tests), `npm run build` passes, and `git diff --check`
  passes.


## 2026-09-06 — Maestro TUI typed read parity

- Wired the existing typed Control Plane reads for Task Contract, Council, Department Plan,
  and Mission Bundle into the TUI read-command path. Each validates required identifiers and
  returns a concise durable record summary instead of a false "not wired" state.
- Mission Bundle `--plan-version` is validated as a positive integer before any client call.
- Added regression coverage for all four routes and invalid version input.
- Verification: `npm run check` passes (84 files passed, 51 skipped; 548 tests passed,
  360 skipped), `npm run build`, and `git diff --check` pass.


## 2026-09-06 — Maestro TUI Goal selection and project read command

- Added local `/goal select --goal-id=...` context selection. The TUI validates the selected
  Goal through the authenticated, project-bound `getGoal` API before persisting only the
  workspace session metadata; it does not mutate durable Goal state.
- Added `/projects list` to the normal typed read path, while retaining indexed project attach
  for first-run multi-project workspaces.
- Added session, registry, and read-command regression coverage.
- Verification: focused tests pass (22 tests), `npm run build` passes, and `git diff --check`
  passes.


## 2026-09-06 — Maestro TUI Metronome scan classification fix

- Corrected `metronome scan` from read to write in the TUI registry. The existing typed
  `scanMetronome` route is an idempotent POST and was otherwise unreachable because the read
  boundary rejected it before the implemented write handler.
- Added registry and dispatch regression coverage.
- Verification: targeted command tests pass (16 tests), `npm run build` passes, and
  `git diff --check` passes.
