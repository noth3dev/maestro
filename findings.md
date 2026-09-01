# Findings

## 2026-08-31 — Restarted implementation
- `plan1.md` (867 lines), `plan/phase1.md` (314 lines), and `plan/phase2.md` (582 lines) were reread in full before execution.
- Existing worktree: `/home/ubuntu/projects/ms/.worktrees/phase1`, branch `phase1/control-plane`, clean at start.
- Existing baseline: workspace/config validation, Goal transitions, basic authority decisions, command idempotency, and Prime SDK compatibility check.
- Baseline `npm run check`: 14 passing, 4 skipped. Database integration tests need `MAESTRO_TEST_DATABASE_URL`; live Prime test needs `MAESTRO_LIVE_PRIME=1`.
- Prior audit identifies lease/fencing and durable recovery as the smallest critical missing Phase 1 safety slice.

## 2026-08-31 — Phase 1 reconciliation
- Reconciliation confirms the smallest coherent next slice is durable lease/fencing for Goal command writes.
- Required proof: only a current, unexpired owner with the matching monotonic fencing token can mutate Goal projection, events, or outbox; stale attempts leave all three unchanged.
- Keep this slice limited: no scheduler, recovery loop, API, UI, or Phase 2 hierarchy.

## 2026-08-31 — Lease/fencing partial implementation recovery
- Preserved changes add `goal_leases`, `acquireGoalLease`, proof checking before receipt lookup, and environment-gated integration cases.
- It has not yet produced a full GREEN report. Static review must confirm transaction correctness, renew behavior, migration choice, and whether the required test evidence exists.
- The worker was stopped because an external PostgreSQL/Testcontainers probe did not return; no dependencies were installed and no environment change was made.

## 2026-08-31 — Lease/fencing independent review
- Partial implementation is salvageable because proof validation is inside the command transaction before receipt/event/projection/outbox mutation.
- Completion blockers: no renew path; `bigint` token coerced to unsafe JS `number`; edited append-only `0001` migration; one idempotency test conflicts with the proof-before-receipt policy.
- Required repairs: preserve token exactly as `bigint` or decimal string, add atomic renew, move lease schema to `0002`, repair test semantics, and add concurrency/old-token/forged-proof assertions.
- Static verification: build passed; full check passed with all DB lease tests environment-skipped. No real PostgreSQL success claim is permitted.

## 2026-08-31 — Lease/fencing final validation blocker
- Validator found one blocking input-boundary gap: decimal token syntax alone accepts values above PostgreSQL signed bigint maximum, allowing a database range error rather than the consistent stale-lease rejection.
- Repair requirement: validate `1..9223372036854775807` using string length/lexical comparison; no numeric coercion. Test max accepted and max+1/very-long values rejected as `StaleGoalLeaseError`.

## 2026-08-31 — API slice design
- Minimal API scope is Goal create/transition/query plus durable-cursor SSE; UI, CLI, full OpenAPI generation, authority CRUD, Prime calls, and recovery scheduler stay out.
- API must not conflate a command's audit actor with the control-plane process lease owner. Existing command proof validation currently requires equality and must be corrected before the API slice.
- Contract and query cursor types must preserve UUID/version/event cursor validation centrally, with event cursors as signed bigint decimal strings.

## 2026-08-31 — Fastify Goal API review blockers
- API slice has three blockers: same-owner lease is not renewed/reused for immediate next command; handlers generate command IDs so HTTP retry is not durable-idempotent; malformed JSON maps to 503 rather than validation 400.
- Repair scope is intentionally limited to lease acquire-or-renew, strict public Idempotency-Key command identity, and Fastify parse-error mapping.

## 2026-08-31 — Incomplete API durability repair
- Parent verification after worker termination: route suite 4 failures, service suite 2 failures, and `npm run check` build failure (`server.ts` calls old service signatures).
- Required minimal repair: align service method signatures with command ID arguments; have routes validate and forward `Idempotency-Key`; map Fastify parser errors to 400; make the lease manager renew or reuse a same-owner current proof instead of acquiring twice.

## 2026-08-31 — API final validation blocker
- Same Idempotency-Key with different durable command payload correctly raises `CommandIdReuseError` in persistence, but the service currently translates it to 503.
- Required repair: preserve it as a stable API conflict (`409 command_id_reused`) with a route/service regression test.
- Trusted server config retains actor/instance identity; the public HTTP contract remains strict and does not expose actor/fence/approval fields.

