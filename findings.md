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
- Preserved the deterministic-rule-first principle explicitly across Phase 3 Metronome, Phase 5 Scheduler, and Phase 6 evaluation guards: model judgment is reserved for ambiguity and cannot write durable constrained state directly.
- Corrected Phase 6 main-body timing ambiguity: static persona baselines and evidence/candidates may exist earlier, but replay/synthetic/shadow evaluation and any adaptive live application begin only in Phase 6. The retained “Phase 4” wording is legacy design provenance, not delivery authorization.
- Added the required `(HeadRoleId, GoalId)` runtime-context partitioning constraint to Phase 2 and a durable hierarchy projection-read-model contract for Phase 7.
- Reframed Phase 8 Purpose as certification/hardening rather than a duplicate organization-definition section.


## 2026-09-01 — P2W5 Council re-scope after Luna-max audit
- The uncommitted Council code is a persistence sketch, not a safe reusable sealed-submission boundary. Do not accept it as a narrow brief feature.
- P2W5 is decomposed without advancing Phase 3: first a generic sealed-submission primitive with immutable frozen participant/session/contract/evidence identity, idempotency, deadline/disposition policy, reveal, append-only audit/event truth, and control/lease checks; then the Head Council-specific consumer with evidence-tagged complete rounds, durable novelty/stopping, and a non-executable escalation outcome.
- Phase 3 will reuse the primitive for independent reviewer judgments and Metronome will consume its durable event/evidence lineage. This adds no reviewer spawning or Metronome implementation in Phase 2.

## 2026-09-01 — Direct (no-subagent) resumption of P2S5
- Prior subagent attempts (Terra, then Luna at max thinking) were spawned for read-only audits but were cancelled/completed without replying; discarded, no salvage needed.
- Proceeded directly: implemented sealed-submission primitive and wired it into Head Council creation for real (not just present alongside it). Build+unit tests green; PostgreSQL integration tests remain environment-gated (Docker not available this session).
- Department Plan work (step 6) can now begin against a durable, tamper-evident decision packet identity.

## 2026-09-03 — P4S6 Discord hardening findings
- The initial `recordDiscordSignal` receiver read `max(sequence)` without a writer serialization boundary. Two concurrent transactions could both accept values from the same stale high-water mark and commit an older sequence after a newer one. A deterministic PostgreSQL trigger/`NOTIFY` race reproduced this; `LOCK TABLE discord_signals IN SHARE ROW EXCLUSIVE MODE` now serializes receiver writers before replay evaluation.
- Durable Discord signal rows are audit records. Migration `0040_discord_signal_hardening.sql` adds immutable-row triggers and database checks for observation order and JSON-array evidence. It is additive because `0039_discord_signals.sql` is already committed.
- Discord's local buffer now verifies envelopes against its configured HMAC credential before appending. Its flush loop also records a concurrent flush request so a signal emitted during an in-flight delivery is not left pending when `emit` returns.
- Fresh full-suite PostgreSQL failures are pre-existing per-file migration-list omissions, not Discord defects: `concertmaster-report.integration.test.ts` omitted budget migration `0027`; `certification-conflict.integration.test.ts` omitted semantic-review migration `0030`. Parent session is fixing these through a shared migration runner on a separate branch.

## 2026-09-03 — P4S7 Discord incident identity and silence findings
- Incident identity is `(authenticated incident fingerprint, affected version)`. The derived fingerprint intentionally excludes version so a repeated anomaly on a new version is a separate incident without changing the anomaly identity; normalized evidence order/case/whitespace produces stable hashes.
- Incident aggregation is monotonic: severity keeps the highest observed level and confidence keeps the strongest bounded value. Every accepted signal has one immutable incident link, making duplicate attachment idempotent and preserving source signal history.
- Silence is represented only as watchdog uncertainty (`discord_observation_missing` or `discord_observation_silent`). No empty incident or "no incidents" conclusion is written from absent data.


## 2026-09-05 — Phase 5 Runtime Slice 1 takeover
- The current runtime worktree is an uncommitted implementation, not an accepted recovery path. It durably fences a worker to the successor Goal lease and records one `worker_recovery_decisions` row, but the current acceptance requirement still needs a separately-running provider harness and a real control-plane kill/restart through the HTTP worker path.
- The existing `workers.execution_ref`/`invocation_ref` remains the provider identity; `0061_worker_runtime_ownership.sql` adds owner/fence/heartbeat and two-phase cancellation facts without introducing a competing invocation identity table.
- Helper workers created by `spawnHelperWorker` currently return the expanded domain `Worker` shape with null ownership fields and do not bind provider ownership before their provider spawn. This is a concrete Slice 1 gap to resolve or explicitly bound before acceptance; runtime recovery must cover every provider-backed worker, not only root mission workers.


