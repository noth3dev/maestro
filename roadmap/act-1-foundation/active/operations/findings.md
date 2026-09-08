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
- `docs/assets/design/design-system.html` has an unrelated pre-existing working-tree modification and is excluded from the control-plane checkpoint commit.

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
  not the single-Goal Next.js page `plan/operations/task_plan.md`'s Phase 5 Track A7 section still describes.
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
  before vitest's skip logic ever applied, in exactly the three files noted in plan/operations/findings.md's
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

- `plan/operations/task_plan.md` contains historical Phase 5 status wording that understates the current implementation. Live code confirms the broader authenticated API surface and the Electron Secretary architecture described in the later reconciliation entry.
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


## 2026-09-07 — Codex authorize URL and TUI copy finding

- A real Codex app-server 0.153.4 probe showed Maestro's previous default URL carried `originator=maestro`. The provider login endpoint returned `Invalid authorize request`; the official Codex client identity is `codex_cli_rs`. The default app-server client identity now uses that originator while keeping Maestro as the display title.
- The TUI previously opened the browser but did not retain or render the URL, leaving no reliable manual recovery path. The waiting dialog now shows the URL and advertises `Alt+C`; the action copies through a shell-free stdin boundary and reports a safe fallback when no clipboard utility exists.
- This does not claim successful account completion: the local app-server process and browser callback still require a running supported Codex installation and a real browser session.


## 2026-09-07 — Act 1 Phase 1 operational audit started

- The user directed a sequential Act 1 build: inspect and close Phase 1 first, then advance phase by phase with documentation and real acceptance evidence. A dedicated execution ledger now lives at `plan/act1-execution.md`; it does not override the phase requirement documents or root evidence ledger.
- `plan/phase1.md` still names a historical Prime-centered stack, but its current-status note explicitly treats `MaestroAgentRuntime`/`apps/model-gateway` as the conversation path and the Prime adapter as a legacy Worker bridge. The native backend plan remains the authority for removing that bridge.
- Initial source audit found Phase 1 durable Goal/command/event/lease/authority/evidence/reconciliation implementations and focused tests. `packages/persistence/src/events.ts:6-20` uses `goal_events` as replay truth; `packages/persistence/src/commands.ts:313-317` writes the transactional outbox and emits `pg_notify`. No separate outbox consumer/claim service was found in the current source tree, so outbox delivery/recovery must be verified before treating the Phase 1 transport requirement as operational.
- Initial source audit found no persisted installation or notification record/schema in `packages/persistence/migrations`; the only non-provider notification matches are UI labels and Codex JSON-RPC notifications. These are audit findings, not yet implementation decisions; scope will be confirmed against the Phase 1 exit gate before patching.
- `apps/control-plane/src/main.ts:78` still composes `createPrimeExecutionKernel()` for Worker/Head execution. This is documented as an intentional legacy bridge, not a Phase 1 conversation-runtime failure, and is governed by the native backend migration plan.
- Two unrelated worktrees remain outside this audit: `.worktrees/device-grant-expiry` now contains the independently created `239db3e fix(device-agent): persist lapsed grant closure` commit and is clean; `.worktrees/local-gateway-bootstrap` still has uncommitted TUI local-bootstrap changes. Neither worktree was edited here.
- A dedicated disposable database was started as `maestro-phase1-audit-postgres` on loopback port `55471`; readiness and the Phase 1 database suites are still pending.


## 2026-09-07 — Phase 1 baseline evidence

- Fresh no-database `npm run check` passed with 102 files / 665 tests passed and 53 files / 374 tests skipped. This is not a Phase 1 operational acceptance claim because all PostgreSQL and live-Prime gates were skipped.
- The no-database run printed three non-fatal `fatal: Needed a single revision` messages while still exiting 0. The messages come from the intentional negative `git rev-parse --verify` assertion in `packages/git-adapter/src/git-ops.test.ts:155-156`; the test passes and this is expected stderr noise, not a failed gate.
- The current workspace package manifests contain no `pino`, OpenTelemetry, or OpenAPI/Swagger dependency/source despite Phase 1's locked stack naming structured logs, traces/metrics, and one generated OpenAPI contract. This is a likely Phase 1 foundation gap, subject to the exit-gate relevance audit.


## 2026-09-07 — Phase 1 live Prime gate passed

- Live compatibility evidence is now fresh: `MAESTRO_LIVE_PRIME=1 npm test -- packages/prime-adapter/src/sdk.live.test.ts` passed 2/2. It exercised a real parent/named-child exchange and a disposable repository worker effect.
- The real SDK identity was `openai-codex/gpt-5.6-luna`. Child answer text remains an explicit provider-unavailable value for this SDK build; the adapter does not invent text.


## 2026-09-07 — Phase 1 worker restart regression closed

- The first isolated PostgreSQL failure was a `ReferenceError: projectId is not defined` in `packages/persistence/src/worker.integration.test.ts:272`, not a reconciliation implementation failure. The test called `setupBundle()` but omitted its returned `projectId` from destructuring before asserting the durable recovery report.
- Fixed the test to capture `projectId`. Focused PostgreSQL verification now passes **33/33 tests**, including the live-lease `lease_contended` restart case. `npm run build` also passes.
- The broader PostgreSQL run must be repeated after this fix; prior observed failures in Concertmaster/Git/Metronome/certification/device-agent suites remain open until independently reproduced and closed.


## 2026-09-08 — Native Prime-removal cutover plan

- The user explicitly reprioritized the work: remove Prime Agent completely and move every production execution path to the native Maestro backend before resuming the remaining Phase 1 patches.
- Current native conversation execution already uses `createMaestroAgentRuntime` and the authenticated Model Gateway. The missing production seam is the Control Plane execution-kernel composition: Worker, Head activation, semantic review, Encore reviewers, and team-lead helpers still issue Prime-era or bare `ExecutionKernelPort` requests.
- Created `plan/2026-09-08-native-prime-removal-cutover.md`. It sequences native kernel routing, explicit model/grant propagation, durable execution-binding evidence, fixed host tools, real HTTP acceptance, complete Prime deletion, then the Phase 1 PostgreSQL patch queue.
- The plan requires zero production/test dependency references to `prime-agent`, `@maestro/prime-adapter`, `createPrimeExecutionKernel`, or `primeAgentVersion`; Prime is not allowed as fallback.


## 2026-09-08 — Native execution-kernel router Task B green