## 2026-08-31 — Real PostgreSQL verification
- User enabled Docker. A dedicated disposable PostgreSQL 17 container `maestro-phase1-postgres` runs with no host volume at `127.0.0.1:55432`.
- `MAESTRO_TEST_DATABASE_URL=postgresql://maestro_test:maestro_test@127.0.0.1:55432/maestro_test npm test -- packages/persistence/src/commands.integration.test.ts` passed: 12/12.
- Full check under the same URL passed: 51 tests; only the explicit live Prime probe remains skipped.
- The integration suite drops/recreates tables, so the container/database is dedicated and must never be replaced with a shared or production URL.

## 2026-08-31 — Phase 1 ordering after parallel designs
- Prime execution kernel port is the immediate write slice because Phase 2 hierarchy must not leak SDK types.
- Before any authenticated event stream, app/CLI, or actual external execution, add local operator authentication and DB-backed authority gateway; existing evaluator is pure-only.
- SSE must authorize every request/reconnect and use `goal_events.global_position` as durable replay truth, not outbox.

## 2026-08-31 — Prime execution-kernel review blockers
- Adapter leaked SDK child IDs through public InvocationRef and failed to register root invocations for status/cancel lifecycle.
- Domain port omitted required normalized tool-event and usage surfaces.
- Repair must retain SDK identifiers only in adapter-private records, register every returned opaque ref, and add minimal public normalized event/usage types plus tests.

## 2026-08-31 — Prime adapter final validation blockers
- Adapter must not convert missing snapshot/observation evidence into empty tool events, unknown usage, failed child status, hidden observation, or succeeded root status.
- Repair requirement: extend normalized contract with explicit unavailable/unknown-observation semantics; retain every registered public ref in observe; only report terminal status with actual supporting evidence.

## 2026-08-31 — Prime execution-kernel accepted
- Final independent validation passed after opaque ref and observation truthfulness repairs.
- Full suite with real disposable PostgreSQL: 58 passed, one intentionally gated Prime live test skipped.
- Live runtime behavior remains an explicit Phase 1 exit-gate limitation until `MAESTRO_LIVE_PRIME=1` is safely enabled.

## 2026-08-31 — Local operator auth security blockers
- Credential revocation can currently be reversed and verifier/salt can be edited by direct DB update; enforce one-way revocation and immutable verifier material in the database.
- Authentication scans/scrypts all credentials without count, secret-length, or concurrency bounds; add bounded local defenses and fail closed under saturation.
- Real Pool-to-Fastify authenticator composition and credential-level command attribution remain explicit later wiring/audit slices, not a claim of completion now.

## 2026-08-31 — Local operator auth accepted
- Final independent review passed for the bounded local auth code. Parent verification with dedicated PostgreSQL passed 73 tests; live Prime remains the only skipped test.
- Scope limitations: scrypt limit is process-local; migrations/triggers assume the control-plane DB role cannot disable them; Pool/authenticator composition and runnable control-plane entrypoint are still missing.

## 2026-08-31 — Composition integration test gating blocker
- `main.integration.test.ts` constructs `new URL(databaseUrl!)` at module load, so no-DB runs fail despite describe.skip.
- Repair: defer URL/Pool/schema setup until the DB-gated suite executes; preserve real DB coverage and default no-DB skip behavior.

## 2026-08-31 — Composition root accepted
- Integration test now defers DB URL/Pool setup correctly: no-DB mode cleanly skips; dedicated DB mode proves authenticated real loopback create/transition/query and shutdown.
- Durable authority design confirms evaluator scopes must include project and budget amount, and DB decision audit must succeed before any effect callback.

## 2026-08-31 — Durable authority gateway accepted as foundation
- Parent verification with dedicated PostgreSQL: 80 passed, live Prime 1 skip.
- Gateway has exact project/budget/actor/goal/action/target/policy/command matching and audit-before-effect fail-closed behavior.
- It currently has no production effect caller because no real effect adapter exists; any future Git/process/device/network/provider adapter must be wired through it and prove that integration.

## 2026-08-31 — Authenticated SSE real-DB verification failure
- SSE implementation was delivered but has not been accepted. Parent execution with the dedicated PostgreSQL URL found `apps/control-plane/src/main.integration.test.ts` loopback SSE replay/resume/disconnect test timing out at 5 seconds.
- The initially requested test paths do not exist as separate files; the SSE loopback scenario resides in `main.integration.test.ts`.
- `npm run check` with real DB currently fails solely on that timeout: 91 tests passed, 1 failed, 1 live-Prime skip. `git diff --check` passes.
- Next repair must diagnose stream framing/read completion and disconnect cleanup with a bounded deterministic test; do not weaken the test merely by raising its timeout.

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