## 2026-09-05 — Phase 5 Track A1 focused runtime findings

- Helper-worker creation had the same reserve-before-effect invariant as ordinary workers but did not implement it. The provider call happened before the `workers` insert, so provider success followed by process loss could not be reconciled to a durable worker.
- Runtime ownership fields are persistence/domain internals today. Returning them directly through the existing strict public `WorkerSchema` would fail at runtime; the control-plane worker service must project the old wire shape until a versioned recovery read contract is added.
- Observation is a durable write. It must not be callable without the current Goal lease/fencing proof; terminal reads may still return without provider access.
- A hanging provider close can block SIGTERM cleanup indefinitely. The composition root needs a bounded drain while SIGKILL remains handled conservatively by lease expiry and recovery fencing.
- Remaining risk: the production Prime adapter is process-local and intentionally cannot resume/reconnect old sessions. Slice acceptance still needs the real process-backed provider/control-plane kill-and-restart harness required by `plan/phase5-execution-slices.md`.


## 2026-09-05 — Phase 5 Track A1 focused-suite failure diagnosis

- `head-participation-api.integration.test.ts` failed only because its fake kernel deliberately returned `cancelled:false` after an empty observation, while the test then attempted a new worker. Under conservative restart/provider semantics that outcome is `unknown`, and retry must be blocked. The fixture's intended downstream certification path needs a provider-confirmed cancellation response; changing production code to allow the retry would violate the retry-blocking invariant.


## 2026-09-05 — Phase 5 Track A1 implementation checkpoint

- The runtime worktree now covers ordinary and helper workers with reserve-before-spawn ownership, bind/fence proofs, heartbeat/lease expiry, conservative unknown outcomes, proof-bound observation/cancellation, and bounded control-plane shutdown. The API keeps ownership internals out of the existing strict `WorkerSchema` projection.
- A test-only JSON-lines provider process and real loopback HTTP control-plane test provide the required kill/restart evidence. The test proves one successor fencing decision, preserved opaque refs, no duplicate provider spawn, and retry blocking.
- The remaining acceptance gates are the broad full-test result, independent review, clean worktree/branch state, and commit/push.


## 2026-09-05 — Phase 5 Track A1 independent review blockers

- Review confirmed the existing worker kill/restart test did not kill a control-plane process; it only closed in-process objects. It also identified stale helper/worker state writes and provider cancellation after lease turnover as unsafe without a current durable claim.
- Corrective runtime patch now uses current Goal lease proofs for worker mutations, Goal-before-worker lock ordering, a serialized cancellation claim, and successor-lease-bound DB owner transfer. Focused PostgreSQL evidence is **39/39** after these changes.
- Acceptance remains blocked until the real control-plane child-process kill/restart test and a fresh full suite pass.


## 2026-09-05 — Phase 5 Track A1 review resolution checkpoint

- The initial independent review was a valid blocker, not a paperwork issue. The runtime slice now closes the stale-write, lock-order, provider-cancel race, forged DB-transfer, and true-process-boundary gaps identified in review.
- New focused evidence: worker **28/28**, helper/team-lead **10/10**, reconciliation **11/11**, real killed-control-plane/surviving-provider **1/1**; total **50/50**.
- Broad test evidence is still pending; no acceptance or Phase 5 completion claim yet.


## 2026-09-05 — Phase 5 Track A1 provider-boundary residual risk

- The real child-process test intentionally leaves the surviving provider invocation `running` after successor fencing and asserts spawn count remains one. This proves no duplicate admission and durable ref preservation. It does not claim to stop external side effects because the provider-neutral kernel exposes no owner epoch/fence operation.
- This boundary is explicit, not hidden: provider adapter cancellation/fencing must be added before any future slice claims stale external execution suppression.
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
## 2026-09-06 — Secretary Electron shell is a fully mocked prototype, not a wired console