- Added `apps/control-plane/src/native-execution-kernel.ts`, an authenticated gateway admission/router that binds each root execution to one immutable provider/model/account and routes opaque execution/invocation refs to the correct `MaestroAgentRuntime`. It rejects unscoped requests before gateway admission and closes a shared gateway exactly once.
- Added four focused tests covering exact model admission, opaque observation/status routing, unscoped rejection, account mismatch rejection, and shared-gateway close behavior.
- Focused native/model-gateway verification passed **7 files / 33 tests**; `npm run build` passed.
- This is only the composition seam. Production `main.ts` still uses Prime until Tasks C–G propagate explicit grants and remove the dependency.


## 2026-09-08 — Native Worker admission Task C slice

- Mission Bundle validation now rejects unqualified approved models and requires `provider/model-id`. Persistence integration fixtures were migrated from `model-a` to `test/model-a`.
- `SpawnWorkerInput` accepts an optional host-selected `model`; Worker admission deterministically selects the sole approved model when omitted, rejects an unapproved/ambiguous selection before provider spawn, and passes host-owned context, exact model policy, capability grant, time/retry limits, and command idempotency to `ExecutionKernelPort.spawn`.
- Native router account resolution remains host-owned: an omitted request account uses the configured provider account; a caller-supplied mismatch is rejected before gateway admission.
- Focused isolated PostgreSQL Worker lifecycle verification on `maestro-native-cutover-postgres:55473` passed **35/35**. Domain/contracts/native-router focused tests passed **30/30** and build passed.
- Remaining Task C work: explicit admissions for Head, semantic review, Encore, and team-lead helper paths; no Prime production cutover yet.


## 2026-09-08 — Native admission propagation and Prime composition removal

- Added the shared `ExecutionAdmission` contract. Head activation, semantic review, Encore fan-out, and team-lead helper seams now preserve host-owned context, grant, exact model policy, and idempotency fields when supplied. Encore derives unique per-reviewer idempotency keys.
- Control Plane composition now creates `createNativeExecutionKernel()` over the authenticated Model Gateway. When no gateway credential is configured it uses an explicit fail-closed unavailable kernel; it never creates or imports Prime. Host-created Head/Encore admissions require explicit `MAESTRO_NATIVE_MODEL`, provider account binding, lease fencing, and bounded read-only grants.
- Removed `primeAgentVersion` from Maestro configuration and all source fixtures.
- Evidence: Head HTTP PostgreSQL suite **2/2**, team-lead PostgreSQL suite **11/11** on disposable port `55475`, semantic review **3/3**, Encore **8/8**, config/native router **19/19**, forced TypeScript build passed.
- Remaining: delete the Prime package/dependency and lockfile references; wire durable semantic/Encore admission callers where production surfaces exist; add real Model Gateway HTTP process evidence.


## 2026-09-08 — Prime package deletion verification

- Removed `packages/prime-adapter`, its Control Plane dependency, root and app TypeScript references, and all Prime tarball entries from `package-lock.json`; `npm prune --ignore-scripts` removed the stale installed packages.
- Source/dependency scan: `git grep -in prime -- '*.ts' '*.tsx' '*.js' '*.json' '*.toml' '*.yaml' '*.yml'` is clean; `prime` is absent from `package-lock.json`; `node_modules/@maestro/prime-adapter` and `node_modules/prime-agent` are absent. Historical findings retain their original audit evidence.
- Native focused verification after deletion: 5 files / 50 tests passed; forced TypeScript build passed.
- Full real Model Gateway process acceptance is still open; no credential or provider secret was added to tests or persistence.


## 2026-09-08 — Real Model Gateway HTTP native execution evidence

- Added an acceptance test that binds a fake provider credential inside the gateway credential store, starts the actual Model Gateway Fastify server on a loopback TCP port, connects through `createModelGatewayClient`, and routes a native kernel admission through HTTP.
- The test proves exact model/account binding, host admission fields, prompt execution, terminal observation, provider identity, and kernel/gateway close. It does not use a mocked gateway transport and does not expose the credential.
- Evidence: `apps/control-plane/src/native-gateway-http.integration.test.ts` passed **1/1** after Prime package deletion.


## 2026-09-08 — Post-deletion no-database check

- `npm run check` passed: build plus **102 test files / 665 tests passed**. PostgreSQL-gated files were intentionally skipped: **52 files / 375 tests**.
- The native HTTP acceptance remained green in that run. No Prime package, import, or lockfile entry returned.


## 2026-09-08 — Explicit native model configuration

- Removed the temporary default `openai/gpt-5` from `MAESTRO_NATIVE_MODEL`. Host-created Head/Encore admissions now require an explicit provider-qualified model; omitted configuration fails closed instead of authorizing an implicit model. Config tests cover both the required qualification and absence behavior.


## 2026-09-08 — Stale disposable-container host contention masked a real device-suite migration bug