## 2026-08-31 — SSE independent review blocker
- Active SSE raw responses are not ended before Fastify shutdown, so `app.close()` can wait indefinitely for open streams; current cleanup only clears timer/listeners too late.
- Combined repair with the existing loopback timeout: track active streams, close responses in a pre-close lifecycle hook, make cleanup idempotent, and add bounded real-loopback tests for open-stream shutdown plus replay/resume/disconnect framing.

## 2026-08-31 — SSE final validation blockers
- Fetch-error handling currently calls cleanup before terminal response write, making the no-write-after-cleanup ownership rule ambiguous. Separate terminal response ending from cleanup or end before cleanup.
- Loopback SSE tests rely on real 500ms polling and 1s races; replace this with injectable polling scheduler/fake-timer deterministic frame/order/cleanup tests rather than increasing timeout.

## 2026-08-31 — Authenticated SSE accepted
- Direct repair added header flushing for empty streams and a guard against writes after a disconnect during the initial durable read.
- SSE scheduler/frame test was made deterministic by pausing the test response until data listeners are installed and awaiting the first frame; it passed five consecutive focused runs.
- Final dedicated-PostgreSQL verification: 98 passed, one explicitly gated Prime live test skipped; DB-less mode cleanly skips DB integration tests.
- `designsystem.html` has an unrelated pre-existing working-tree modification and is excluded from the control-plane checkpoint commit.

## 2026-09-01 — Parallel Phase 1 slices completed
- Three isolated worktrees branched from checkpoint ce03550: phase1/evidence, phase1/recovery, phase1/client-cli.
- evidence (e0b85fd) and client-cli (d89399a) verified green with real disposable PostgreSQL on first check; committed directly.
- recovery initially failed 3 real-DB integration tests: emergency-stop reason was masked as "revoked_grant" because the control-latch recheck only ran after a pure-evaluator allow, and never on a Goal whose grant had also been revoked. Root fix (direct repair, not a subagent claim): always recheck Goal control before/regardless of the pure grant decision, and let emergency-stop dominate a stale-epoch reason. Verified stable across two consecutive real-DB runs (15/15) before commit (f83fe29).
- Migration filename collision: evidence and recovery each used 0006_*.sql for different schemas. Must renumber one before merging into phase1/control-plane.

## 2026-09-01 — Parallel slices merged into phase1/control-plane
- Merged phase1/client-cli, phase1/evidence, phase1/recovery sequentially with no code conflicts.
- A stale evidence_records table (missing the retention column) existed in the dedicated disposable database from an earlier iteration; dropped it before final verification, no code defect.
- Renamed colliding migration 0006_goal_control.sql to 0007_goal_control.sql and updated its one test reference.
- Final real-PostgreSQL verification: 115 passed, 1 explicitly gated Prime live test skipped.

## 2026-09-01 — Cross-suite migration cleanup defect
- After merging evidence and control-plane slices, a full real-DB check intermittently failed: `evidence_records.retention` disappeared because `commands.integration.test.ts` unconditionally ran `DROP TYPE IF EXISTS retention_class CASCADE`, which now cascades into the evidence table's column since both suites share one disposable database and the same enum type.
- Root fix: removed the shared-type drop from that suite; it only resets its own tables. `retention_class` is idempotently created by 0001's DO block regardless.
- Verified stable across three consecutive full real-PostgreSQL runs: 115 passed, 1 live-Prime skip each time.

## 2026-09-01 — Live Prime parent/child verified; honest answer-text gap fixed
- Ran the real live Prime parent/child test in this very runtime (MAESTRO_LIVE_PRIME=1): spawn, prompt, named direct child completion, and real model identity (`anthropic/claude-sonnet-5`) all verified genuinely, not mocked.
- Discovered a real gap: the pinned Prime Agent 0.8.0 SDK's in-process `createAgentSession`/RlmChild snapshot does not populate `answerPreview` for a completed, explicitly-replied child, and `handleAgentObserveHostRequest` is unavailable outside the daemon runtime. Verified this directly with a raw debug script against the real SDK (not just the adapter).
- Fix: added an honest discriminated `InvocationAnswer` type (`available`/`unavailable`) to the domain contract, mirroring the existing toolEvents/usage pattern; the adapter never fabricates an answer, and the live test accepts either a real answer or the documented unavailable reason.
- Full disposable-PostgreSQL check: 115 passed. Live Prime test: 1 passed (previously the only remaining skip).