- `apps/secretary` is an Electron app (migrated from Next.js in `hardening/lifecycle`'s `e55146b`),
  not the single-Goal Next.js page `task_plan.md`'s Phase 5 Track A7 section still describes.
- Real, unit-tested data plumbing exists end to end: `connection.tsx` (IPC-backed connection
  config get/save/clear), `goals.tsx` (`GoalsProvider`, lists/selects a Goal via
  `window.maestro.api.listGoals`), `useGoalDetail.ts` (loads Goal + events + budget +
  certifications for the selected Goal), `lib/goal-data.ts` (pure, tested read-model assembly),
  and `electron/apiBridge.ts` (an explicit allowlist exposing `listGoals`, `getGoal`,
  `getBudgetSummary`, `listEvents`, the full Task Contract lifecycle, `pauseGoal`/`resumeGoal`/
  `stopGoal`/`emergencyStopGoal`, `listCertifications`, `listMetronomeChallenges`,
  `listEncoreCouncilRounds`, `getConcertmasterReport` from the renderer).
- Despite that, `grep -rl 'useGoalDetail|useGoals()|window.maestro' apps/secretary/src/views
  apps/secretary/src/*.tsx` matches only the provider files themselves (`connection.tsx`,
  `goals.tsx`, `theme.tsx`) — never a single one of the 13 views (`home`, `dashboard`, `channel`,
  `git`, `floor`, `inbox`, `evlog`, `billing`, `settings`, `luthiery`, `arrangements`, `flashmob`,
  `flashmobSession`). Every view renders hardcoded constants: `Dashboard.tsx`'s `departments`
  array and "4 missions in flight / 3 pending approvals / 7 certified / 2 of 5 departments awake"
  stat block; `Billing.tsx`'s `spendByDay`/`usageByGroup`/`recentGoals` constants and "$186 / $300
  · 62%" progress bar; `Channel.tsx`'s scripted chat transcript; `Git.tsx`'s fixed file-diff list
  and fixed branch/worktree path string; `EvidenceLog.tsx`'s three fixed entries with fabricated
  sha256 prefixes. None of this is wired to the real control plane; it is example/reference visual
  design, and must not be mistaken for operational read coverage in any future acceptance claim.
- `App.tsx` documents this explicitly with a `ponytail:` comment: the real `Setup`/connection gate
  exists and works, but is deliberately bypassed so the mock Shell renders unconditionally; the
  comment itself says to remove the bypass once write flows are ready to go through a real
  connection again. This is intentional, tracked debt, not an oversight to silently "fix" without
  first wiring at least one real view — removing the bypass today would just show a blank/broken
  shell with no wired data to prove works.
- Real remaining gap, corrected from the (too pessimistic) "read-only single Goal page" framing:
  wiring existing mock views to already-real plumbing/API-bridge methods, plus extending
  `apiBridge.ts`'s allowlist for the write actions (critical-action approve-and-run, Metronome
  correction/safe-pause/resolve, Council/Plan/Mission/worker/Git writes) that already exist as
  real control-plane routes but are not yet exposed to the renderer.

## 2026-09-06 — node_modules workspace-symlink defect (local environment, not a repo defect)

- Main worktree's `node_modules/@maestro/` was missing `device-agent` and `device-agent-app`
  symlinks that every other workspace package already had (`api-client`, `authority`, `cli`,
  `contracts`, `control-plane`, `discord`, `domain`, `environment-adapter`, `evidence`,
  `git-adapter`, `persistence`, `prime-adapter`, `secretary`). This caused `npm run build` to fail
  with `Cannot find module '@maestro/device-agent'` purely from local disk state, unrelated to any
  code change. `npm install` recreated exactly those two symlinks with zero `package-lock.json`
  diff (confirmed via `git status`/`git diff --stat` before and after: no changes). `npm run build`
  is clean afterward on `hardening/lifecycle` HEAD (`ce94c3d`).

## 2026-09-06 — Three integration test files crash instead of skipping without a real database

- Running `npm test` with no `MAESTRO_TEST_DATABASE_URL` set (no Docker in this runtime) correctly
  skips almost every real-PostgreSQL integration suite, but three files throw `TypeError: Invalid
  URL` at module-eval time instead of skipping cleanly:
  `apps/control-plane/src/worker.kill-restart.integration.test.ts`,
  `apps/device-agent/src/main.integration.test.ts`, and
  `packages/persistence/src/device-agent-runtime.integration.test.ts`. Each builds a scoped
  database URL with `new URL(databaseUrl!)` before any `describe.skipIf`/environment guard exists
  to short-circuit that construction when the variable is undefined. Full evidence:
  `npm test` (no DB): **441 passed, 342 skipped, 3 failed** (only these three files) on
  `hardening/lifecycle` HEAD. Not fixed this session -- flagged as a small, isolated follow-up; the
  fix pattern already exists in every other DB-gated suite in this repo (guard the URL
  construction itself, not just the `describe` block, behind the same environment check).


## 2026-09-06 — Fixed the 3 skip-guard integration test crashes

- Root cause confirmed: `describe.skip` still synchronously invokes its callback to register the
  (skipped) test structure; a module-scope `new URL(databaseUrl!)` inside that callback threw
  before vitest's skip logic ever applied, in exactly the three files noted in findings.md's
  "Three integration test files crash instead of skipping" entry.
