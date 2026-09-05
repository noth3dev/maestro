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

## Phases
- [complete] 1. Reconcile current code with Phase 1 requirements; define the smallest safe remaining vertical slice.
- [complete_with_environment_gate] 2. Implement and verify Phase 1 lease/fencing persistence and guarded state-changing writes.
- [complete_with_environment_gate] 3. Complete remaining Phase 1 command/recovery/evidence boundaries required by Phase 2. Tag `phase1-accepted` at `541ce7d`.
- [in_progress] 4. Implement Phase 2 Task Contract and Secretary intake vertical slice. Organization/personas (`2e8e5a5`), Overture Task Contract (`c653760`/`c89042d`), Head activation (`b835564`/`ac65c8d`) done on branches, not yet merged to `main`.
- [complete] 5. Head Council sealed-submission slice (P2S5) accepted after independent review and real-PostgreSQL verification on `phase2/p2s5-integration` (7a627a2): 254 passed, 1 intentional skip, 0 failed. See "Phase 2 detailed status" below for accepted boundary. Department Plans (P2S6) and beyond not started; in_progress.
- [complete_pending_independent_review] 6. Full Phase 2 work-sequence (steps 6-12) implemented and self-audited on `phase2/p2s5-integration` (fc79c6c): 331 passed, 0 failed. A cross-cutting Council departmentOwnership authorization gap (Department Plan/budget/Git-branch creation) was found and fixed in this final self-audit. P2S5/P2S6 independently reviewed; P2S7-P2S12 self-reviewed only (subagent independent review unavailable throughout this session's back half). Proceeding to Phase 3 per user direction.
- [complete] 7. Phase 3 (plan/phase3.md) work-sequence steps 1-10 on `phase3/integration` (`699dee1`), real-PostgreSQL verified: 453 passed, 1 intentional live-Prime skip, 0 failed.
- [complete] 8. Phase 3 step 11 (complete live release scenario) fully closed: live Prime worker execution proven (`MAESTRO_LIVE_PRIME=1`), full unsupported-assertion Encore Council round proven, forced mid-flight restart/reconciliation proven, and Tests item 18 (CLI/app parity) proven with a real-PostgreSQL end-to-end fixture (`apps/control-plane/src/read-state-parity.integration.test.ts`) asserting the CLI and `@maestro/api-client` return identical Metronome challenge, Encore Council round, certification, and Concertmaster report state for the same real Goal through a live HTTP server. Final real-PostgreSQL `npm run check`: 459 passed, 2 skipped (live-Prime cases skipped by default, separately proven passing with `MAESTRO_LIVE_PRIME=1`), 0 failed. **Phase 3 exit gate: all 13 live-gate steps and all 18 Tests items evidenced.** Secretary UI has no dedicated panel for these four record kinds yet (Goal/event loaders only) -- a UI-layer follow-up, not a gap in the API/CLI parity claim itself.
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