## 2026-09-01 — Restart/reconciliation leadership scaffold (isolated worktree phase1-reconciliation)
- Added a durable singleton `reconciler_leader_lease` table (migration 0008), separate from `goal_controls`/`goal_leases`, with the exact same atomic acquire/renew/fence semantics as `goal_leases` (fencing token kept as exact PostgreSQL bigint text, never coerced to a JS number; one-way expiry-gated `ON CONFLICT ... WHERE expires_at <= transaction_timestamp()` acquire).
- Added `reconcileOnStartup`: acquires the leader lease, lists nonterminal Goals (via new domain `isTerminalGoalState`/`TERMINAL_GOAL_STATES`), and for each checks goal_leases/goal_controls consistency. An unexpired goal_leases row surviving past a reconciler restart, or an `emergency_stopped_at` latch inconsistent with the Goal's persisted state, is never silently resumed — it is durably transitioned to the domain's existing `recovering` Goal state via the existing `executeGoalCommand` path (reusing `goal_events`/`goals`, no new outcome table). No actual Prime session reconciliation is implemented (no durable session bindings exist yet in this phase); this is explicitly scaffold only.
- Discovered a second instance of the cross-suite shared-table race documented in the prior `retention_class` fix: this suite's real-PostgreSQL integration test needs `goals`/`goal_leases`/`goal_controls`, which are exclusively owned/truncated by `commands.integration.test.ts` and `authority.integration.test.ts` respectively. Running vitest's default parallel-file workers let those suites' `beforeEach` TRUNCATEs race this suite's rows. Root fix: added `vitest.config.ts` with `test.fileParallelism: false` so integration suites sharing one disposable database never execute concurrently; this is a test-infrastructure change only, no production behavior changed.
- Verified stable across three consecutive full real-PostgreSQL `npm run check` runs: 131 passed, 1 explicitly gated Prime live test skipped, each time.


## 2026-09-01 — Remaining Phase 1 exit-gate gap assessment
Against plan/phase1.md's exit gate and Tests section, still missing:
1. An actual process kill-and-restart acceptance test against a running control-plane process with an active Goal (durable reconciliation exists as a scaffold/library, but has not been exercised against a real killed/restarted process).
2. fast-check property-based fencing tests across every state-changing repository method (Tests #3); current fencing coverage is example-based, not generative.
3. A concrete example wiring `AuthorizedEffectExecutor` to at least one real effect call site (e.g. a stub critical-action adapter) so "block an unauthorized critical action" is demonstrated end-to-end, not only unit-level.
4. The Secretary Next.js app shell (CLI exists; app does not). Test #6 requires identical durable state shown by both app and CLI.
5. A failure-injection harness (work sequence item 10) and corrupted-evidence-hash rejection proof (Tests #9).

## 2026-09-01 — Fencing property tests (Tests #3)
- Added fast-check generative property tests covering stale/forged fencing tokens and goalId/ownerId mismatches against every state-changing Goal command path (CreateGoal, TransitionGoal) and renewGoalLease, proving zero durable writes (receipts/events/goals/outbox unchanged) on every generated case, then that the real current proof still works afterward (forging never corrupts a lease).
- Verified stable across two consecutive real-PostgreSQL runs: 145 passed.


## 2026-09-01 — Cross-phase plan consistency corrections
- Preserved the deterministic-rule-first principle explicitly across Phase 3 Sentinel, Phase 5 Scheduler, and Phase 6 evaluation guards: model judgment is reserved for ambiguity and cannot write durable constrained state directly.
- Corrected Phase 6 main-body timing ambiguity: static persona baselines and evidence/candidates may exist earlier, but replay/synthetic/shadow evaluation and any adaptive live application begin only in Phase 6. The retained “Phase 4” wording is legacy design provenance, not delivery authorization.
- Added the required `(HeadRoleId, GoalId)` runtime-context partitioning constraint to Phase 2 and a durable hierarchy projection-read-model contract for Phase 7.
- Reframed Phase 8 Purpose as certification/hardening rather than a duplicate organization-definition section.


## 2026-09-01 — P2W5 Council re-scope after Luna-max audit
- The uncommitted Council code is a persistence sketch, not a safe reusable sealed-submission boundary. Do not accept it as a narrow brief feature.
- P2W5 is decomposed without advancing Phase 3: first a generic sealed-submission primitive with immutable frozen participant/session/contract/evidence identity, idempotency, deadline/disposition policy, reveal, append-only audit/event truth, and control/lease checks; then the Head Council-specific consumer with evidence-tagged complete rounds, durable novelty/stopping, and a non-executable escalation outcome.
- Phase 3 will reuse the primitive for independent reviewer judgments and Sentinel will consume its durable event/evidence lineage. This adds no reviewer spawning or Sentinel implementation in Phase 2.