- Fix: guarded each `scopedUrl` computation with `databaseUrl ? ... : ""`, matching the working
  pattern used elsewhere in the same files (`describeDatabase = databaseUrl ? describe : describe.skip`).
  No production code touched; test-only change in
  `apps/control-plane/src/worker.kill-restart.integration.test.ts`,
  `apps/device-agent/src/main.integration.test.ts`, and
  `packages/persistence/src/device-agent-runtime.integration.test.ts`.
- Verified: fresh `npm run build` clean; `npm test` (no DB in this runtime) now reports
  **107 test files: 57 passed, 50 skipped, 0 failed; 796 tests: 447 passed, 349 skipped, 0 failed**
  — the three files that previously crashed now skip cleanly like every other DB-gated suite.

## 2026-09-06 — Documentation drift confirmed during progress check

- `task_plan.md` contains historical Phase 5 status wording that understates the current implementation. Live code confirms the broader authenticated API surface and the Electron Secretary architecture described in the later reconciliation entry.
- The current `main` tip is `95bef8e` (not the older `hardening/lifecycle`/`ce94c3d` reference in the historical entry).
- No source defect was found in this check. The remaining evidence limitation is environmental: PostgreSQL integration suites cannot run here.


## 2026-09-06 — Maestro TUI review and hardening
- Independent review identified a durable-approval bypass risk for project-access provisioning, setup state collapse, missing attach flow, unbounded SSE retry, misleading approval count, project-binding spread order, and command alias drift.
- The TUI now blocks local-only approval for critical operations without a server-side durable approval binding; only `approval:approve-and-run` reaches the durable endpoint. Setup-required is rendered distinctly, `/session attach --project-id=...` provides an explicit fallback for a workspace with no saved identity, `/new` preserves project/cursor metadata while clearing the active conversation Goal, and `/retry` rechecks startup health.
- SSE reconnects are bounded to five retries by default and report retry/exhaustion state. Active Worker counts exclude terminal statuses. Session metadata is sanitized on load and permissions are re-applied on every write.
- Remaining acceptance gaps are intentional: no local PostgreSQL/operator bootstrap, no natural-language Control Plane conversation endpoint, no real-process TUI recovery/parity integration test, and unavailable server surfaces remain explicit rather than fabricated. The emergency-stop fail-safe is server-authorized and now also requires explicit local confirmation; it is not treated as durable CEO approval.


## 2026-09-07 — Prime Agent/model replacement audit finding

- **Confirmed policy mismatch:** Mission Bundle `approvedModels` is required and included in the bundle contract (`packages/domain/src/mission-bundle.ts:16,69-70`), but worker admission sends only `allowedTools` and `allowedSkills` (`packages/persistence/src/worker.ts:209-216`). The default Prime adapter calls `createAgentSession` without a model (`packages/prime-adapter/src/execution-kernel.ts:365-379`), so model choice is delegated to Prime Agent's registry/settings/auth path. No production consumer of `approvedModels` was found outside validation/domain code.
- **Risk:** the actual provider/model can differ from the model approved for the mission; `getModelIdentity` only reports the chosen model after admission (`packages/prime-adapter/src/execution-kernel.ts:265-269`). This must be fixed before claiming model-provider replacement or stronger approval semantics.
- **Boundary:** no code or credentials were changed in this audit. Direct ChatGPT/OpenAI and Claude adapters remain design candidates only; subscription/API credentials stay provider-local.


## 2026-09-07 — Native backend adversarial review findings

- **Critical:** The native design described a conversation flow but no executable authenticated `create/turn/stream/cancel/reconnect` endpoint contract, session/turn IDs, idempotency, or durable cursor. Evidence: `apps/control-plane/src/server.ts:358-834` has no conversation route; `apps/cli/src/tui/commands/registry.ts:5-39` has no model/chat/send path.
- **Critical:** `ModelProviderPort.turn()` lacked normalized tool-call, tool-result, turn budget, duplicate/replay, abort, and streaming contracts. Evidence: `plan/specs/2026-09-07-maestro-native-agent-backend-design.md` only defined `turn/cancel/close`; `packages/domain/src/execution-kernel.ts:95-106` has no tool-dispatch method.
- **Critical:** Host-side authority delegation was underspecified. Model output must never carry the operator bearer or approve-and-run authority. Critical approval must bind to exact args, command, project/Goal, expiry, and human confirmation. Evidence: `apps/control-plane/src/server.ts:694-713` and `packages/authority/src/authority.ts:185-243`.
- **Critical:** Child-agent behavior, capability narrowing, budget/depth ceilings, cancellation cascade, and durable parent/child bindings were not executable contracts. Existing child behavior is Prime-specific at `packages/prime-adapter/src/execution-kernel.ts:156-167,235-244`.
- **Critical:** Model authorization is incomplete beyond workers. `approvedModels` is not canonical/provider-qualified; workers omit it at `packages/persistence/src/worker.ts:209-216`; Head, semantic-review, and Encore paths also need policy propagation. Worker schema/API mapping lacks actual provider/model identity (`migrations/0024_workers.sql:7-24`, `apps/control-plane/src/worker-service.ts:30-36`).
- **High:** Result-only provider calls cannot satisfy streaming/observation acceptance; add bounded event sink and durable cursor. Also define per-session serialization, provider request-ID namespacing, and A1 unknown/fenced recovery before implementation.


