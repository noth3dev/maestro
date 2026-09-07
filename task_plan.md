# Maestro Phase 1–2 Execution Plan

## Goal
Complete the remaining Phase 1 durable control-plane safety foundations, then implement Phase 2 hierarchical execution for one local software Goal.


## Operating protocol
Read `docs/OPERATING_PROTOCOL.md` first, every session, before doing anything else. It has the session-resume checklist, git/worktree hygiene, disposable-DB container hygiene, subagent spawn rules (model/thinking-level/dead-child handling), and the commit checkpoint policy. This section stays a one-line pointer so the protocol has a single source of truth.

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


## Current cutover status — 2026-09-08

- Prime execution package, dependency, lockfile entries, source imports, and configuration field have been removed.
- Control Plane composition uses the native Model Gateway execution kernel or an explicit fail-closed unavailable kernel.
- Worker model authorization, host context, capability grants, account bindings, idempotency, Head/Encore/semantic-review seams, and bounded team-lead child admissions are covered by focused tests.
- Post-deletion no-database check: `npm run check` passed with 102 files / 665 tests and 52 PostgreSQL-gated files / 375 skipped tests.
- Real loopback Model Gateway HTTP acceptance passed with a fake provider and no credential leakage. Full PostgreSQL rerun and remaining Phase 1 operational failures are still open.

