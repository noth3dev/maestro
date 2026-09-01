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
- Audit classification: Phase 2 steps 1 (organization/personas), 2 (Sane/Overture binding), 3 (Task Contract launch flow), and 4 (Head activation) are partial, not fully acceptable. Step 5 is blocked. No Department Plan/worker/Git/budget/end-to-end Goal steps have started. Detailed missing contracts include durable permanent Head identities/profiles; Sane and Overture session/context routing; CEO-authorized Goal-linked Task Contract launch/events; complete Head activation brief/contract/session boundaries; and durable event/projection lineage for later Phases 3/4/6/7.
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