## 2026-09-07 — API-key login and TUI layout implementation findings

- **Resolved:** `/model` was parsed as a command with no action in the stale compiled CLI artifact. Source and rebuilt `apps/cli/dist` now normalize it to `model list`; users must restart an already-running TUI process after rebuilding.
- **Resolved:** the logo was visually top-heavy beside the getting-started text. One leading blank artwork row and two trailing rows now center the fixed ten-row mark beside the thirteen-row copy.
- **Boundary:** provider API keys travel only from hidden TUI/TTY input to the authenticated Control Plane, then across the narrow authenticated gateway RPC. The gateway persists the encrypted/native keychain envelope and exposes only binding metadata. No API key is accepted as a command-line option.
- **Boundary:** the gateway rejects credential bind/admit requests whose operator context does not match its configured local operator. Multi-operator dynamic gateway context and signed service assertions remain future work; local bootstrap aligns fresh local operators to `local-operator`.
- **Open acceptance:** the keychain backend and live provider calls still need a host with an available OS keychain, configured gateway token, provider key, and real PostgreSQL process test.


## 2026-09-07 — Account OAuth boundary review

- **Accepted:** OpenAI account login is delegated to the documented public Codex app-server managed-login protocol. Maestro does not implement OAuth endpoints, exchange codes, handle refresh tokens, or persist provider tokens.
- **Accepted:** Codex app-server starts as a shell-free child with provider credential-like environment variables removed. Maestro sends only validated provider/model/message data and uses a read-only sandbox; Maestro tool calls are rejected until a separate authority bridge exists.
- **Blocked:** Claude Pro/Max subscription OAuth requires an official public or explicitly approved Anthropic protocol. Reusing Prime's private flow, undocumented endpoints/scopes, or the Claude CLI as a credential bridge would violate the project boundary.
- **Open:** Login request idempotency and restart-safe login session ownership still need durable records before production release.

## 2026-09-07 — Durable account-login hardening
- Account-login identity is now append-only at the database boundary; direct identity rewrites and deletes are rejected.
- Status/cancel operations use an atomic, reclaimable lease with a unique operation token so a late request cannot overwrite or release a newer claim.
- Gateway restart errors preserve a stable lost-session code, allowing Control Plane to persist terminal `unknown` truthfully.


## 2026-09-07 — Durable account-login final review and remediation

- Independent source review found three blocking defects: released/no-token operation updates could bypass per-operation fencing; migration `0065` allowed arbitrary NULL→provider identity injection; and one route test passed a provider login ID instead of the durable Maestro login ID.
- A fourth boundary issue was found: Codex provider-side unknown errors used a different message and could map to generic HTTP 400. Typed `account_login_session_unknown` mapping now preserves the stable 409 contract.
- Fixes are present but not yet committed: `updateState` now requires an exact live `(operation_owner, operation_token)` pair when fenced, or an explicitly unleased no-token update; migration `0066_harden_provider_account_login_identity.sql` provides the only provider-identity completion function and rejects direct identity transitions; tests cover stale-after-release, no-token-active, direct identity injection, durable route IDs, and typed Codex unknown errors.
- Verification: targeted gateway/control-plane tests passed 15/15; durable PostgreSQL account-login integration passed 8/8 on `postgresql://maestro@127.0.0.1:55465/maestro_test`; `npm run build` passed. `npm install --ignore-scripts` repaired stale root workspace symlinks and reported the pre-existing 3 high-severity npm audit findings.
- Current runtime/doc truth: native `MaestroAgentRuntime` serves conversations; `apps/control-plane/src/main.ts` still composes `createPrimeExecutionKernel()` for worker execution. Prime removal remains an open migration gate, not a completed phase.