## Phases
- [complete] 1. Reconcile current code with Phase 1 requirements; define the smallest safe remaining vertical slice.
- [complete_with_environment_gate] 2. Implement and verify Phase 1 lease/fencing persistence and guarded state-changing writes.
- [complete_with_environment_gate] 3. Complete remaining Phase 1 command/recovery/evidence boundaries required by Phase 2. Tag `phase1-accepted` at `541ce7d`.
- [in_progress] 4. Implement Phase 2 Task Contract and Secretary intake vertical slice. Organization/personas (`2e8e5a5`), Overture Task Contract (`c653760`/`c89042d`), Head activation (`b835564`/`ac65c8d`) done on branches, not yet merged to `main`.
- [complete] 5. Head Council sealed-submission slice (P2S5) accepted after independent review and real-PostgreSQL verification on `phase2/p2s5-integration` (7a627a2): 254 passed, 1 intentional skip, 0 failed. See "Phase 2 detailed status" below for accepted boundary. Department Plans (P2S6) and beyond not started; in_progress.
- [complete_pending_independent_review] 6. Full Phase 2 work-sequence (steps 6-12) implemented and self-audited on `phase2/p2s5-integration` (fc79c6c): 331 passed, 0 failed. A cross-cutting Council departmentOwnership authorization gap (Department Plan/budget/Git-branch creation) was found and fixed in this final self-audit. P2S5/P2S6 independently reviewed; P2S7-P2S12 self-reviewed only (subagent independent review unavailable throughout this session's back half). Proceeding to Phase 3 per user direction.
- [complete] 7. Phase 3 (plan/phase3.md) work-sequence steps 1-10 on `phase3/integration` (`699dee1`), real-PostgreSQL verified: 453 passed, 1 intentional provider live-gate skip, 0 failed.
- [complete] 8. Phase 3 step 11 (complete live release scenario) fully closed: live Prime worker execution proven (`MAESTRO_LIVE_PRIME=1`), full unsupported-assertion Encore Council round proven, forced mid-flight restart/reconciliation proven, and Tests item 18 (CLI/app parity) proven with a real-PostgreSQL end-to-end fixture (`apps/control-plane/src/read-state-parity.integration.test.ts`) asserting the CLI and `@maestro/api-client` return identical Metronome challenge, Encore Council round, certification, and Concertmaster report state for the same real Goal through a live HTTP server. Final real-PostgreSQL `npm run check`: 459 passed, 2 provider live-gate cases skipped by default, 0 failed. **Phase 3 exit gate: all 13 live-gate steps and all 18 Tests items evidenced.** Secretary UI has no dedicated panel for these four record kinds yet (Goal/event loaders only) -- a UI-layer follow-up, not a gap in the API/CLI parity claim itself.
- [pending] 7. Run Phase 1–2 acceptance scenarios, document gaps, and report.
- [in_progress] 9. Phase 4 (plan/phase4.md) preparation: baseline branch `phase4/integration` created from accepted Phase 3 exit gate (`1effc49`), worktree `.worktrees/p4` added, build verified clean. Recommended two-track work-sequence split recorded in progress.md (Track A: environments+devices, steps 1-5; Track B: Discord, steps 6-9; step 10 integrates both). Playwright dependency not yet added (needed for step 3). Implementation not yet started.

## Next step
See "Phase 5 remediation plan — operational usability" below. Prior P1-P4 completion phase markers describe code/test status only and are not operational-acceptance claims; do not treat them as ready for normal use until Phase 5 tracks land.

## Next step (superseded — kept for history)
Phase 3 is fully exit-gate accepted (all 13 live-gate steps, all 18 Tests items). Main now carries the real Phase 2+3 source code (this merge). Next: decide whether to start Phase 4 Track A (environments/devices) and Track B (Discord) implementation, e.g. via parallel subagents in `.worktrees/p4`-derived worktrees, matching the pattern used throughout Phase 3.

## Errors encountered
| Error | Resolution |
|---|---|
| `rlm.find_models('luna max')` returned no catalog result | Use the inherited current execution model for subagents; user confirmed this is Luna. |

## Current runtime decision — native execution only

Maestro uses one provider-neutral `ExecutionKernelPort` implementation: the native runtime routed through the authenticated Model Gateway. There is no legacy execution adapter or fallback.

Every native admission carries host-owned context, an exact provider-qualified model policy, provider account binding, capability grant, lease/fencing context, and idempotency key. Mission Bundles authorize Worker models before gateway admission. Missing gateway configuration fails closed.

The native runtime boundary remains provider-neutral and supports future gateway-backed providers without adding a second execution runtime. Each provider must still satisfy the normalized execution, authority, audit, cancellation, usage, and recovery contract with independent evidence.

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
- `phase2/overture-role-refresh`: at `ac65c8d` with an uncommitted, uncomitted-but-inspected WIP diff (`packages/domain/src/task-contract.ts`/`.test.ts`, 2 files, +62/-9). It renames the placeholder Overture role IDs (`project-context-scout`, `requirements-analyst`) to the plan's actual canonical six-role pool (`conversation-lead`, `architecture-analyst`, `external-research-scout`, `security-evaluator`, `design-mock-specialist`, `task-editor` — see plan/phase2.md "Concertmaster and Task Contract flow") and adds `canonicalizeOvertureRoles` for legacy-value migration. This is a real, in-scope fix, not stale/junk. Not yet committed or test-run this session.
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
8. Scout and Execution worker lifecycles through the native runtime hierarchy. **Not started.**
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
- Phase 3 scope then begins with Encore/Metronome, independent certification, durable evidence bundle, and Concertmaster final report. Do not begin Phase 3 implementation while Phase 2’s current Council/Head/Contract acceptance blockers remain open.

## Phase 3 closeout status — 2026-09-03
- Step 10 (adversarial fixtures) is complete at the code/test level on `phase3/integration`: tests cover fabricated evidence/unsupported claims, same-model fake consensus and disagreement, seeded Quality defects, forged evidence references, and unauthorized remote push capability.
- Closeout hardening is included: Metronome challenge mutations require durable lease/role/session authorization; Prime production roots stay in the process repository context; certifications and reports bind to the exact launched Contract and immutable integrated revision; frozen revisions include accepted worker commits; and duplicate certification finding IDs are rejected at domain, waiver, and database boundaries.
- Verification gate: fresh `npm run check` reported 261 passed, 188 skipped, 0 failed. The skipped suites require PostgreSQL/Docker (unavailable here), so no real-PostgreSQL claim is made.
- Step 11, the full live release scenario, remains pending. Do not treat Phase 3 as fully exit-gate accepted until that scenario and the PostgreSQL environment gate pass.

## 2026-09-03 — P3S11 council unsupported-assertion round
- Added a real-PostgreSQL composition test that requests a semantic review of an unsupported natural-language claim, verifies the claimed-supported/no-evidence result is downgraded to `unsupported`, confirms the uncertainty trigger, and runs a complete Encore Council round.
- The round records each reviewer identity from `getModelIdentity`, labels the one-family fallback as `same-model-independent-review`, preserves minority dissent in synthesis, and proves sealed collection by checking zero persisted judgments during every reviewer prompt before all three are written.
- Focused verification passed: 7 passed, 0 skipped, 0 failed. Full `npm run check` is required before acceptance.


## Phase 3 step 11 split — CLI/app parity finding (2026-09-03)
- **Tests item 18 status: blocked by missing read surfaces.** Control-plane currently serves only Goal and event reads (`GET /v1/goals/:goalId`, `GET /v1/events`, and event SSE). CLI currently provides `goal get` and `events list`; Secretary loads and renders only Goal/events.
- No route, typed API-client method, CLI command, or Secretary loader exists for Metronome challenges, Encore Council state, certification state, or Concertmaster reports, although the durable domain/persistence modules exist. This branch records the evidence and does not invent a new aggregate endpoint.
- The minimal read contract is now implemented across control-plane, API client, and CLI. A real PostgreSQL app/API/CLI parity composition fixture remains to be added before claiming the item fully proven.

## 2026-09-03 — P3S11 CLI/app parity read contract implemented
- Added authenticated read-only control-plane routes for Metronome challenges, Encore Council rounds (including judgments and synthesis), Quality/conditional certifications, and Concertmaster final reports, backed by durable persistence reads. Added matching zod contracts, typed API-client methods, and CLI commands.
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
1. **[RESOLVED 2026-09-04, commits `fef8831`/`be490f8`]** `authenticateLocalOperator`
   (packages/persistence/src/auth.ts) previously ran an unfiltered SQL query and scrypt-derived
   against every credential row on every login attempt (O(n) CPU-amplification DoS vector).
   Fixed: bearer tokens are now a strict `credentialId.secret` envelope; the selector is
   canonical-UUID validated and looked up by indexed `WHERE c.credential_id = $1` (one row)
   before any KDF work runs; a missing/malformed selector or unknown credential never reaches
   scrypt. No raw-secret fallback; all callers/fixtures (control-plane, CLI, Secretary parity
   tests) migrated to the new envelope. Independently reviewed (parent-session direct review,
   not a subagent, after two review-subagent spawns died without replying and were deleted per
   dead-child protocol). Full real-PostgreSQL `npm run check` on `main` after merge: 94/95 files,
   590 passed, 2 intentional live-Prime skips, 0 failed. Residual documented risk (not this
   item's scope): no per-source rate limiter for repeated failed attempts against the same known
   selector — the fix removes CPU amplification, not brute-force throttling.
2. **[RESOLVED 2026-09-04, commit `eba0823`]** `execution-kernel.ts`'s `sessions`/`roots`/`children`
   Maps and `goal-service.ts`'s `leaseProofs` Map previously never evicted terminal-state entries.
   Fixed: added an optional `ExecutionKernelPort.release(invocation)` acknowledgement, called only
   by a caller that has already durably recorded the terminal outcome (worker.ts's observeWorker
   after a terminal status commits and cancelWorker after cancellation commits; semantic-review.ts's
   requestSemanticReview after its always-written row inserts; encore-council.ts's
   runEncoreCouncilReview after every reviewer's sealed judgment commits together); every release
   call is best-effort (never masks an already-succeeded durable write as a failure -- a real defect
   found and fixed during self-review). `goal-service.ts` evicts a Goal's lease proof once a command
   result reaches a terminal Goal state (`isTerminalGoalState`), never on a provider/DB/error path.
   Also fixed a related correctness bug: `getInvocationStatus` previously fabricated `"failed"` for
   any unregistered/released invocation; it now reports the domain contract's actual `"unknown"`.
   Self-verified via real-PostgreSQL `npm test` in the isolated worktree (blocked from a full
   `npm run build` there by the same node_modules-symlink dist-staleness limitation as item 1);
   independently re-verified by the parent session directly (no reviewer subagent available/reliable
   this session) after merge: fresh `main` build clean, full real-PostgreSQL `npm run check`:
   94/95 files, 604 passed, 2 intentional live-Prime skips, 0 failed.
3. **[RESOLVED 2026-09-04, commit `3649279`]** `MAESTRO_ALLOW_REMOTE=true` previously accepted a
   non-loopback bind with no TLS requirement. Fixed: `parseConfig` requires paired
   `MAESTRO_TLS_CERT_FILE`/`MAESTRO_TLS_KEY_FILE` together whenever the resolved host is
   non-loopback; `createControlPlane` enforces the same invariant again at the composition
   boundary (a caller can construct `MaestroConfig` directly, bypassing `parseConfig`), reads the
   cert/key files (failing closed before any listener exists if unreadable), and `buildServer` now
   constructs a real Fastify HTTPS listener, not just a config field. Verified with a real
   self-signed certificate generated via `openssl` in a real-PostgreSQL composition test: a remote
   `createControlPlane` call throws synchronously without TLS or with an unreadable key file; a
   real HTTPS request against the configured listener succeeds while a plain-HTTP request to the
   same port fails outright (protocol mismatch). Full real-PostgreSQL `npm run check` on `main`:
   94/95 files, 609 passed, 2 intentional live-Prime skips, 0 failed.
4. **[RESOLVED 2026-09-04, commit `1828350`]** No production-safe migration runner existed
   anywhere. Fixed: `packages/persistence/src/migrate.ts`'s `runMigrations(pool)` -- durable
   `schema_migrations` ledger (filename/checksum/applied_at), a single `pg_advisory_lock`
   serializing concurrent callers database-wide, applies only not-yet-recorded files (each in its
   own transaction), and fails closed with `MigrationChecksumMismatchError` if an already-applied
   file's content no longer matches its recorded checksum. Wired into
   `apps/control-plane/src/main.ts`'s `ControlPlane.listen()` before `reconcileOnStartup`. Also
   fixed a real defect found via a dedicated regression (not hypothetical): `applyAllMigrations`
   now populates the same ledger, since apps/control-plane's own composition-root integration
   tests already call it in `beforeAll` then `createControlPlane(...).listen()` against the same
   schema, and several of the ~30+ migration files with a bare (non-idempotent) `CREATE TRIGGER`
   would otherwise fail "already exists" on that second, ledger-less pass. Verified with 6 real-
   PostgreSQL cases (fresh apply, idempotent no-op, incremental apply, two-runner advisory-lock
   race, checksum-mismatch rejection, shared-ledger no-re-execution). Full real-PostgreSQL
   `npm run check` on `main`: 95/96 files, 615 passed, 2 intentional live-Prime skips, 0 failed.
5. **[RESOLVED 2026-09-04, commit `6c40393`]** fast-check property testing covered only
   `commands.ts` (`fencing.property.test.ts`); `reconciliation.ts`'s `renewReconcilerLeaderLease`
   had only example/`it.each` coverage -- the one real remaining Phase-1 fencing property gap
   (`auth.ts`/`authority.ts`/`evidence.ts` accept no `GoalLeaseProof`/fencing token at all, so a
   stale-fencing property does not apply there without an architectural change out of scope).
   Fixed: `packages/persistence/src/reconciliation.fencing.property.test.ts` adds 3 fast-check
   properties (stale/forged token, wrong-owner-at-current-token, and old-proof-after-takeover),
   each proving zero mutation of the singleton `reconciler_leader_lease` row and that the
   real/successor proof still works afterward. Full real-PostgreSQL `npm run check` on `main`:
   96/97 files, 618 passed, 2 intentional live-Prime skips, 0 failed. See Phase 2/3 items below
   for the remaining 10 modules across those phases with zero stale/forged fencing coverage --
   out of this Phase 1 item's scope.
6. **[RESOLVED 2026-09-04, commit `384d1e3`]** Evidence-hash corruption (Phase 1 Tests #9) was
   proven only at `getEvidenceMetadata`, never at the actual "certification consumers" the spec
   names. Fixed: narrowed `@maestro/evidence`'s `verifyEvidenceRecord` to a minimal
   `VerifiableEvidenceRecord` ({sha256, byteLength}) and threaded an optional
   `EvidenceContentReader` through `certifyQuality`/`certifyConditional` (verifies each cited
   evidence's real bytes before the pre-INSERT allow-list check), `assembleEvidenceBundle`/
   `recordEvidenceBundle` (verifies every evidence record for the Goal, since a bundle is a full
   snapshot), and `generateConcertmasterFinalReport` (threads through its existing `recordEvidenceBundle`
   call). Optional and behavior-unchanged when omitted, since no production write-command API
   surface exists yet for these three actions (a separate, already-tracked P0) -- this seam is
   available for that surface once it lands. Added one real-artifact (not synthetic
   sha256/byte_length=0) corrupted-hash regression per consumer via `FileEvidenceStore`, matching
   `evidence.integration.test.ts`'s existing corruption-test pattern; deliberately did not rewrite
   the rest of the test suite's pervasive synthetic-evidence-row convention, judged out of scope.
   Full real-PostgreSQL `npm run check` on `main`: 96/97 files, 622 passed, 2 intentional
   live-Prime skips, 0 failed.
7. **[RESOLVED 2026-09-04, commit `9a1d084`]** No test asserted
   `parseConfig`'s accepted key set excludes provider-credential-shaped env vars. Fixed:
   test-only regression (no production change needed -- zod's `z.object` already only
   destructures its own known keys) proving `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/
   `OPENROUTER_API_KEY` metronomes never appear in `parseConfig`'s output. Full real-PostgreSQL
   `npm run check` on `main`: 96/97 files, 619 passed, 2 intentional live-Prime skips, 0 failed.
8. **[PART 1/2 RESOLVED 2026-09-04, commit `fcd70b4`]** No project-scoped operator authorization
   existed (authentication only, no membership check in `server.ts`/`goal-service.ts`). Fixed:
   `packages/persistence/src/project-membership.ts`'s durable `operator_project_memberships`
   table/API (grant/revoke/assert/list; membership existence only for now, not per-action role/
   capability granularity, a documented future refinement), wired into `server.ts` via a new
   `preHandler` hook checking every request's stated projectId (body or query) before its route
   handler runs. The four read-state routes (Metronome/Council/certification/Concertmaster-report) carry no
   projectId at all and are not covered here -- that IDOR gap is Phase 3's already-tracked item 6,
   not silently claimed fixed by this change. Full real-PostgreSQL `npm run check` on `main`:
   97/98 files, 633 passed, 2 intentional live-Prime skips, 0 failed.
   **[PART 2/2 RESOLVED 2026-09-04, commit `9e39822`]** No durable worker/session restart
   recovery existed: `execution-kernel.ts`'s `resume()`/`reconnect()` intentionally always throw
   (a genuine Prime SDK constraint -- an in-process session cannot be transparently resumed across
   a real process restart, not something to work around); `reconciliation.ts` only ever inspected
   Goal-level lease/control consistency, never actual worker/session state. Fixed:
   `reconcileOnStartup` gains an optional `kernel` parameter; a kernel constructed fresh at process
   startup always begins with empty sessions/roots/children state, so forcing every nonterminal
   worker under a Goal whose durable lease is not currently live (expired or absent -- no other
   live process could still legitimately hold the real session) through a fresh `observeWorker`
   call can only ever honestly downgrade a genuinely dead session to `"unknown"` via the existing
   empty-observation fallback (item 2) -- never fabricate a status or accidentally resume real
   work. A worker whose Goal lease is still live is deliberately left untouched
   (`lease_contended` already protects it). `GoalReconciliationResult` gains a
   `reconciledWorkerIds` field for durable evidence. Wired a real `ExecutionKernelPort` from
   `@maestro/prime-adapter` into `main.ts`'s `reconcileOnStartup` call. Verified with 3 new
   real-PostgreSQL regressions (genuinely orphaned worker forced to `unknown`; still-live-lease
   worker left untouched; no-kernel-supplied unchanged behavior). Full real-PostgreSQL
   `npm run check` on `main`: 97/98 files, 636 passed, 2 intentional live-Prime skips, 0 failed.

**Phase 1 re-patch: all 8 items now resolved and accepted.** Every item 1-8 is merged to `main`
and pushed to `origin`; Phase 1 may now be re-claimed accepted, subject to independent review of
this session's self-plus-parent-reviewed evidence per this project's own acceptance policy, before
the re-patch execution order moves on to Phase 2's remaining items below.

### Phase 2 — remaining open items
1. **[RESOLVED 2026-09-04, commit `5360b9d`]** Budget reservations silently double-counted
   across envelope revisions. Fixed: `reserveDepartmentBudget` now sums every `'department'`-scope
   reservation for the Goal (`WHERE goal_id = $1 AND scope = 'department'`), and
   `reserveMissionBudget` now sums every `'mission'`-scope reservation for the exact
   `(council, department)` pair -- both across every envelope revision, not only the newest one's
   direct children. This now exactly matches `concertmaster-report.ts`'s own `departmentSpend` query, which
   already (correctly) summed by `goal_id`; enforcement and reporting are now consistent. Verified
   with 3 new real-PostgreSQL regressions reproducing the exact audit scenario at both the
   Department and Mission level. Full real-PostgreSQL `npm run check` on `main`: 97/98 files, 638
   passed, 2 intentional live-Prime skips, 0 failed.
2. **[RESOLVED 2026-09-03/04, commit `6d791d5`/merge `efc40c8`]** Mission Assignment Bundle
   capability scoping (skills/tools) previously never reached the real Prime Agent spawn call.
   Fixed: added a `SpawnCapabilities` type (`{allowedTools?, allowedSkills?}`) and an optional
   `capabilities` field on `SpawnRequest`, meaningful only for a root spawn (a child spawn inherits
   its already-scoped root session). Threaded through
   `createPrimeExecutionKernelFromFactory`'s `spawn()` to the session factory, and
   `createPrimeExecutionKernel()`'s real factory maps `capabilities.allowedTools` directly to the
   Prime Agent SDK's own `createAgentSession({ allowedToolNames })` option. `worker.ts`'s
   `spawnWorker` now passes the mission bundle's exact `allowedTools`/`allowedSkills` grant, never
   widened or narrowed. Verified: 3 new `execution-kernel.test.ts` unit cases (16/16 pass) plus 1
   new real-PostgreSQL `worker.integration.test.ts` case.
   **Deliberately NOT implemented:** the "scout must be read-only" enforcement rule itself (the
   other half of Tests #12/#13) -- this codebase has no canonical tool-name taxonomy anywhere
   (fixtures use arbitrary invented tool-name strings), so defining which tool names count as
   "write-capable" for an automated check requires a product/scope decision, not a technical fix.
   Path/authority-boundary scoping (`allowedPaths`/`authorityBoundary`) also remains unthreaded --
   out of this item's literal scope (spawn-call capability scoping), left open if a future item
   needs it.
3. **[RESOLVED 2026-09-04, commit `bef23a1` / merge `7c22714`]** Team-lead grants now enforce
   duration and task-scope ceilings at `spawnHelperWorker` time. Duration accepts the documented
   numeric unit form and rejects an expired grant; task scope binds spawning to the exact current
   Department Plan version and rejects a later revision. Two real-PostgreSQL regressions cover each
   rejection path. Monetary cost-ceiling enforcement is explicitly deferred until the system defines
   a real per-helper cost source and accounting unit; no invented cost rule is applied. Direct review
   and full real-PostgreSQL verification passed on the merged tree: 97/98 files, 680 passed, 2
   intentional live-Prime skips, 0 failed.

4. **[RESOLVED 2026-09-04, commit `b294a95` (merge of `06fab8d`)]** Mission persona overlay
   (plan/phase2.md "Ten-axis persona baseline") previously had zero implementation. Fixed:
   `packages/domain/src/mission-bundle.ts` adds `deriveMissionPersonaOverlay` (Department style +
   Head choice ten-axis profiles averaged, then nudged per-axis by four [0,1] scalar factors —
   taskAmbiguity, risk, collaborationDemand, evidenceBurden — every axis explicitly clamped to
   [0,1] and re-validated); `packages/persistence/src/mission-bundle.ts` adds a durable
   `mission_persona_overlays` table (migration `0050`, one row per Mission Bundle, append-only,
   axis-bounds trigger) with idempotent issuance (identical-content retry returns the same row,
   differing retry conflicts) and expiry-aware reads. Not wired into the real spawn call (out of
   this item's stated scope, unlike item 2's capability threading). Verified with a real-artifact
   [0,1]-bounds regression and a real "expires correctly once the mission lifetime bound has
   passed" regression (previously untestable, Phase 2 Tests #11's other half). Independently
   reviewed by the parent session directly, then merged to `main` and re-verified: full
   real-PostgreSQL `npm run check` on `main`: 97/98 files, 672 passed, 2 intentional live-Prime
   skips, 0 failed. Worktree/branch/container removed; pushed to `origin`.
5. **[RESOLVED 2026-09-04, commit `9157324` / merge `acfb6c4`]** Head activation/sleep/resume
   (packages/persistence/src/head-participation.ts) now checks the pause/stop/emergency-stop control
   latch through the existing `assertGoalControlOpen` helper before a participation row is created or
   transitioned. Real-PostgreSQL regressions cover blocked activation, sleep, and resume; merged to
   `main`.
6. **[RESOLVED 2026-09-04, commit `c50d142`]** `acceptDepartmentWorkerOutput` now uses
   `INSERT ... ON CONFLICT (worker_id) DO NOTHING RETURNING ...` and re-reads the durable row on
   conflict, so concurrent identical calls return the same acceptance instead of surfacing a raw
   unique-constraint error. A real-PostgreSQL concurrent regression covers the race. The same commit
   also closed the certification.ts portion of Phase 3 item 1; that remaining item tracks the other
   three write modules separately.
7. **[RESOLVED 2026-09-04, commit `cc751ff`]** Git repository and worktree paths are now
   canonicalized and rejected unless they resolve beneath the configured `MAESTRO_WORKTREE_ROOT`.
   The guard runs at the persistence boundary before database transactions or Git calls and again
   in every local Git operation, including paths loaded from durable records. Existing ancestors
   are resolved for not-yet-created worktrees, so symlink escapes are rejected; missing root
   configuration fails closed. Regression coverage verifies outside repository/worktree paths,
   missing configuration, symlink escapes, and no Git/DB invocation after rejection. Fresh
   real-PostgreSQL `npm run check`: 98/99 files passed, 685 passed, 2 intentional live-Prime
   skips, 0 failed.
8. **[RESOLVED 2026-09-04, commits `b397305` and `a378b06`]** Stale/forged fencing-token
   regression coverage now spans the remaining Phase 2 write modules: `budget-reservation.ts`
   (Goal, Department, and Mission reservations), `mission-bundle.ts`, `team-lead-grant.ts`
   (grant, helper spawn, and revoke), and `git-integration.ts` (Goal branch, Department branch,
   and worker worktree). The earlier coverage for `council.ts`, `department-plan.ts`,
   `device-grant.ts`, `environment.ts`, `discord-incident.ts`, and `metronome-challenge.ts` remains
   in place. Each regression proves the forged proof produces no durable mutation and that the
   real proof still succeeds afterward.
9. **[RESOLVED 2026-09-04, current work]** The Git effect adapter now exposes only
   `createLocalGitPort`, which requires an `AuthorizedEffectExecutor`-compatible gateway and routes
   branch, worktree, commit, revision, and cleanup operations through it before spawning Git. The
   control-plane composition root exposes an authority-backed Git-port factory; no unauthenticated
   local Git operation is exported. Real ephemeral-repository tests reject expired, forged-actor,
   and out-of-scope grants before a Git process can run. The broader Task Contract/Council/Plan/
   worker write-command API remains Phase 5 Track A item 3.

### Phase 3 — remaining open items
1. **[RESOLVED 2026-09-04, current work]** Evidence-bundle assembly/recording, Concertmaster
   report generation, and Encore Council review now require a `GoalLeaseProof`. They hold the lease
   and control rows with `FOR UPDATE` while checking the pause/stop/emergency latches, before any
   evidence/report write or Encore reviewer spawn. Real-PostgreSQL regressions cover forged fencing
   proofs and paused Goals in all three modules; the full report/evidence path permits the intentional
   `certifying` state while still failing closed on control latches.

2. **[RESOLVED 2026-09-04, current work]** Evidence-bundle and Concertmaster-report assembly now
   run through one transaction on the locked client. The report records its evidence bundle and final
   report in that same transaction, eliminating the prior non-transactional read/write gap. Encore
   review likewise keeps its durable round writes on the same locked transaction that gates reviewer
   provider work.

3. **[RESOLVED 2026-09-04, current work]** `concertmaster_final_reports` now has an additive
   unique Goal index (`0037_concertmaster_report_goal_uniqueness.sql`). Generation checks for an
   existing immutable report while holding the Goal authority transaction and returns it on retry,
   so concurrent/repeated calls cannot create a second final report or evidence snapshot.
4. **[RESOLVED 2026-09-04, current work]** Evidence bundles now include durable authority records and
   decisions, sealed independent Council briefs, and Goal Head participation/activation history.
   The final report and its immutable evidence bundle commit together, with the report linking to the
   bundle explicitly; the report is intentionally not nested in the bundle to avoid a circular hash.

5. **[RESOLVED 2026-09-04, current work]** Added immutable, idempotent `goal_actual_costs`
   accumulation (`0038_goal_actual_costs.sql`) distinct from reservations and forecasts. Authorized
   `recordActualCost` writes hold the Goal lease/control locks and reject command replay with changed
   content. Report generation sums actual costs, reads the latest Goal envelope, emits a durable
   `budget_exceeded` blocker before success, and reports actual spend rather than reservation totals.
   Evidence bundles include the underlying actual-cost entries. Domain and real-PostgreSQL regressions
   cover over-budget reporting and idempotent cost recording.
6. **[RESOLVED 2026-09-04, current work]** All four derived Goal read routes now require the
   strict `projectId` query binding. The control-plane membership hook checks it before the route
   handler, the `ReadStateService` validates the `(goalId, projectId)` pair again at the durable
   read boundary, and API-client/CLI contracts pass the project explicitly. Real parity regression
   covers all four cross-project requests and proves each is rejected before state is returned.
7. Already-known Phase 3-rooted P0s from the first audit wave: no production write-command API
   surface for Metronome/Council/certification/report actions; Metronome is a one-shot callable, not
   a continuous scheduled/event-driven loop, and its rule set omits several plan-required finding
   types; App/CLI/UI parity is read-contract-only, no forms/write surface, no dedicated Secretary
   panels for these four record kinds.

### Phase 4 — remaining open items
Unchanged from Track B above (enrolled-device audit, 2026-09-04): no real device-agent transport
or mutual authentication; local validation doesn't cover Goal/grant/expiry/fencing; no authenticated
command dispatch or signed device receipts; device revocation doesn't cascade to issued grants;
applications/data-scope/network-scope are declarative only, unenforced; no disconnect/dependent-work
pause lifecycle; Metronome has no device-access observation; grant expiry/closure has no durable
automatic state transition. See Track B items 1-8 above for full detail — not re-numbered here to
avoid duplicate item IDs.

### Feature-completeness (real-world usability) sweep — completed directly 2026-09-04
The dispatched subagent aborted mid-run with no findings (see above); the parent session completed
this sweep directly by reading `apps/cli/src/main.ts`, `apps/secretary/src/goal-page.tsx`,
`apps/control-plane/src/server.ts`, `apps/discord/src/main.ts`, and plan/phase2.md's Concertmaster/Task
Contract flow. This is additional to (not a duplicate of) the known "no write-command API surface"
P0 items already listed per-phase above; it grounds two of those gaps in their single sharpest
concrete illustration each, plus two smaller cross-cutting gaps not previously called out.

1. **[PARTIALLY RESOLVED 2026-09-04]** Task Contract intake is now available through authenticated
   HTTP and CLI surfaces. The API supports create/read/amend, deterministic Overture role selection,
   exact confirmation, and launch; project membership is checked before handlers and the durable
   service rechecks the contract project binding. The CLI exposes the same lifecycle using
   `task-contract create|get|amend|select-roles|confirm|launch`. The remaining gap is linking a
   launched contract to Goal creation and exposing the dependent Head/Council/Plan/worker commands.
2. **[Phase 4, illustrates known Discord notification gap]** `apps/discord/src/main.ts:89`'s
   `main()` wires Discord's own delivery transport to a stub that immediately throws `"No delivery
   transport configured"` — there is no default delivery implementation at all, and no Discord/
   desktop emergency-notification channel exists anywhere in the codebase despite plan/phase4.md
   #46 explicitly promising "one pre-approved out-of-band emergency channel ... a dedicated Discord
   emergency channel or enrolled-device desktop notification" for exactly the case (main control
   plane unavailable) Discord exists to handle.
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
   zero forms, zero navigation between Goals, zero Council/certification/Concertmaster-report panels. The
   CLI (`apps/cli/src/main.ts`) totals 2 write commands (`goal create`, `goal transition`) and 5
   read commands (`goal get`, 3x `*.list`, `concertmaster-report get`, `events list`) — no command exists for
   Task Contract, Council brief submission, Department Plan, Mission Bundle, worker spawn, Git
   actions, critical-action approval, device enrollment/grants, environment creation, or any
   Discord incident action.

### Status
- [complete_pending_independent_review] Phase 1 remaining items 1-8 above: all 8 items resolved and accepted (see each item's own status line above for commit hashes). Self-plus-parent-reviewed only this session; a formal independent (no-edit) review of the full Phase 1 re-patch diff is the recommended next step before treating Phase 1 as re-accepted, per this project's own acceptance policy.
- [in_progress] Phase 2 remaining items 1-9 above: items 1 (budget double-counting), 2 (Mission
  Bundle capability scoping to real spawn call), 3 (team-lead duration/task-scope ceilings), 4
  (Mission persona overlay derivation/expiry), 5 (Head activation/sleep/resume control-latch), 6
  (acceptance race), and 8 (fencing-token regression coverage) resolved and merged to `main`.
  Item 3's monetary cost-ceiling sub-scope is explicitly deferred pending a real cost source/
  accounting unit. Items 7 and 9 are resolved in commits `cc751ff` and the current Git authority
   adapter slice; the remaining Council/Plan/worker write API is Phase 5 Track A item 3, while
   Task Contract intake itself is now exposed through the authenticated API and CLI.
- [in_progress] Phase 3 remaining items 1-7 above: items 1-4 (Goal lease/control guards and
  consistent aggregation transactions, report idempotency, complete evidence replay sources,
  actual-cost budget enforcement, and project-scoped derived reads) are resolved in the current
  guarded-aggregation slice. Item 7 (write API/continuous loop/UI follow-through) remains open.
- [not_started] Phase 4 remaining items (= Track B items 1-8, unchanged; feature-completeness item 2
  above is a Discord-specific instance to fix alongside Track B).
- [resolved 2026-09-04] Feature-completeness items 3-4 above (project-scoped Goal listing and
  budget-at-a-glance) are now available through control-plane, typed API client, and CLI reads.

## Phase 5 remediation plan — operational usability (added 2026-09-04, supersedes prior "complete/complete_pending_independent_review" claims for P1-P4 runtime lanes)

### Why this phase exists
Two independent read-only audits (P1-P3 usability audit, P4 enrolled-device audit) found that green `npm run check` evidence across Phases 1-4 proves durable domain/persistence component behavior, not a runnable system a normal user/operator/device could actually use end-to-end. Phase 1-4 "complete" markers above describe code-level and test-level status only. This phase closes the specific evidenced runtime gaps before any of that work is treated as operationally accepted or merged as a usable product.

### Track A — P1-P3 control-plane runtime lanes (blocking, P0 unless noted)
1. **Durable worker/session recovery.** `packages/prime-adapter/src/execution-kernel.ts` session/invocation state is process-local only; `resume()`/`reconnect()` always throw. `packages/persistence/src/reconciliation.ts` explicitly does no session reconciliation. Required: durable session/invocation binding table, a real `reconcileOnStartup` that loads worker/session bindings, fences or cancels stale provider work, and persists the recovery decision with evidence. Test: kill-and-restart a real running control-plane process with an active worker; prove no duplicate/stale execution.
2. **[PARTIALLY RESOLVED 2026-09-04] Authority enforcement at real effect adapters.** The
   control-plane now owns one durable `AuthorizedEffectExecutor` and exposes it to runtime/browser
   adapters; those adapters already require the gateway before process/browser effects. The Git
   adapter exposes only `createLocalGitPort`, and every branch/worktree/commit/revision/cleanup
   operation calls that gateway before spawning `git`. Forged/expired/out-of-scope real Git tests
   pass with zero process spawn. Remaining work is to compose and exercise runtime/browser effects
   in the full production orchestration path, tracked with Track A item 3.
3. **[PARTIALLY RESOLVED 2026-09-04] Production orchestration path.** The control plane now
   exposes the first real intake slice: Task Contract create/read/amend/role-selection/confirmation/
   launch, with typed API-client and CLI parity, durable project authorization, replay-safe create and
   role-selection commands, exact confirmation, and immutable project boundaries. The remaining
   dependent write commands (Goal linkage, Head activation, Council, Department Plan, Mission Bundle,
   worker, Git integration, Metronome/certification/report) still need authenticated routes before
   the full HTTP-only lifecycle can be claimed.
4. **Project-scoped operator authorization.** `server.ts` authenticates but never checks project membership/role/capability; `goal-service.ts` forwards any authenticated operator to any supplied project/Goal ID. Required: add project/role/capability authorization checks on every route, not just authentication. Test: an authenticated operator without project membership is rejected reading/writing another project's Goal.
5. **User-facing CEO approval/critical-action completion.** No endpoint/CLI/UI records a required approval and reruns the concrete effect; `CreateGoalInputSchema` has no outcome/Task-Contract/confirmation fields. Required: add the minimal approve-and-rerun command path end-to-end (API + CLI at least). Test: a critical action that requires approval is approved through a real user-facing command and then actually executes the effect exactly once.
6. **Continuous Metronome observation (P1, not blocking exit but required before "usable").** `scanGoalForMetronomeFindings` is a one-shot callable with no scheduler/consumer composed in `main.ts`, and its rule set omits unsupported-claims/circular-discussion/activation-cycle/scope-budget-authority-divergence/unreviewed-integration findings from the plan. Required: compose a real scheduled/event-driven Metronome loop and complete its rule set. Test: a seeded violation is caught by the running loop without being manually invoked.
7. **App/CLI/UI operational parity (P1).** Secretary is read-only single-Goal view with no forms/SSE and no challenge/Council/certification/report display; CLI covers only Goal/event read+create+transition. Required: extend both to the write/read surface from item 3, matching this project's own "same state through app and CLI" requirement, not just a shared read contract.

### Track B — P4 enrolled-device runtime lanes (blocking, P0 unless noted)
1. **Real device-agent transport and mutual authentication.** No TLS/mTLS listener, certificate/key proof, or authenticated device session exists; `device.ts` explicitly defers this. Required: implement a real device-agent process with TLS/mTLS (or an equivalent standard authenticated-TLS design) and proof-of-possession. Test: a separately running device-agent process (not in-process construction) completes an authenticated round trip.
2. **Local validation must cover Goal, grant, expiry, and fencing token, not just device/policy/action/target.** `LocalDeviceActionRequest` and `evaluateLocalDevicePolicy` do not carry or check Goal ID, grant reference, grant expiry, or fencing sequence. Required: deliver a signed grant envelope to the agent; the agent verifies device binding, Goal, scope, expiry/revocation freshness, and monotonic fencing locally before OS execution. Test: negative case per field (stale Goal, expired grant, reused/lower fencing sequence) rejected locally, not just server-side.
3. **Authenticated command dispatch and signed device receipts.** Only a results table exists; no command/outbox/session table, no device signature on submitted results, no argv/command-payload record. Required: persist immutable command envelopes before dispatch and require signed device receipts (device identity, grant/Goal, sequence, action parameters, outcome) verified on receipt. Test: forged and replayed command/result rejected.
4. **Device revocation must cascade to already-issued grants.** `revokeDevice` does not touch `device_grants`; `recordDeviceCommandResult` never checks `devices.state`. Required: atomically revoke/expire active grants on device revoke and/or check enrolled device state on every dispatch/receipt. Test: grant issued -> device revoked -> next in-scope command result rejected.
5. **Enforce applications/data-scope/network-scope, not just action/path.** Declared in schema and domain type but never checked at execution/receipt time. Required: model typed command targets (application/browser target, data resource, network destination) and validate each against scope both locally and server-side. Test: escape attempts on each of the three unenforced scope dimensions are rejected.
6. **Disconnect/dependent-work pause lifecycle.** No device session/heartbeat/disconnect state exists. Required: track authenticated device session/heartbeat and work-to-device dependency; pause only dependent work on disconnect. Test: independent work continues; dependent work pauses.
7. **Metronome device-access observation (P1).** Metronome never reads device/grant/result state. Required: add deterministic device-grant/audit finding rules (expired grant use, unexpected target, unexpected side effect) with safe-pause coverage.
8. **Durable automatic grant expiry/closure (P1).** Expiry/terminal-Goal currently only rejects at submit time; `device_grants.state` never transitions to `expired`/`closed`. Required: transition state atomically on the lifecycle event (Goal closure, revocation, expiry) and test the durable state change plus immediate local rejection.

### Sequencing decision
- Do Track B item 1-2 first (device-agent transport + full local validation) because it is the immediate, currently mis-claimed P4S10 gap; do not widen the existing S10 test's claim without this work.
- Track A items 1-3 are prerequisite-independent of Track B and may run in a parallel isolated worktree.
- Do not attempt Track A item 6/7 (Metronome loop, app/CLI parity) or Track B items 6-8 until each track's P0 items above land and are independently reviewed, since they build on the corrected authorization/session primitives.
- No phase in this remediation plan may be marked `complete` on self-review alone; each requires independent (no-edit) review plus real-PostgreSQL (and, where applicable, real-process/real-device-agent) verification per this project's existing acceptance policy.

### Status
- [in_progress] Track A (P1-P3 control-plane runtime lanes): item 2 Git authority is resolved;
  item 3 has its Task Contract intake slice implemented; dependent lifecycle commands and runtime
  orchestration remain open.
- [not_started] Track B (P4 enrolled-device runtime lanes), items 1-8.
## 2026-09-04 — Phase 4 P4S1 environment foundation
- [self_verified_pending_postgres] Implemented typed environment recipe/manifest and durable PostgreSQL environment lifecycle records in migration 0039. Identity is content-addressed from canonical recipe and resolved inputs; durable writes require current Goal lease plus actor/session context.
- Focused/domain tests and build pass. Full check: 267 passed, 194 skipped, 0 failed; integration tests require the assigned disposable PostgreSQL instance and were not run in this runtime.
## Phase 4 step 6 — Discord foundation
- Implemented Discord authenticated signal schema, freshness and replay rejection, independent append-only buffer, and PostgreSQL receiving primitive.
- Self-verification currently: build passed; focused Discord tests **2 passed, 0 failed**. Real-Postgres integration remains pending.
- [in_progress] 9. Phase 4 Track B (plan/phase4.md work-sequence steps 6-9): P4S6 Discord signal foundation is self-verified with real-PostgreSQL focused evidence pending independent review; steps 7-9 are next. Track A remains isolated in `.worktrees/p4-env`.
- [in_progress] 9. Phase 4 Track B (plan/phase4.md work-sequence steps 6-9): P4S6 hardening and P4S7 fingerprint/dedup/severity-confidence/silence slices are self-verified with real-PostgreSQL evidence, pending independent review; step 8 Incident Brief/triage/remediation composition is next. Track A remains isolated in `.worktrees/p4-env`.


## 2026-09-03 — Phase 4 integration merge landed
- [in_progress] 9. `phase4/integration` now carries environments (P4S1+P4S2), devices (P4S4), Discord (P4S6+P4S7), and the shared migration-runner fix, merged and fresh-verified together: 532 passed, 2 intentional live-Prime skips, 0 failed, stable over 2 consecutive real-PostgreSQL runs. Migration numbering collision between environments/devices (0039-0041) and Discord (previously 0039-0042) resolved by renumbering Discord to 0042-0045.
- Next: P4S3 (browser environment adapter, Playwright), P4S5 (Goal-scoped device grants/command channel), P4S8-P4S9 (Discord Incident Brief through closure and improvement evidence), P4S10 (live gates).


## 2026-09-03 (continued) — P4S3 and P4S5 integrated
- [in_progress] 9. `phase4/integration` now also carries P4S3 (Playwright browser environment adapter) and P4S5 (Goal-scoped device grants + sequenced capability-authenticated command channel). Full real-PostgreSQL check: 568 passed, 2 intentional live-Prime skips, 0 failed.
- Next: P4S8-P4S9 (Discord Incident Brief through closure and improvement evidence), P4S10 (live gates).


## 2026-09-03 (continued) — P4S8 integrated
- [in_progress] 9. `phase4/integration` now also carries P4S8 (Discord Incident Brief -> Goal linkage -> immediate safe pause -> remediation through the existing Phase 2/3 pipeline -> closure). Full real-PostgreSQL check: 577 passed, 2 intentional live-Prime skips, 0 failed, stable over 2 runs.
- Next: P4S9 (incident outcome/false-positive improvement evidence, no automatic changes), P4S10 (device-scope and seeded-incident live gates -- the Phase 4 exit gate).


## 2026-09-03 (continued) — P4S9 integrated
- [in_progress] 9. `phase4/integration` now also carries P4S9 (durable Discord improvement evidence recorded on incident closure, no automatic changes). Full real-PostgreSQL check: 580 passed, 2 intentional live-Prime skips, 0 failed.
- Next: P4S10, the device-scope and seeded-incident live gates -- the Phase 4 exit gate itself.


## 2026-09-03 (continued) — P4S10 integrated; Phase 4 work-sequence complete at code level
- [complete_pending_independent_review] 9. Phase 4 (plan/phase4.md) work-sequence steps 1-10 are implemented and integrated on `phase4/integration`, with real-PostgreSQL verification stable over repeated runs (582 passed, 2 intentional live-Prime skips, 0 failed). The exit gate (device/local-policy narrow-grant task plus Discord outage/recovery/dedupe/isolated-remediation) is evidenced by two composition tests. Self-reviewed only; independent (no-edit) review of the full Phase 4 surface is the recommended next step, and merge to `main` remains behind that review per this project's existing acceptance policy.
- Branches merged into `phase4/integration`: `fix/shared-migration-runner`, `phase4/p4s1-environments` (S1+S2), `phase4/p4s4-devices` (S4), `phase4/p4s6-discord` (S6+S7), `phase4/p4s5-device-grants` (S3+S5), `phase4/p4s8-incident-workflow` (S8), `phase4/p4s9-improvement-evidence` (S9), `phase4/p4s10-live-gate` (S10).


### Explicit provider crash-window boundary (Track A1)

The provider-neutral `ExecutionKernelPort` cannot atomically commit an external `spawn()` response with PostgreSQL. If a control-plane process is SIGKILLed after the provider returns opaque refs but before `bindWorkerInvocation` commits, the durable reservation remains `pending:*` and the provider identity is unavailable to the successor. Track A1 acceptance for this window is therefore: successor startup marks the reservation `unknown`/`fenced`, preserves the pending placeholders without fabricating refs, records one recovery decision, and blocks retry. It does **not** claim provider ref recovery or suppression of side effects already admitted by an unavailable provider. A later adapter-specific idempotency/reconnect/cancel contract is required before making that stronger claim.


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


## 2026-09-05 — Phase 6 Step 1 UUID/hash parity remediation plan

The second final review found one remaining blocker: UUID validation accepts uppercase UUIDs, PostgreSQL normalizes UUID columns to lowercase, and the app currently hashes the pre-normalized payload. This can reject valid uppercase inputs at the database hash trigger. Before the next patch, normalize project, Goal, and source UUIDs to lowercase in a domain helper; hash the normalized payload; and use that same normalized payload for persistence writes and source checks. Add regression coverage proving uppercase/lowercase inputs have identical canonical content and that an uppercase retry remains idempotent. Keep episode IDs as bounded opaque text.


## 2026-09-05 — Phase 6 Step 1 UUID/hash remediation result

- Added domain normalization of project, Goal, and source UUIDs to lowercase before canonical hashing. Persistence now writes and source-checks the same normalized payload, so PostgreSQL UUID normalization cannot change the trigger hash. Episode IDs remain bounded opaque text.
- Added regression coverage for uppercase/lowercase hash equality and an uppercase persistence retry; the intentional red run preceded the build refresh, then build plus focused domain/persistence verification passed `5/5` and `3/3` respectively.
- The prior final review's only blocker is addressed. A fresh no-edit review and a clean broad run are required before commit/push; the broad run that was started before this patch was stopped and is not acceptance evidence.


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
## 2026-09-06 — Session resumption: repo-vs-doc reconciliation

Per this project's own resume protocol ("trust the repo, correct the docs"), this session found the
Phase 5 Status block above (`Track A ... item 3 has its Task Contract intake slice implemented`;
`Track B (P4 enrolled-device runtime lanes), items 1-8` marked `[not_started]`) to be stale. The
actual repo state, verified directly against `git log`/file contents on `hardening/lifecycle`
(`ce94c3d`):

1. **Track A1 (runtime recovery) and Track B1-B2 (device authority) are both done and verified**,
   not merely in-progress. See progress.md's 2026-09-05 "Track A1 final verification" (790 tests,
   real-process kill/restart) and "Phase 5 Track B1-B2 device authority implementation and
   verification" (793 tests, real mTLS/Ed25519 process acceptance) entries. `progress.md`'s
   "Current slice: Phase 5 Track A1" line (under "Active execution plan — Phase 5 through Phase 6")
   is superseded by those later entries in the same file; not rewritten here per this project's
   doc-log union convention, but do not treat it as the current pointer.
2. **The Task Contract/write-command API surface is far larger than the Status block states.**
   Direct inspection of `apps/control-plane/src/server.ts` and `packages/api-client/src/index.ts`
   shows durable authenticated routes/typed client methods already exist for: Task Contract
   create/read/update/Overture-selection/confirm/launch; Goal create/pause/resume/stop/
   emergency-stop/transition; **critical-action request and approve-and-run** (Phase 5 Track A
   item 5's "approval path" — already implemented, not open as the old Track A item 5 wording
   implies); Head activation; Council create/get/submit-brief/reveal/decide; Department Plan
   create/get/revise; Mission Bundle create/get; worker spawn/get/observe/cancel; Git integration
   branch/revision/worktree; worker acceptance/certification (including conditional); Metronome
   scan/challenge/correction/safe-pause/resolve; Encore review; budget summary; Goal/event/
   Metronome-challenge/Encore-round/certification/Concertmaster-report listing, all project-scoped.
   Track A item 3's remaining-work wording ("dependent write commands ... still need authenticated
   routes") is now largely obsolete; the real remaining gap is UI/CLI wiring to this surface, not
   the routes themselves. Do not re-implement any of the above; audit for gaps and wire to it.
3. **Secretary migrated from the Next.js single-Goal read-only page (as Track A7 above still
   describes) to an Electron desktop app** (`apps/secretary`, main.js entry, IPC bridge in
   `apps/secretary/electron/`) with thirteen views (`home`, `dashboard`, `channel`, `git`, `floor`,
   `inbox`, `evlog`, `billing`, `settings`, `luthiery`, `arrangements`, `flashmob`,
   `flashmobSession`). This is a substantially larger UI surface than Track A7 describes, but:
   - **Real, tested plumbing exists** and is wired correctly: `connection.tsx` (config get/save/
     clear through `window.maestro.config`), `goals.tsx` (`GoalsProvider`, lists/selects a Goal via
     `window.maestro.api.listGoals`), `useGoalDetail.ts` (loads Goal/events/budget/certifications
     for the selected Goal), `lib/goal-data.ts` (pure read-model assembly, unit-tested), and
     `electron/apiBridge.ts` (an explicit allowlist of exposed `ApiClient` methods: `listGoals`,
     `getGoal`, `getBudgetSummary`, `listEvents`, the full Task Contract lifecycle, `pauseGoal`/
     `resumeGoal`/`stopGoal`/`emergencyStopGoal`, `listCertifications`, `listMetronomeChallenges`,
     `listEncoreCouncilRounds`, `getConcertmasterReport`).
   - **Every one of the 13 views is 100% static mock data with zero connection to the real
     plumbing.** Direct `grep` for `useGoalDetail`/`useGoals()`/`window.maestro` usage across
     `apps/secretary/src/views/*.tsx` and the top-level `.tsx` files returns only `connection.tsx`,
     `goals.tsx`, and `theme.tsx` — the providers themselves, never a consumer view. `Dashboard.tsx`,
     `Billing.tsx`, `Channel.tsx`, `Git.tsx`, `EvidenceLog.tsx` (and by the same pattern, the
     remaining unaudited views) render hardcoded arrays (e.g. `Billing.tsx`'s `spendByDay`/
     `usageByGroup`/`recentGoals` constants, `Dashboard.tsx`'s `departments` constant with a
     hardcoded "4 missions in flight / 3 pending approvals" stat block). `useGoalDetail.ts` and its
     dependencies are real, unit-tested, and currently orphaned/unused code.
   - `App.tsx` has a self-documented, intentional shortcut (a `ponytail:` comment) bypassing the
     real `Setup`/connection gate so the mock Shell always renders regardless of whether a real
     control-plane connection exists; the comment states this should be removed once write flows
     are ready.
   - The `apiBridge.ts` allowlist does not yet expose critical-action request/approve-and-run,
     Metronome correction/safe-pause/resolve, or any Council/Plan/Mission/worker/Git write method,
     even though the control-plane routes and typed client methods for all of them already exist
     per point 2 above.
   - **Corrected Track A7 status: this is a visual-design prototype shell with real but disconnected
     data plumbing, not "a read-only single-Goal view" (too pessimistic on view count) and not an
     operational console (too optimistic on wiring).** The concrete next step is wiring existing
     views (starting with whichever view maps to "Goal state" duties, most plausibly `Dashboard`)
     to `useGoalDetail`/`useGoals`, replacing their hardcoded arrays, before adding any new
     capability or expanding `apiBridge.ts`'s allowlist further.
4. A stale git-worktree-base defect was found and corrected as pure workflow hygiene, no code
   impact: `.worktrees/phase5-secretary-console` was still parented at `d0ff587`, which predates
   both the Track A1 runtime-ownership Worker-type changes and the Electron migration on
   `hardening/lifecycle`. Attempting new Secretary (then-Next.js-shaped) work there produced
   irrelevant local `tsc -b` errors unrelated to any change in this session, and would have
   produced a diff against an architecture (Next.js pages/route handlers) the project no longer
   uses. No code was committed from that attempt; the worktree was reset to `hardening/lifecycle`
   HEAD (`git reset --hard hardening/lifecycle` + `git clean -fd` for stray build output) before
   any further work. Recreate/rebase a Phase 5 worktree from the current `hardening/lifecycle` tip
   before starting Secretary UI wiring work, not from an older Phase 5 slice branch.
5. **Local-environment defect found and fixed (no source change):** the main worktree's
   `node_modules/@maestro/` was missing the `device-agent`/`device-agent-app` workspace symlinks
   (present for every other package), causing `npm run build` to fail with `Cannot find module
   '@maestro/device-agent'` purely because of stale local `node_modules` state, not a repo defect.
   `npm install` in the main worktree recreated the missing symlinks with zero `package-lock.json`
   change; `npm run build` is now clean on `hardening/lifecycle` HEAD.
6. **Pre-existing test-infra gap found (not fixed, not caused by this session):** running
   `npm test` without `MAESTRO_TEST_DATABASE_URL` set correctly skips the vast majority of
   real-PostgreSQL integration suites, but three specific files throw `TypeError: Invalid URL`
   instead of skipping cleanly: `apps/control-plane/src/worker.kill-restart.integration.test.ts`,
   `apps/device-agent/src/main.integration.test.ts`, and
   `packages/persistence/src/device-agent-runtime.integration.test.ts`. Each constructs a scoped
   database URL via `new URL(databaseUrl!)` at module scope before any `describe.skipIf`/env
   guard runs. Fresh `npm test` (no DB, no Docker in this runtime): **441 passed, 342 skipped, 3
   failed** (only these three files) — everything else that requires PostgreSQL skips as intended.
   Fix is straightforward (guard the URL construction the same way the other DB-gated suites do)
   but is left open as a small follow-up, not bundled into this session's unrelated findings.
7. **Subagent quota exhaustion:** `openai-codex/gpt-5.6-luna` returned `usage_limit_reached` on
   every turn for a dispatched Secretary-console child this session (zero real work produced,
   deleted per dead-child protocol); Codex reported `resets_in_seconds` around 74000 at
   2026-09-06T12:46 UTC (~20h). No subagent work is available on the required model until that
   resets; this session's Secretary/Operator-lane work must proceed directly (no subagent) until
   then, per this project's model-restriction policy.


## Deferred architecture decision — device dependent-work pause granularity (Phase 5 Track B6)

**Decision:** Do not add a worker-to-device dependency link or a new worker pause state in this
remediation pass.

**Why this is a real design decision, not a wiring gap:** `device_grants` are Goal-scoped, not
worker-scoped -- no column anywhere records which specific worker (if any) is the intended
consumer of a device grant or a device command claim. Device session connect/heartbeat/disconnect
tracking is already complete (`device_agent_sessions`), and `claimDeviceAgentCommand` already
refuses any new command once a session disconnects, so a disconnected device's commands already
stop being accepted -- the enforcement half of B6 is already correct. What is missing is the
concept itself: which unit of work counts as "dependent" on a device, and what pause primitive it
uses (`WorkerStatus` today is `spawned/running/succeeded/failed/cancelled/unknown` -- no
"blocked_dependency" or equivalent non-terminal-but-paused state exists, and adding one would
ripple through `assertValidWorkerTransition`, every contract/route/CLI surface, and every existing
worker test in the codebase).

**Non-negotiable entry contract before implementing this for real:**
- an explicit worker-to-device-grant (or worker-to-device) durable link recorded at issuance, not
  inferred after the fact;
- an explicit new worker pause state distinct from cancellation, with its own valid-transition
  rules and resume path back to `running` on reconnect;
- proof that independent (non-device-dependent) work in the same Goal is provably unaffected --
  the current Goal-only pause granularity is not enough, since it would pause independent workers
  too.

**Reason for deferral:** This is a genuinely new domain concept, not an extension of an existing
one, and forcing it in without an explicit product decision about what "dependent work" means for
this system risks exactly the over-engineering/under-specification failure mode this project's own
`docs/OPERATING_PROTOCOL.md` Karpathy-guidelines default is meant to prevent ("simplicity first,"
"surgical changes"). Every other Phase 5 Track B item (1-5, 7, 8) is closed; this is the sole
remaining open item, explicitly scoped and blocked on a design decision, not silently skipped.

**Revisit trigger:** When there is an actual dependent-work scenario to design against (e.g. a
real worker whose Mission Bundle explicitly requires device access mid-task), scope the minimal
worker-device link and pause state against that concrete case rather than a hypothetical one.

## 2026-09-06 — Documentation reconciliation after Phase 5 capacity slice

- Actual repository state is `main` at `95bef8e`, synchronized with `origin/main`, with a clean working tree.
- Phase 5 Track A1 and Track B1-B2 are complete in code and verification history; older status wording that calls them in-progress/not-started is historical and must not be used as the current pointer.
- The authenticated control-plane/API-client write surface is broader than the older Phase 5 status wording: Task Contract, Goal lifecycle, approvals, Head/Council/Plan/Mission/worker/Git, Metronome, certification, reporting, and project-scoped reads are present. The remaining operational gap is primarily Secretary renderer wiring and missing CLI/renderer exposure for parts of the write surface.
- Current Phase 5 slice: project-wide active-worker admission control via `MAESTRO_MAX_CONCURRENT_WORKERS_PER_PROJECT`; this is a deliberate first slice, not completion of the full resource-capacity model or queue behavior.
- Local verification on this environment: `npm run build` passed; `npm test` passed with 61 files/469 tests passed and 51 files/360 tests skipped because no PostgreSQL URL is available. Full PostgreSQL verification remains blocked by the environment.
- Next actionable work: extend the capacity model with resource inventory, demand reservations, protected floors, and admission behavior, while preserving the explicit flat-worker-cap boundary until each additional resource has a defined contract.


## 2026-09-07 — Prime Agent/model replacement audit remediation plan

- [not_started] **Model-policy enforcement:** the Mission Bundle `approvedModels` list is validated and hashed, but is not currently carried into `SpawnRequest` or consumed by the Prime adapter. Before any provider swap, extend the provider-neutral request with a typed model policy, reject a provider/model outside that policy before external admission, and persist/report the selected `ModelIdentity`.
- [not_started] **Explicit runtime selection:** retain `ExecutionKernelPort` as the provider-neutral seam, add an explicit runtime/provider registry and capability matrix, and never silently fall back from a requested OpenAI/Claude adapter to Prime Agent.
- [not_started] **Staged direct-provider support:** direct ChatGPT/OpenAI and Claude adapters may initially be proposal-only controller backends. Worker execution remains unavailable until tool, child, cancellation, observation, usage, and recovery semantics meet the existing lifecycle contract.
- **Acceptance fence:** this is a design/audit record only. No implementation or credential movement is authorized until the design is approved. Required evidence includes approved-model allow/deny tests, truthful unavailable fallback, model-identity evidence, credential-boundary tests, and existing PostgreSQL/real-process gates.


## 2026-09-07 — Native backend adversarial design review gates

- [not_started] Define authenticated conversation `create/turn/stream/cancel/reconnect` contracts with session/turn IDs, idempotency, durable cursors, per-session serialization, and route-bound project/Goal context before implementing runtime code.
- [not_started] Define executable normalized model/tool/event contracts: tool-call IDs, strict argument/result schemas, tool-result message role, bounded turn/call/byte/token/time budgets, duplicate/replay handling, provider capability negotiation, and abort semantics.
- [not_started] Define host-side `ToolContext`/delegated capability contract. Models must never receive bearer tokens or approve-and-run authority; critical approval must remain human-bound to exact args hash, command, project/Goal, expiry, and independent confirmation.
- [not_started] Define durable parent/child binding, grant intersection, model policy, depth/worker ceilings, budget aggregation, cancellation cascade, and recorded child-message channels.
- [not_started] Carry canonical provider/model policy through every kernel consumer (Worker, Head, semantic review, Encore, helpers), add durable actual model identity, and reject adapter identity mismatch before/after admission.
- [not_started] Define streaming/event sink and durable invocation/turn/tool/provider usage evidence; do not use a result-only provider method for a streaming product surface.
- [not_started] Define per-session turn locking, immutable runtime/model binding, provider request-ID namespacing, non-idempotent tool retry rules, and A1 unknown/fenced recovery semantics.
- [not_started] Prime removal must include all project references, transitive lockfile packages, config fixtures, live tests, and security documentation, followed by a no-Prime dependency scan.


## 2026-09-07 — Native conversation/CLI slice completed

- [completed] Add authenticated model catalog and conversation contracts/routes/client methods.
- [completed] Add PostgreSQL conversation, turn, and event-cursor migration.
- [completed] Compose Control Plane with the separate model gateway when `MAESTRO_MODEL_GATEWAY_TOKEN` is configured.
- [completed] Connect CLI commands and TUI free-text turns using `MAESTRO_MODEL` and non-secret session metadata.
- [completed] Verify full build/test suite and gateway process health smoke.
- [completed] Add the first API-key credential lifecycle slice for OpenAI/Anthropic: strict contracts, hidden TUI/TTY input, authenticated Control Plane routes, gateway bind/revoke RPC, operator checks, replacement invalidation, and gateway-owned keychain persistence.
- [remaining] Add provider token streaming, durable restart reattachment/recovery, tool registry persistence, Codex app-server pairing, PostgreSQL integration acceptance, dynamic signed gateway operator context, and remove legacy Prime composition after parity.


## 2026-09-07 — Public account login slice

- [completed] Implement OpenAI ChatGPT Plus/Pro browser login via public Codex app-server managed-login JSON-RPC.
- [completed] Add selector, browser opener, Control Plane/gateway/API client routes, metadata-only managed binding, logout, and exact model catalog filtering.
- [completed_with_boundary] Keep Maestro tool authority separate; Codex account turns are text-only/read-only until the tool bridge is independently specified and tested.
- [blocked] Claude Pro/Max account OAuth awaits an official public or written-approved Anthropic protocol. Private Prime OAuth and CLI credential bypasses remain prohibited.
- [remaining] Durable login idempotency/restart ownership, PostgreSQL acceptance, real Codex app-server acceptance, and full streaming/tool parity.

## 2026-09-07 — Durable account-login gate
- [completed] Persist operator/request reservations and durable Maestro login IDs.
- [completed] Fence interrupted starts at Control Plane startup and map gateway loss to terminal `unknown`.
- [completed] Protect login identity/delete semantics in PostgreSQL and serialize status/cancel with fenced operation tokens.
- [remaining] Run acceptance against an installed Codex app-server; keep Claude subscription login blocked pending official Anthropic approval.


## 2026-09-07 — Current execution pointer after durable account-login review

- [completed] Integrated `679c8eb` into `main` as `e6cbc97`; removed `.worktrees/account-login-durable` and `patch/account-login-durable`.
- [completed] Fixed blocking account-login review findings: exact operation-token fencing, guarded provider identity completion via migration `0066`, durable login ID test consistency, and typed Codex unknown-session mapping.
- [completed] Reconciled current README/docs/plans. All execution paths now use `MaestroAgentRuntime` through the authenticated Model Gateway; pi-tui remains presentation-only.
- [completed_with_evidence] Native worker backend cutover: removed the Prime package/import/dependency/config surface, propagated native admissions, and passed no-Prime scans plus real Model Gateway HTTP acceptance. Remaining operational Phase 1 PostgreSQL reconciliation is tracked separately.
- [next] Conversation-centric TUI streaming slice: obtain approval for the design, then add durable `turn_delta` events, SSE reconnect/cursor rendering, Markdown transcript rendering, cancellation/unknown feedback, and interaction tests.


## 2026-09-07 — Phase 5 conversation/login operational slice

- **[self_verified_pending_full_db_gate]** Native conversation turns now retain assistant context across turns and restore ordered durable history after Control Plane runtime rebuild. Gateway and Control Plane SSE paths enforce disconnect/backpressure bounds, and invalid JSONB-hostile text is rejected before persistence.
- **[self_verified_pending_full_db_gate]** Codex managed login now uses the official `codex_cli_rs` app-server originator by default. The TUI renders the provider URL and supports `Alt+C` shell-free clipboard copy. A real installed Codex app-server probe confirmed the URL shape and originator. Full PostgreSQL `npm run check` remains blocked by unrelated pre-existing integration failures; focused conversation/migration PostgreSQL evidence is 8/8.
- **Next:** restart and exercise the built local gateway/control-plane HTTP path, then commit/push. Do not mark Phase 5 or native worker migration accepted until full DB and real-process recovery gates pass.


## 2026-09-08 — Current execution pointer (authoritative)

- Native runtime cutover is complete on `main` (`50958c2`): `packages/prime-adapter` and `prime-agent` are deleted from source, workspace, lockfile, and installed dependencies.
- Control Plane composes the native Model Gateway kernel and fails closed when the gateway is absent. There is no Prime fallback.
- Native admission evidence is complete for Worker, Head, semantic review, Encore, and bounded team-lead helper seams. Real loopback Model Gateway HTTP acceptance passed 1/1; no-database `npm run check` passed 102 files / 665 tests.
- The full PostgreSQL rerun is the active gate. Do not mark Phase 1 complete until its failures are independently reproduced, fixed, and rerun with real process evidence.


## 2026-09-08 — Documentation, split-files, CI, and full-suite hardening pass

- Documented every app/package README, and moved the CLI TUI into its correct phase scope: Phase 1 fixes its authority/data boundary, Phase 3 adds it to the CLI/App-parity acceptance gate. No behavior change, boundary was already correct in code.
- Split `apps/cli/src/tui/entry.ts` and `apps/control-plane/src/server.ts` into smaller focused modules (`components/editors.ts`, `components/conversation-viewport.ts`, `server-input.ts`) with no behavior change; build/lint/tests green throughout.
- Added durable native-admission binding evidence (`native_execution_bindings`, migration `0070`) across every native call site (Worker, Head, semantic review, Encore reviewers, team-lead helper) via a shared `recordNativeExecutionBindingIfSupported` bridge that fails closed (cancels + releases the provider session) if durable recording fails.
- Added `.github/workflows/ci.yml` (static gate + real-PostgreSQL-service gate). The workflow file itself could not be pushed with the current token (`workflow` scope missing); it is preserved on local branch `ci-workflow-pending` and every other change from that commit is already on `main` via cherry-pick.
- Root-caused and fixed a real bug that a resource-exhausted host (12 stale disposable `maestro-*-postgres` containers) was masking as flaky `Connection terminated unexpectedly` failures: `device.integration.test.ts` used a stale hand-picked migration subset missing `0046_device_grants.sql`, so `revokeDevice`'s grant-revocation cascade failed once the suite actually got to run. Fixed to `applyAllMigrations`, matching every sibling device suite. See `findings.md` same date for full detail.
- Cleaned up all 12 stale Maestro disposable containers; one fresh, single, cleanly named container now runs the final full-suite rerun (`maestro-phase1-final-clean`, port 55480).
- **Next:** confirm the final full clean single-worker PostgreSQL rerun passes end to end, then re-run build/lint/no-Prime-scan/HTTP-acceptance as the closing Phase 1 gate evidence and update the roadmap doc's Phase 1 status line accordingly.


## 2026-09-08 — Full PostgreSQL rerun closed clean

- Full single-worker real-PostgreSQL rerun on a fresh disposable container: **154/154 files, 1049/1049 tests, 0 failed.** `npm run build`, `npm run lint`, and the no-Prime scan are all clean on the same tree.
- This closes the previously-open "finish the full PostgreSQL rerun" and "reproduce/fix the git-integration frozen-revision failure" items — both are green (the git-integration suite was already fixed and reconfirmed earlier in this session; the two connection-drop failures were host resource contention, and the real bug found underneath, a stale migration subset in `device.integration.test.ts`, is fixed).
- **Still open for full Phase 1 acceptance:** (1) wire and register production native host tools and prove tool enforcement through the real gateway path; (2) add a full Control Plane + PostgreSQL + Model Gateway Worker acceptance scenario beyond the current fake-provider HTTP test (`native-gateway-http.integration.test.ts`).
- `.github/workflows/ci.yml` is written and committed but not pushed — the current token lacks the `workflow` OAuth scope; the workflow-file commit is preserved on local branch `ci-workflow-pending` for a token with that scope to push. Every other commit from that history is already on `main`.