- **Symptom:** a full single-worker real-PostgreSQL rerun (all 664+ integration/unit files) failed exactly 2 suites with `Error: Connection terminated unexpectedly` from `pg-pool`: `device-agent-runtime.integration.test.ts` and `device.integration.test.ts`.
- **Root cause of the connection drop:** the host had accumulated 12 stale `maestro-*-postgres` disposable containers from earlier sessions in this same project (each session's own final rerun had started a fresh one and never removed the prior ones — exactly the pattern `docs/OPERATING_PROTOCOL.md` section C already warns about, "This project accumulated 14 stale containers once already"), plus an unrelated `supabase_*` docker-compose stack from a different task on the same host. Combined, the host had <1 GiB free RAM and was actively swapping (`free -h` showed 8.4Gi/15Gi used, 1.6Gi swap in use). This is host resource exhaustion, not a PostgreSQL/application defect — confirmed via `docker inspect` (no restarts, no OOMKilled) and `dmesg` (no OOM-killer activity), i.e., it was Docker/pg client-side connection timeouts under contention, not a crashed container.
- **Fix:** removed all 12 stale `maestro-*-postgres` containers (`docker rm -f`), leaving the unrelated stack alone. Freed available memory from ~755 MiB to ~1.4+ GiB immediately.
- **Real defect underneath, now visible once contention was removed:** `packages/persistence/src/device.integration.test.ts` applied a hand-picked, stale 3-migration subset (`0001_phase1_core.sql`, `0040_devices.sql`, `0041_device_policy_hardening.sql`) instead of `applyAllMigrations`, unlike every sibling device suite (`device-grant.integration.test.ts`, `phase4-device-live-gate.integration.test.ts`, both of which already use `applyAllMigrations`). `revokeDevice`'s cascading `UPDATE device_grants SET state = 'revoked' ...` (added for Phase 5 Track B4, cascade-revoke device grants on device revocation) then failed with `relation "device_grants" does not exist` because migration `0046_device_grants.sql` was never in that hand-picked list.
- **Fix:** switched `device.integration.test.ts`'s `beforeAll` to `applyAllMigrations(pool)`, matching its siblings, so a later migration adding a cross-table dependency inside `device.ts` cannot silently desync this one suite's schema again. Reran all 4 device-related suites together on a fresh container: **29/29 passed**.
- **Lesson:** when the same real bug is masked by an intermittent-looking connection error, check host resource pressure (`docker ps -a`, `free -h`, `docker inspect --format '{{.State.OOMKilled}}'`) before assuming flakiness; and prefer `applyAllMigrations` over a hand-maintained migration subset in any new integration suite, since a hand-picked list silently drifts as soon as the code under test grows a dependency on a later migration.


## 2026-09-08 — Real Model Gateway wire schema overflow for any multi-hour Mission Bundle time ceiling

- **How it was found:** while building the new "full Control Plane + PostgreSQL + real Model Gateway Worker acceptance" test (`apps/control-plane/src/native-worker-acceptance.integration.test.ts`), a real native Worker admission through an actual Model Gateway HTTP process durably ended in `status: "unknown"` with no useful diagnostic (`answer_text: null`), even though the Head activation immediately before it succeeded with the same gateway/account. Every fake-injected-`ExecutionKernelPort` test in the suite (the vast majority of this project's native-path coverage) never exercises the real Model Gateway wire schema at all, so this defect was invisible everywhere except a true end-to-end HTTP acceptance test.
- **Root cause:** `packages/agent-runtime/src/agent-runtime.ts`'s `limitsFor()` set `providerTimeoutMs: Math.max(1, grant.remaining.wallTimeMs)` -- i.e. it directly reused the invocation's overall wall-time budget as the per-provider-call timeout, with no ceiling. `apps/model-gateway/src/rpc.ts`'s real wire schema (`TurnSchema`) caps `providerTimeoutMs` at `600_000` (10 minutes) and `wallTimeMs` at `3_600_000` (1 hour). `packages/persistence/src/worker.ts`'s `missionTimeLimitMs()` accepts a Mission Bundle `timeCeiling` up to any `Number.isSafeInteger` value (days are an explicitly supported unit), so any real Mission Bundle with a `timeCeiling` over 10 minutes -- which is the overwhelmingly common case; this project's own fixtures throughout the codebase use `"1 hour"`, `"1 day"`, `"3 days"` -- produced a `grant.remaining.wallTimeMs` that failed the gateway's own schema validation on every single real turn. The gateway rejected the request with the generic `"invalid model turn request"`, which the native runtime durably records as an ambiguous `"unknown"` outcome, with zero indication that the real cause is a wire-schema numeric ceiling on an unrelated-looking field.
- **Why it stayed hidden:** `providerTimeoutMs`/`wallTimeMs` are validated by the wire schema but never actually read/enforced server-side by the gateway or any provider plugin (`packages/model-provider-openai`, `packages/model-provider-anthropic`) -- they are pure pass-through fields today. Every existing test that constructs a `TurnLimits` object directly (unit tests, injected fake kernels) used small hand-picked values well under both ceilings, so nothing before this session's real HTTP acceptance test ever sent an actual out-of-range value through real schema validation.
- **Fix:** `limitsFor()` now clamps both values defensively: `wallTimeMs = min(max(1, grant.remaining.wallTimeMs), 3_600_000)`, `providerTimeoutMs = min(wallTimeMs, 600_000)`. This does not change any currently-enforced behavior (neither field is read server-side yet) and remains forward-compatible if/when real per-call timeout enforcement is added later, since a value already clamped to the wire schema's own stated ceiling is always valid. The actual multi-day Mission Bundle time-ceiling boundary continues to be enforced entirely at the persistence layer (Goal lease expiry, worker heartbeat/lease, Metronome staleness detection), which never depended on this wire field.
- **Regression test:** `packages/agent-runtime/src/agent-runtime.test.ts` — "bounds providerTimeoutMs and wallTimeMs to the real Model Gateway wire schema even for a multi-day Mission Bundle time ceiling" — spawns with a 3-day `wallTimeMs` grant and asserts the values a fake gateway actually receives are ≤ the real wire ceilings, and that the turn still succeeds.
- **Evidence:** `packages/agent-runtime/src/agent-runtime.test.ts` 8/8 (was 7/7); the new `apps/control-plane/src/native-worker-acceptance.integration.test.ts` 1/1 real-PostgreSQL/real-gateway acceptance test now passes end to end (Head activation, Council, Department Plan, Mission Bundle, real native Worker admission, durable `native_execution_bindings` evidence for both admissions, real gateway-returned answer text, no credential/token leakage); broader regression sweep across agent-runtime, native-execution-kernel, native-gateway-http, head-participation-api, conversation-service, worker, semantic-review, encore-council, team-lead-grant, both model-provider packages, and the Model Gateway app: 18 files / 113 tests, 0 failed.


## 2026-09-08 — Extended the wire-schema clamp fix to every domain-derived turn limit

- After fixing the `providerTimeoutMs`/`wallTimeMs` overflow (previous entry, same date), audited every other field `limitsFor()` sends to the real Model Gateway wire schema (`apps/model-gateway/src/rpc.ts`'s `LimitsSchema`) for the same class of defect: a domain-derived value with no upper bound reaching a schema-validated boundary with a hard cap.
- Found the same defect shape in two more fields: `maxToolCalls` (schema cap 1,000) is derived from `Math.max(1, bundle.substance.allowedTools.length * 8)`, and `maxChildCalls` (schema cap 100) is derived from `bundle.substance.workerCeiling` directly -- and `packages/domain/src/mission-bundle.ts`'s `assertValidMissionBundleSubstance` bounds neither `allowedTools.length` nor `workerCeiling` from above (only `nonnegativeInt`, no ceiling). A Mission Bundle with more than 125 allowed tools, or a Head bundle with `workerCeiling` over 100, would hit the exact same "invalid model turn request" / durable `"unknown"` failure as the time-ceiling defect, through a real gateway.
- **Fix:** extended the same defensive clamp in `limitsFor()` to all four bounded fields (`maxModelTurns`, `maxToolCalls`, `maxChildCalls`, `maxOutputTokens`), each clamped to its exact real wire-schema ceiling, alongside the already-fixed `providerTimeoutMs`/`wallTimeMs`. This does not change any local grant-based enforcement (`executeTurn` checks `record.grant.remaining.*` directly, not the clamped wire payload) and does not change Mission Bundle domain validation; it only prevents an oversized domain value from ever reaching the wire boundary unclamped.
- **Regression test:** extended `packages/agent-runtime/src/agent-runtime.test.ts`'s existing regression test into "bounds every wire-validated turn limit to the real Model Gateway schema for an oversized domain grant", asserting all six `TurnLimits` fields sent to a fake gateway stay within the real schema's bounds even when the grant supplies `modelTurns: 500`, `toolCalls: 5_000`, `childCalls: 500`, `outputTokens: 5_000_000`, `wallTimeMs: 3 days`.
- **Evidence:** agent-runtime 8/8; broader regression sweep (agent-runtime, native-execution-kernel, native-gateway-http, native-worker-acceptance, head-participation-api, conversation-service, worker, semantic-review, encore-council, team-lead-grant, both model providers, Model Gateway app) 18 files / 113 tests, 0 failed; full clean single-worker real-PostgreSQL rerun in progress to confirm no regression across the whole suite.


## 2026-09-08 — Long real conversations would silently break: unbounded messages/tools array vs. the gateway's 128-entry wire cap

- After fixing the numeric `LimitsSchema` fields, continued the same wire-schema audit into `apps/model-gateway/src/rpc.ts`'s `TurnSchema` array bounds: `messages: z.array(z.unknown()).max(128)` and `tools: z.array(z.unknown()).max(128)`.
- **Root cause:** `packages/agent-runtime/src/agent-runtime.ts`'s `boundedMessages()` (used both for a fresh root's `initialMessages` and for every subsequent turn's `record.messages`) only bounds the outgoing array by cumulative byte size (64,000 bytes); it never bounds the number of array entries. `apps/control-plane/src/conversation-service.ts`'s `rebuildRuntime()` replays every durable `conversation_turns` row for a conversation with no row-count limit. A real, ordinary conversation with more than 128 short exchanges -- entirely plausible; well under the 64KB byte budget -- produces a `messages` array that fails the gateway's real wire schema with the same opaque `"invalid model turn request"` this whole audit keeps finding, permanently breaking that conversation's every subsequent turn. The `tools` array has the identical latent risk once any host tool is ever registered (`ToolRegistry` is currently always empty in production, so this half was not yet reachable, but was fixed defensively at the same time).
- **Fix:** `boundedMessages()` now also stops once `kept.length` reaches the wire cap (128), keeping its existing most-recent-first packing order; the turn call additionally slices `tools.definitions(...)` to the same 128-entry cap before sending it.
- **Regression test:** `packages/agent-runtime/src/agent-runtime.test.ts` -- "bounds the wire messages array to 128 entries for a long conversation well under the byte budget" -- spawns with 200 short initial messages (well under the byte budget) and asserts the fake gateway receives ≤128 messages and the turn still succeeds. Verified this test genuinely reproduces the defect: reverting the fix locally made it fail (`received 200`), confirming it is not a false-positive assertion.
- **Evidence:** agent-runtime 9/9; regression sweep (agent-runtime, native-execution-kernel, native-gateway-http, native-worker-acceptance, head-participation-api, conversation-service, worker, semantic-review, encore-council, team-lead-grant, both model providers, Model Gateway app) 18 files / 114 tests, 0 failed; full clean single-worker real-PostgreSQL rerun in progress to confirm no regression across the whole suite.
- **Pattern now established across three fixes this session:** any domain-derived value (Mission Bundle `timeCeiling`/`allowedTools`/`workerCeiling`, or an ordinary conversation's accumulated turn history) that reaches the real Model Gateway wire boundary must be defensively bounded to that boundary's actual schema, because nothing at the domain layer bounds these values from above and every fake-injected-kernel test in the suite bypasses real wire validation entirely.


## 2026-09-08 — Real subprocess test for Codex's StdioTransport found two more real defects

- Continued the "make it truly work, not a shell" audit into a different class of untested boundary: `packages/model-provider-openai/src/codex-app-server.ts`'s `StdioTransport` (real `child_process.spawn` + JSONL stdin/stdout framing). Every existing test for `CodexAppServerClient` used `options.transport` (a pure in-memory object fake); `StdioTransport` itself -- process spawn, environment redaction, JSONL parsing, exit/error handling -- had zero test coverage exercising it as a genuine OS process boundary. The real `codex` binary is not installable in this sandbox (`Missing optional dependency @openai/codex-linux-x64`), so a new fixture-based real-process test was added instead: `packages/model-provider-openai/test/fake-codex-app-server.mjs`, a tiny real Node.js child process speaking the exact same JSON-RPC-over-JSONL wire protocol, driven by a new `packages/model-provider-openai/src/codex-stdio-transport.test.ts` spawning it as a genuine subprocess (not the real Codex model, but a real OS process boundary for Maestro's own transport code).
- **Real defect #1 (confirmed a fix, not just a passing test):** `redactChildEnvironment()`'s pattern is correct, but the first test attempt used a probe variable name (`MAESTRO_TEST_SECRET_PROBE`) that does not match its `(?:API_KEY|...)$` suffix pattern -- a test-authoring mistake, not a product bug. Corrected to the realistic `OPENAI_API_KEY` (which the pattern is explicitly designed to catch) and reverified the real child process genuinely never receives it (the fixture echoes back `"REDACTED"` rather than the real value it would report if the redaction failed).
- **Real defect #2 (genuine product bug):** a real process crash (`child.once("exit", ...)`) surfaced two different error messages depending on request timing: already-pending requests were rejected with the raw `"Codex app-server exited (1)"`, while `this.transportError` (used for later requests) was a differently-worded plain `Error("Codex app-server is unavailable")`. Neither wording matched `apps/model-gateway/src/rpc.ts`'s `errorCode()` message-substring checks (`"closed"`/`"transport"`), which were written for the HTTP-based OpenAI/Anthropic providers' own wording (`"...transport failed"`). A genuine Codex app-server crash therefore fell through to the generic `400 invalid_gateway_request` ("model gateway request is invalid") instead of the correct `503 provider_unavailable` -- misclassifying a provider outage as a malformed client request.
- **Fix:** normalized both the pending-request rejection and `this.transportError` to the same typed `CodexAppServerError("provider_unavailable", "Codex app-server is unavailable")`, matching the exact same `.code` convention `OpenAiProviderError`/`AnthropicProviderError` already use. Added a `code === "provider_unavailable"` branch to `errorCode()` ahead of the fragile message-substring checks, so any provider's structured `provider_unavailable` code maps to 503 reliably regardless of wording -- this also makes the fix general across all three provider plugins, not Codex-specific.
- **Verified genuine reproduction (not a false-positive test) for both fixes:** reverted each fix locally, reran the corresponding test, confirmed it failed with the exact pre-fix symptom, then reapplied the fix and confirmed it passed.
- **Evidence:** `packages/model-provider-openai/src/codex-stdio-transport.test.ts` 2/2 (real subprocess); `apps/model-gateway/src/rpc.test.ts` 7/7 (new `provider_unavailable` mapping case included); broader regression sweep (agent-runtime, model providers, Model Gateway app, native-execution-kernel, native-gateway-http, native-worker-acceptance, head-participation-api, conversation-service, worker, semantic-review, encore-council, team-lead-grant) 19 files / 117 tests, 0 failed; full clean single-worker real-PostgreSQL rerun in progress to confirm no regression across the whole suite.


## 2026-09-08 — Real-HTTP-server coverage added for OpenAI/Anthropic providers (no defect found; closes a real coverage gap)

- Continued the transport-boundary audit into the HTTP-based provider plugins: `packages/model-provider-openai/src/provider.test.ts` and `packages/model-provider-anthropic/src/provider.test.ts` both used a hand-rolled `Response` object returned synchronously from a `vi.fn()` mock, never a real socket. This meant the actual `fetch()` call -- header serialization, JSON body framing over the wire, and (most importantly) whether `AbortController.abort()` genuinely tears down a real in-flight TCP connection versus just synchronously rejecting a mock -- had zero real-process coverage, the same class of gap the Codex `StdioTransport` audit found.
- Added `packages/model-provider-openai/src/provider.real-http.test.ts` and `packages/model-provider-anthropic/src/provider.real-http.test.ts`, each spinning up a real `node:http` server on a loopback TCP port. Each proves two things against the real network boundary: (1) a normal turn genuinely round-trips real HTTP headers/JSON body and parses a real HTTP response, and (2) calling `provider.cancel(requestId)` genuinely aborts the real in-flight connection -- verified from the *server side* via `req.on("close", ...)`, not merely by observing the client-side promise reject.
- **Result: both providers passed on the first real-process run.** This is a genuine, verified negative result, not an assumption: it confirms `AbortSignal.any([request.signal, controller.signal])` combined with `fetchImpl(..., { signal })` really does terminate the underlying connection for both providers, closing a real coverage gap without needing a corresponding code fix this time.
- **Evidence:** 4 new tests (2 per provider), both packages' full suites 6 files / 16 tests, 0 failed; broader regression sweep (agent-runtime, both model providers, Model Gateway app, native-execution-kernel, native-gateway-http, native-worker-acceptance, head-participation-api, conversation-service, worker) 18 files / 96 tests, 0 failed; full clean single-worker real-PostgreSQL rerun in progress to confirm no regression across the whole suite.


## 2026-09-08 — Critical: real HTTP account-login/credential-bind acceptance test found the session's most severe bug

- Continued the audit into the account-login/credential-bind flow (`/v1/provider-account-logins/*`, `/v1/provider-credentials`), a real end-to-end user-facing feature with no prior real-stack coverage: `apps/control-plane/src/provider-credential-route.test.ts` injects a fake `providerCredentials` object directly, bypassing the real `ModelGateway`'s own authorization logic entirely -- exactly the same systemic blind spot every prior finding this session traced back to.
- Added `apps/control-plane/src/account-login-acceptance.integration.test.ts`: a real Control Plane HTTP server (`createControlPlane`, no injected overrides) wired to a real Model Gateway HTTP process (with a real `CodexAppServerClient` over an in-memory transport, matching `codex-app-server.test.ts`'s established fixture pattern) and real PostgreSQL, driving `/v1/provider-account-logins/start` -> `/status` (pending) -> a simulated real OAuth completion notification -> `/status` (succeeded), plus `/v1/provider-credentials` (API key bind).
- **Root cause of the failure this test immediately hit:** `ModelGateway.bindCredential`/`revokeCredential`/`startAccountLogin`/`accountLoginStatus`/`cancelAccountLogin`/`logoutAccount` each strictly check `request.operatorId !== this.options.operatorId` and throw `"credential operator context mismatch"` on any inequality -- by design, since the gateway process authenticates one fixed gateway-level operator identity (`config.modelGatewayOperatorId`, defaulting to `"local-operator"`), exactly matching how native admission already calls `gateway.admit()` with that same fixed constant (`apps/control-plane/src/native-execution-kernel.ts`), never the calling end-user's own operator UUID. `apps/control-plane/src/main.ts`'s composition for the six credential/account-login gateway calls instead forwarded the *real authenticated end-user's* `operatorId` straight through unmodified (taken from `requestOperator(request).operatorId` inside `server.ts`'s route handlers), which can never equal the fixed gateway-operator constant in any real multi-operator deployment. **Every real credential bind and every real ChatGPT account login through the authenticated Control Plane API was completely broken** -- not an edge case, but the ordinary first-time-setup path any real operator must use before any provider can be used at all. It was invisible because every existing test for this surface mocked `providerCredentials` directly rather than exercising the real `ModelGateway`'s operatorId check.
- **Fix:** in `main.ts`'s composition, all six gateway-facing calls now override `operatorId` with `config.modelGatewayOperatorId` before calling the gateway, while every durable-store call (`accountLoginStore.reserveStart/get/claimOperation/...`) continues to use the real end-user's operatorId untouched -- this preserves Maestro's own per-operator durable isolation/audit trail (which is the correct place for that boundary) while fixing the gateway-facing identity to match what the gateway process itself was actually configured with.
- **Verified genuine reproduction:** reverted the fix, reran the acceptance test, confirmed the exact pre-fix `503 credential operator context mismatch` failure; reapplied the fix and confirmed success end to end, including a durable PostgreSQL row with the correct `pending` -> `succeeded` state transition, and the real HTTP responses/durable table columns containing no token, secret, or credential material.
- **Evidence:** new acceptance test 1/1; broader regression sweep (account-login acceptance, provider-credential-route unit tests, native-worker-acceptance, head-participation-api, conversation-service, native-execution-kernel, native-gateway-http, config, server, Model Gateway app, agent-runtime) 15 files / 115 tests, 0 failed; full clean single-worker real-PostgreSQL rerun in progress to confirm no regression across the whole suite.
- **Pattern confirmation:** this is the fifth real, previously-hidden defect this session traced to the identical root pattern -- every fake-injected test bypasses a real authority/schema/process boundary that the actual production composition never gets to exercise until a genuine end-to-end test forces the real path.


## 2026-09-08 — Real Discord signal delivery acceptance test (no product defect; two test-authoring mistakes caught and fixed)

- Continued the audit into `apps/discord/src/main.ts`'s `createHttpDelivery` (a real `fetch` POST to the Control Plane's `/v1/discord/signals` route) -- exercised only by an in-memory `fetchStub` mock in every existing test (`discord.test.ts`), never against a real listening Control Plane process, PostgreSQL, and the real dual-auth boundary (standard operator Bearer auth for the route itself, plus the signal's own embedded HMAC signature checked separately against `discordSignalCredential`).
- Added `apps/control-plane/src/discord-signal-acceptance.integration.test.ts`: a real `createControlPlane` HTTP server with `discordSignalCredential` configured and real PostgreSQL, sending a request matching `createHttpDelivery`'s exact shape (Bearer operator credential + JSON body), then a deliberately tampered copy of the same signed envelope to confirm the signature check still fails closed over the real path.
- **No product defect found this time** -- both the accept and the tamper-rejection paths worked correctly on the real HTTP boundary. Caught and fixed two of the test author's own mistakes before concluding that: (1) the fixture's `firstObservedAt`/`lastObservedAt`/`sourceFreshness` were copied from a different test file's hardcoded historical date, which fails `assertFreshAtReceipt`'s real wall-clock freshness check by default (`recordDiscordSignal`'s `options.now` defaults to `Date.now()`) -- fixed to real "now"-relative timestamps, matching `apps/discord/src/live-gate.integration.test.ts`'s existing pattern; (2) `discord_signals.sequence` is a PostgreSQL bigint/numeric column the `pg` driver returns as a string by default, not a JS number -- fixed the query to cast `sequence::int`.
- **Evidence:** new acceptance test 1/1; broader regression sweep (discord-signal-acceptance, account-login-acceptance, native-worker-acceptance, server, apps/discord unit + live-gate, persistence discord/discord-incident/discord-incident-workflow) 9 files / 73 tests, 0 failed; full clean single-worker real-PostgreSQL rerun in progress to confirm no regression across the whole suite.
- This is the second consecutive genuine negative result this session (after the OpenAI/Anthropic real-HTTP-abort tests): a real end-to-end test that increases confidence without needing a corresponding product fix, closing a real coverage gap rather than manufacturing a fix where none was needed.


## 2026-09-08 — Real Metronome continuous-observation loop acceptance test (no product defect; one test setup mistake)

- Continued the audit into `apps/control-plane/src/metronome-loop.ts` (the scheduled continuous Metronome scan): every existing test in `metronome-loop.test.ts` injects a fake `withGoalLease`/`scanGoal`/`pool` triple, so the loop's own real-PostgreSQL multi-Goal query, real Goal-lease acquisition/release across a full pass, and the terminal-vs-non-terminal state filter had never been exercised together against a real database.
- Added `apps/control-plane/src/metronome-loop.integration.test.ts`: real PostgreSQL, the real `createDurableGoalService`'s `withGoalLease` (the exact same composition `apps/control-plane/src/main.ts` uses, no injected seam), and the loop's default real `scanGoalForMetronomeFindings`. Seeds one `active`, one `paused`, and one `stopped` (terminal) Goal, runs `loop.runOnce()` twice in a row, and asserts only the two non-terminal Goals are ever scanned, the terminal Goal is never touched, no findings are fabricated for routine Goals, and a real lease acquired on the first pass does not block the identical Goal's lease on the very next pass (proving the loop releases what it acquires).
- **No product defect found** -- the loop's real multi-Goal orchestration, lease lifecycle, and state filtering all worked correctly on the first genuinely correct run. One test-setup mistake was caught and fixed first: the fixture never called `bootstrapPermanentOrganization(pool)`, so the real `scanGoalForMetronomeFindings` call correctly rejected the scan with `"Actor is not the canonical permanent Metronome role"` (the canonical Metronome role did not exist yet) -- not a loop bug, a missing fixture step every other Metronome-adjacent test already includes.
- **Evidence:** new test 1/1; `metronome-loop.test.ts` unit suite unaffected (4/4); full clean single-worker real-PostgreSQL rerun in progress to confirm no regression across the whole suite.
- Third consecutive genuine negative result this session (after the OpenAI/Anthropic real-HTTP-abort tests and the Discord signal delivery test): closes a real coverage gap on a background scheduler that runs continuously in production, without needing a corresponding product fix.


## 2026-09-08 — Real Encore Council acceptance through the Model Gateway (no product defect; two fixture mistakes caught)

- Continued the boundary audit into `apps/control-plane/src/encore-service.ts` and `runEncoreCouncilReview`: existing Encore tests exercised the service through injected kernels, but did not prove that two reviewer admissions reached the actual Model Gateway HTTP boundary or that each admission left durable native-binding evidence.
- Added `apps/control-plane/src/encore-acceptance.integration.test.ts`. It drives a real Control Plane HTTP server, a real loopback Model Gateway HTTP server, and disposable PostgreSQL. The test creates a Goal through the real HTTP lifecycle (`draft` → `ready_for_confirmation` → `launched` → `active`), inserts evidence after the Goal exists, submits a two-reviewer Encore request, verifies both reviewer judgments, and checks both durable `native_execution_bindings` rows.
- The gateway has one configured synthetic provider model (`test/model-a`), so the acceptance deliberately verifies the honest `sameModelOnly: true` result rather than pretending the round has model diversity. Provider credentials remain gateway-local; the durable binding rows contain selected/actual model identities and account reference but no credential material.
- **No product defect found.** Two test-fixture mistakes were caught and fixed before the conclusion: (1) the initial fixture granted project membership but not the required `concertmaster` project role, correctly producing the real fail-closed 503 durable-store response; (2) a raw `active` Goal inserted before `createControlPlane().listen()` was correctly changed to `recovering` by startup reconciliation because its lifecycle/lease history was unverifiable. The final fixture uses the real HTTP lifecycle and role authorization.
- **Evidence:** build passed; lint passed; focused regression sweep of Encore, native Worker, account-login, and Metronome acceptance files passed 4 files / 4 tests; full clean single-worker PostgreSQL rerun pending.

## 2026-09-08 — Production unsafe-cast cleanup and typed TUI boundaries

- Replaced production `as never`, `as unknown as`, and `as Parameters<...>` assertions in the execution-kernel, Goal, sealed-submission, persistence, environment-adapter, Control Plane HTTPS, and TUI write-command paths.
- Added `toExecutionRef`/`toInvocationRef` opaque-reference constructors and `isGoalState`; these keep boundary data typed without pretending arbitrary persisted strings or JSON are already domain values.
- TUI JSON inputs now use the existing `@maestro/contracts` schemas for conditional certification, worker spawn, Encore review, and Task Contract intake. Invalid payloads are rejected before any client method is called. Added a regression test for malformed worker JSON.
- Preserved sealed-submission compatibility for generic contract content by adding a typed `taskContractContentHash` overload instead of incorrectly applying the full Task Contract validator to partial sealed content.
- **Evidence:** TypeScript AST/lint audit reports zero explicit `any`; production source has zero `as unknown as`, zero `as Parameters<...>`, and no executable `as never`. `npm run build` and `npm run lint` passed. Focused domain/adapter/Control Plane/CLI sweep passed 6 files / 99 tests. Fresh PostgreSQL worker/council rerun passed 2 files / 56 tests; the earlier attempt was started before `pg_isready` and was correctly treated as environmental setup failure, not product evidence.


## 2026-09-08 — Documentation parity audit findings

Two independent read-only audits found documentation drift that could misroute future implementation:

1. **Runtime truth:** active plans and architecture pages still named the removed Prime worker bridge, `createPrimeExecutionKernel`, or a legacy worker composition. Current production composition is native `ExecutionKernelPort` → authenticated Model Gateway; the gateway is absent => fail closed.
2. **Workspace truth:** phase/docs maps named nonexistent `apps/secretary-office`, `packages/git-ops`, `packages/orchestration`, `packages/persona`, `packages/observability`, and `packages/test-harness`, and omitted live `apps/device-agent`, `packages/device-agent`, and `packages/environment-adapter`.
3. **Operator commands:** README and guides advertised nonexistent CLI reads (`council round`, `certification get`, `report get`). They now use the implemented `metronome-challenges list`, `encore-council list`, `certifications list`, and `concertmaster-report get` forms with project/Goal context.
4. **Permission/tool truth:** the authority matrix now lists the ordinary Git/browser actions actually classified in `packages/authority`, required request identity fields, Mission Bundle scope dimensions, and the empty production native ToolRegistry boundary. This prevents design prose from implying shell/file tools exist.
5. **Process launch truth:** device-agent JSON configuration and Discord buffer/signing/delivery variables are documented in their READMEs and the operations guide. Provider credentials remain gateway-owned.
6. **Phase/status truth:** roadmap and plan pointers now distinguish code/test evidence from release acceptance. Phase 4 has real process evidence; independent review/production deployment acceptance remains. Phase 1's only product-scoped technical gap is host-tool registration/enforcement.

No source behavior was changed in this documentation slice. The audit did not authorize adding a production host tool, permission, filesystem scope, or network scope.


## 2026-09-08 — Roadmap directory reorganization
- Renamed the tracked planning root from `plan/` to `roadmap/`.
- Grouped Act 1 phases 1–10, active implementation plans, design specs, archive material, and live operations records under `roadmap/act-1-foundation/`.
- Split the former combined post-Phase 8 architecture note into Act 1 Phase 9/10, Act 2 Flashmob, and Act 3 Arrangement entry documents.
- Updated live source, test, documentation, and operating-protocol references to canonical `roadmap/` paths.
- Preserved append-only historical logs, legacy archive text, and already-versioned SQL migration provenance without rewriting their old path strings.


## 2026-09-08 — Roadmap reorganization verification
- `npm run build` passed.
- `npm test -- --reporter=dot` passed: 105 files passed, 57 skipped; 677 tests passed, 381 skipped.
- `npm run lint` passed.
- Markdown relative-link and canonical roadmap-target scans passed.
- `git diff --check` passed.
- Repository-wide `npm run format:check` remains red because the existing tree reports 402 formatted-file warnings; the six newly authored index/Act files were formatted separately.

## 2026-09-08 — Documentation reconciliation findings

- The repository has native runtime, PostgreSQL, authority, and process evidence, but production `ToolRegistry` remains empty and grants still use `allowedTools: []` / `toolCalls: 0`; therefore workers remain text/evidence-only until the host-tool contract lands.
- The agreed first host-tool surface is a single persistent IPython tool with session-local Python functions and explicit project-skill saving. It must execute through existing authority-backed adapters rather than raw filesystem, shell, Git, network, or provider effects.
- Approval is hierarchical and whole-block: independent execution, active Department Head, Encore Council, then user. Scope includes exact code/effect identity, target, Goal, expiry, repetition budget, and selected full-access mode. A mixed-risk block cannot partially execute.
- Full access is user-enabled per session and has two modes: retain the intermediate hierarchy or skip intermediate Head/Encore approvals. It does not bypass `forbidden` actions, session isolation, audit, budgets, stop controls, or individually activated Phase 4 external capabilities.
- Phase placement is now explicit: Phase 2 local IPython/authority contract; Phase 3 release and approval-flow certification; Phase 4 browser/device/external-service/deployment activation; Phase 6 evidence-driven learning only; Phase 8 security/recovery/rollback hardening.
- Historical `accepted` and `code complete` entries remain append-only evidence and are not current acceptance. The current source of truth is the canonical status block at the top of `task_plan.md`, the Phase status blocks, and the roadmap status copies.
- Documentation-slice verification passed: build/tests and lint are green, `git diff --check` is clean, and all tracked Markdown relative links resolve. Repository-wide Prettier still reports the pre-existing formatting baseline (394 files).

## 2026-09-08 — Phase 7 client alignment

- `apps/secretary/package.json` and `electron/main.ts` confirm the current client is Electron + Vite + React 19 with a main-process credential/API boundary and sandboxed, context-isolated renderer.
- Product decision: retain that desktop app. The Phase 7 Next.js/Tailwind/shadcn/PWA/“Do not add Electron” wording was roadmap drift and is now superseded, not an active migration plan.
- The current Phase 7 contract keeps the radial UI goal while deferring `@xyflow/react` and `d3-hierarchy` dependency adoption until the graph slice is implemented and verified.

## 2026-09-08 — CI package-entry failure root cause

- The GitHub Actions failure was environmental, not a new package-export defect. The workflow built only in the independent `static` job, then created a fresh runner for `test`. Because packages such as `@maestro/domain`, `@maestro/persistence`, and `@maestro/agent-runtime` export `dist` entrypoints, `npm test` on the fresh test runner produced Vite `Failed to resolve entry for package` errors.
- The four `apps/cli/src/tui/local-bootstrap.test.ts` failures confirmed the same boundary: without the test-job build, `resolveControlPlaneEntry` and `resolveModelGatewayEntry` could not find generated executables and returned `setup-required`.
- The smallest root-cause fix is to build in the test job after dependency installation. No package export, source implementation, or test behavior was changed.
- Post-fix evidence: build-backed bootstrap and representative PostgreSQL tests passed; full no-database Vitest passed with the expected database skips; lint and diff checks passed. A complete local PostgreSQL run exceeded the bounded five-minute verification command and is therefore not reported as green.


## 2026-09-08 — Approved Phase 1A–1D host-tool execution plan

The user approved the documented placement before implementation. The canonical detailed plan is inserted into `roadmap/act-1-foundation/active/operations/task_plan.md`; Phase 1 records only the minimum registry/strict-read-only gate, Phase 2 records the persistent local IPython contract and ownership, `findings.md` remains append-only evidence, `progress.md` records execution results, and `roadmap/README.md` remains a short status summary.

The implementation is split into four gates: (1A) typed `ipython` registration, host-owned identity, persistent session queue, and strict read-only lifecycle; (1B) Node-owned JSON-lines bridge and read-only host effects; (1C) authority-backed local effects, whole-block approval, repetition/full-access modes, audit, idempotency, and stop; (1D) Control Plane/Gateway/Worker integration and real PostgreSQL acceptance. Prime Agent is a structural benchmark only. No Prime code or dependency is being copied.

No source implementation has been changed by this planning checkpoint. The only pre-existing user-owned working-tree change remains `.gitignore`.


## 2026-09-08 — Independent Prime benchmark addendum

A read-only comparison against Prime Agent `9c8230df67b378aaedc032f90e1ae8ba687cfe4` confirmed the useful structural pattern: TypeScript owns the persistent `ReplKernelManager`, serialized cell queue, JSON-lines protocol, typed host-request dispatch, cancellation, bounded shutdown, output attribution, and lifecycle accounting; the child Python runtime owns only session-local code execution (`packages/coding-agent/docs/rlm-runtime.md:8-21,62-72`; `packages/coding-agent/src/core/kernel/repl-manager.ts:1-40`).

Prime's protocol documents handshake, frame separation, ordered requests, host replies, interruption, and shutdown (`prime-agent-runtime/src/rlm/repl.md:1-41,47-123`). Its tests provide the required shape for real child-process coverage: execution/host bridge, namespace state roundtrip, abort, teardown, and parent watchdog. Maestro will copy these test categories, not Prime's authority model.

Explicitly excluded from the Maestro design: arbitrary Python evaluation as authorization, `bash()` as a permission model, child-process isolation as a security boundary, generic string host handlers, detached effectful background tasks, and dill/pickle namespace restore. Maestro host effects remain Control Plane-owned, typed, Goal-scoped, lease/fence/approval/idempotency checked, and routed through existing adapters.

The plan now explicitly includes out-of-band host replies, busy-kernel/cancellation behavior, bounded teardown, output attribution, project-skill manifest/hash/save/revocation, IPython-specific crash/restart recovery, and Phase 3/8 protocol/snapshot/prompt-injection/full-access security cases.


## 2026-09-08 — Prime parent-death cleanup addendum

The benchmark review found one additional lifecycle requirement: Prime passes a parent identity to the child, the Python watchdog exits when the owner dies, and the manager journals/reaps owned process groups (`packages/coding-agent/src/core/kernel/repl-manager.ts:315-328,1282-1317`; `prime-agent-runtime/src/rlm/repl.py:1061-1125`). Maestro must add the equivalent parent-death/orphan-reaping contract and prove that no shell/test child survives a Control Plane crash. This belongs in the Phase 2 lifecycle tests and the Phase 8 termination-injection gate.


## 2026-09-08 — 1A static review corrections

The independent benchmark review checked the new 1A slice before it was treated as complete. The session manager initially shared one kernel across Goal sessions, used delimiter-based session IDs, and returned unbounded/unclassified content. The implementation was corrected to require a per-session kernel factory, encode session identity as canonical JSON, require a structured data-class result envelope, enforce the invocation's outbound data-class grant, and bound returned UTF-8 output to 64,000 bytes.

The review also confirmed what remains intentionally open: real child-process protocol/host requests, progress events or explicit final-only timeout semantics, authority-backed adapters, namespace snapshots, project-skill manifests, parent-death cleanup, and restart acceptance. The production registration is therefore fail-closed and not a Phase 1/2 acceptance claim.


## 2026-09-08 — Prime harness scope/persistence reference

Prime's harness separates session-local and explicit global state and validates skill references before saving (`prime-agent-runtime/src/rlm/harness.py:1-8,131-141,607-631`). It writes schema-tagged state atomically with restrictive file modes (`harness.py:287-319`). These are useful persistence patterns for a future Maestro project-skill contract only; Maestro retains explicit user save, content hash/version, Mission Bundle allowlisting, revocation, and no automatic executable promotion.


## 2026-09-08 — 1B protocol slice and remaining composition boundary

The first 1B slice now defines a versioned JSON-lines protocol and a persistent-kernel wrapper without importing Prime: one cell per kernel, out-of-band host requests/responses, typed `done`/`event`/`error` frames, malformed-frame rejection, child-close → `unknown`, interrupt, bounded frame size, and shutdown framing. This is deliberately transport-level only.

The real Python child/channel composition and strict read-only host-effect allowlist remain open. Production still injects the explicit unavailable kernel, so no raw process, filesystem, shell, Git, network, or provider effect is reachable from the new protocol modules. This preserves the documented fail-closed boundary while the authority adapter matrix is implemented next.


## 2026-09-08 — 1B read-only host router

Added a transport-independent read-only host-request router. It accepts only `read_file` and `git_revision`, validates relative paths/Git refs, passes an immutable Goal/session binding to injected gateways, ignores model-supplied project identity fields, validates result envelopes, enforces the declared outbound data classes, and rejects writes/unknown methods. This is the adapter contract only; real file/Git adapters still must call the existing authority-backed boundaries.


## 2026-09-08 — host-owned command and tool-call identity

The runtime `ToolContext` now carries host-generated `commandId`, `toolCallId`, and runtime `sessionId` for every tool execution. The IPython binding forwards those values with project/Goal scope and grant data; model arguments cannot replace them. This closes the identity propagation slice needed for deterministic audit correlation and future idempotency/fencing checks. Control epoch and durable authority-effect claims remain open.


## 2026-09-08 — process-kernel composition boundary

The runtime now exposes `createIpPythonProcessKernel` as a dependency-injected composition point: TypeScript owns the JSON-lines transport and session lifecycle, while the caller supplies the session-bound child channel. This keeps raw process creation out of the model-facing tool and leaves the production Control Plane responsible for selecting an authority-backed, parent-owned process adapter. A ready handshake frame is version-checked; unsupported runtimes fail closed.
