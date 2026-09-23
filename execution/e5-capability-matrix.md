# E5 Capability Matrix

**Plan-E5 Task 0 deliverable**, written retroactively after Tasks 1, 2 (partial), and 5 (partial) had already started — this is the missing baseline that should have existed before that work began. It exists now so the next agent picking this up (this document is being handed to a fresh agent) does not have to re-derive current state from scratch.

Statuses follow `plan-E5-gui-implementation.md`'s own contract exactly:

- **Live** — real Control Plane method, durable success/error rendering, passing test or live evidence.
- **Partial** — a real read or write works, but a required next action is missing; that method/dependency is named.
- **Backend-blocked** — no valid server contract/durable source of truth; no fake action is shown.
- **Out-of-scope** — excluded by an explicit roadmap gate.

**Current verification state (2026-09-23):** The fresh real-PostgreSQL suite passed 432 test files / 2,874 tests (exit 0); root and Carnegie builds passed; exact Carnegie Playwright passed 4 tests with 5 designed CDP skips; changed-file ESLint and `git diff --check` passed; and secret/artifact scans were clean. A fresh Docker-backed Electron rerun now auto-bootstrapped PostgreSQL, Control Plane (`4310`), and Model Gateway (`4321`) and reached the authenticated Home UI; the bounded real composer request failed at the exact provider boundary with `No Concertmaster model is available`. Task 14 remains `Backend-blocked`; no row is upgraded to `Live` without durable/provider evidence.

---

## Electron bridge (Task 1)

**Status: Live (code-level).** `apps/carnegie/electron/apiBridge.ts`'s `exposedApiMethods` was extended this session from ~58 to 85 methods — it previously did **not** expose `getCouncil`, `observeWorker`, `advanceWorkerIntegration`, `getEvidenceDump`, `generateConcertmasterReport`, `getConversation`, `cancelConversation`, `listConversationEvents`, `getWorker`, `sendWorkerMessage`, `activateHead`, `getDepartmentPlan`, `getMissionBundle`, `freezeGoalIntegrationRevision`, `captureEvidence`, `scanMetronome`, `raiseMetronomeChallenge`, `resolveMetronomeChallenge`, `runEncoreReview`, `createGoal`, `listProjects`, `getOrganization`, `provisionProjectAccess`, `transitionGoal`, `startAccountLogin`, `accountLoginStatus`, `cancelAccountLogin`, `logoutAccount` — 27 methods the plan's own Task 1 Step 1 example RED test and "API Surface Required by E5" section require. `preload.cts`'s duplicated allow-list was kept in sync (there is no other mechanism enforcing that beyond a hand-written test — see Known risk below). `apiBridge.test.ts` now asserts the full required surface plus a comprehensive `exposedApiMethods` ↔ `preload.cts` sync check, not just the original 5-method spot check.
**Verified:** `npx vitest run apps/carnegie/electron/apiBridge.test.ts` (8/8 pass), full `npm run build` (`tsc -b` + renderer typecheck) clean.
**Known risk:** the allow-list is still hand-duplicated across two module systems (ESM `apiBridge.ts` / CJS `preload.cts`) with no single source of truth — see plan-E5 review notes below.
**Not done:** no test asserts the bridge withholds the plaintext connection token (Task 1's prose claims this; no RED test in the plan or in this codebase currently checks it). `global.d.ts`'s `MaestroBridge.config` methods return `PublicConnectionConfig`/`void`, never `token` — that's where the real guarantee lives, structurally, not in the method allow-list.

## Zero-config local bootstrap (Task 1.5, new 2026-09-21)

**Status: Partial.** The existing `initializeCarnegieConnection` orchestration now forwards real local-bootstrap step events, and Electron creates the window before startup completes so the renderer can receive progress instead of a blank first-run window. `maestro:bootstrap:status` and `maestro:bootstrap-status` expose the starting/ready/setup-required lifecycle; the renderer shows the active step message. The shared local-stack launcher remains the source of truth for reuse-vs-launch, migrations, and project provisioning.
**Operator instruction (2026-09-21):** opening Carnegie must be enough by itself — no separate manual connection step. See `plan-E5-gui-implementation.md`'s new **Task 1.5** for the full design constraints (stream real bootstrap-step progress instead of a blank window during first-run cold start; `Setup.tsx` becomes the genuine-failure fallback showing the real `setup-required` reason, not the default first screen; never override an operator's explicit remote Control Plane config; never start a second competing local stack if one is already reachable).
**Why this matters beyond convenience:** most of this session's `PENDING_LIVE_CHECKS.md` plan-E5 entries are blocked on "no Control Plane/provider listener" — a manual-setup gap, not a missing-capability gap. Closing Task 1.5 is very likely a prerequisite for most remaining live-check items to become attemptable at all, in any environment that has Docker or a packaged Control Plane binary (this specific sandbox may still lack both even after Task 1.5 lands — verify before assuming it alone unblocks every live check here).

**Verification:** focused bootstrap/progress tests pass 2 files / 10 tests; Carnegie build, changed-file lint, and `git diff --check` pass; the fresh root non-integration suite passes 302 files / 2,090 tests with 9 skipped. Independent final §0.3 review returned `REVIEW: PASS` with no P0/P1/P2 findings.

**Remaining:** live first-run verification still requires the local bootstrap to run with Docker or packaged binaries; no live auto-bootstrap acceptance has been claimed in this sandbox. Explicit remote/disable overrides and genuine `setup-required` fallback remain covered by the existing orchestration tests.

## Shared primitives (Task 2)

- `lib/command-id.ts` — **Live (code-level).** `newCommandId()` and `classifyApiError()` preserve stable status/code fields from clone-safe IPC errors, redact credential-shaped message/detail text, and classify every `StableApiErrorCode` with a stable title plus retry policy; focused classification tests pass 10/10.
- `components/ApiErrorNotice.tsx` — **Live (code-level).** Renders `classifyApiError()`'s sanitized output with a retry button only when retryable; dedicated notice and `AsyncState` tests cover retryable and authority-denial paths.
- `components/AsyncState.tsx` — **Live (code-level).** Shared loading (`role=status`, `aria-busy`), ready, empty, and API-error states are covered by 5 tests.
- `components/ConfirmActionDialog.tsx` — **Live (code-level).** Closed state, unique labelled effect summary, danger styling, Escape cancellation, surface-only Enter confirmation, and button callbacks are covered by 4 tests. Task 4/6 still need to adopt it at their own task boundaries.
- `useDurableEvents.ts` reconnect visibility — **Live (code-level).** The subscription preserves the latest cursor, publishes an explicit `connecting/stale` state until an upstream-connected message or the first event, and exposes a retry action that restarts only the subscription from the last durable cursor. `App.tsx` renders the stale banner and retry control; focused subscription/bridge tests cover reconnect, polling, upstream acknowledgement, retry cursor ownership, and redaction paths.
- `electron/api-error-bridge.ts` plus `main.ts`/`preload.cts` — **Live (code-level).** Renderer API calls use a clone-safe success/error envelope that preserves `ApiError` status/code/detail fields and redacts credential-shaped text before IPC; focused boundary tests pass 3/3.
- `packages/api-client/src/transport.ts` and `methods/events.ts` — **Live (code-level).** Goal SSE invokes `onConnected` after the HTTP response has a body, and the Electron pump forwards that acknowledgement while idle; API-client and bridge tests cover this response-established path.
- Task 2 verification gate — Focused 8 files / 71 tests, full non-integration 299 files / 2,076 tests with 9 skipped, Carnegie build, changed-file ESLint, and diff-check all pass. Independent no-edit review at code HEAD `426c9bfb` returned `REVIEW: PASS`; live Electron/Postgres/provider acceptance remains pending in `execution/PENDING_LIVE_CHECKS.md`.

## Home / Task Contract intake (Task 3)

**Status: Partial.** `views/Home.tsx` + `lib/task-contract-authoring.ts` implement create-conversation → send-turn → parse-draft → edit → confirm(exact version+hash) → launch, as two explicit separate actions, matching the plan's core safety requirement.

Task 3 implementation checkpoint: `lib/conversation-data.ts` paginates the 256-event durable API, validates conversation/project boundaries, and reconstructs operator/Concertmaster/system messages. `Home.tsx` preserves real turn status and retry identity, resets on project changes, exposes continue/retry/cancel controls, and renders explicit draft/confirmed/launched/rejected phases. Focused conversation/task-authoring/Home tests pass 19/19; final live Electron acceptance remains pending.
**Missing:** Home still has no explicit cancel-turn action, and the first live Electron conversation could not complete: the bounded launch reached CDP but failed with `Control plane request failed` because no usable Control Plane/database/provider is configured. Durable reload is implemented and covered by `lib/conversation-data.test.ts`; no live claim is made.

## Dashboard / Goal lifecycle (Task 4)

**Status: Live (code-level; live lifecycle acceptance pending).** `views/Dashboard.tsx` + `lib/goal-control.ts` + `lib/goal-data.ts` + `lib/dashboard-data.ts` render real durable Goal state, budget, workers (kanban), and a full "Goal office" projection panel (`views/panels/GoalDepartmentPanels.tsx`, driven by the generic `getProjection` read model — this already substantially covers Task 5/6's *read* side across Council/Department/Worker/Evidence/Routing/Certification/Metronome/Encore/Discord, independent of the typed per-entity methods). Task 4 now has project-scoped Goal loading/selection reconciliation, refresh on durable event cursor changes, explicit stop/emergency-stop confirmation, classified lifecycle errors, stale-response and current-scope guards for all Goal adjunct reads, identity-safe detail rendering, and focus-managed confirmation dialogs. Focused coverage passes 4 files / 25 tests; the Carnegie build passes; the fresh root non-integration suite passes 306 files / 2,119 tests.
**Remaining gate:** live Goal lifecycle acceptance is still pending. `createGoal` is intentionally not used here: the Task Contract launch route only launches the contract, so the Dashboard discovers existing durable Goals through `listGoals` rather than inventing a local Goal or assuming launch creates one.

## Planning: Overture → Head → Council (Task 5)

**Status: Partial**, new this session (`views/Planning.tsx`, `lib/planning-data.ts`, `lib/planning-data.test.ts`, wired into `views.ts`/`Sidebar.tsx`/`App.tsx`/`i18n`).
**Partial:** Overture role selection (`selectOvertureRoles`), Head activation (`activateHead`), and Council create/brief/reveal/decide (`createCouncil`/`submitCouncilBrief`/`revealCouncil`/`decideCouncil`/`getCouncil`) are separate explicit actions and use server-returned identities. Department Plan and Mission Bundle are read-only server views; Carnegie does not author their substance. The Planning helpers and renderer now lock later calls to the Head-returned department, constrain bundle requests to loaded plan items/version/content hash, clear stale plan/bundle state before reload or item changes, and render durable scope, dependencies, worker inputs, evidence, validation, and termination fields. Focused coverage passes 2 files / 17 tests; Carnegie build and changed-file lint pass; root non-integration Vitest passes 306 files / 2,125 tests.
**Not verified:** no live Council round or real Department Plan/Mission Bundle read has run against a real Control Plane. Worker execution remains the next task and must use the real `councilId`, `departmentId`, `planVersion`, and `itemId` returned by these records.

## Worker execution (Task 6)

**Status: Partial, code-level implementation exists.** `views/Workers.tsx`, `lib/worker-data.ts`, `useGoalWorkers.ts`, `Channel.tsx`, and `Planning.tsx` expose server-scoped Worker roster, Mission Bundle-shaped spawn, observe, message, and cancel paths. `Workers.tsx` refuses actions unless the selected Worker exactly matches the durable Goal/Mission Bundle scope. No live Worker execution is claimed because Task 14 could not reach a Control Plane/provider; the real `councilId`/`departmentId`/`planVersion`/`itemId` must still come from a live Mission Bundle.

## Git / evidence / certification / review (Task 7)

**Status: Partial, code-level implementation exists.** `views/Git.tsx` wires real branch/worktree/integration/review actions through `lib/integration-data.ts`; `WorkerReview.tsx` requires server-issued integration/evidence/acceptance state before enabling accept/certify; and `EvidenceLog.tsx` reads/captures durable evidence bundles, certifications, reports, and event records. No live Git/evidence/certification result is claimed because the Control Plane/provider boundary was unavailable; all actions remain dependent on real IDs and backend authority.

## Approvals / Inbox / critical actions (Task 8)

**Status: Partial — more complete than the plan's file list implies.** `views/Inbox.tsx` + `lib/inbox-data.ts` already implement `loadInbox`, `approveInboxItem`, `denyInboxItem`, and `discussWithConcertmaster` — the core approve/deny/discuss flow the plan describes exists, just not as a separate `views/Approvals.tsx`/`lib/approval-data.ts` module. **Not verified:** whether `approveInboxItem`/`denyInboxItem` actually route through `approveAndRunCriticalAction`/`denyCriticalAction` as the plan requires, or through some other path — read `lib/inbox-data.ts` in full before assuming either way. `requestCriticalAction` and `selectFullAccessMode` are bridged but not observed in use anywhere.

## Channel / durable events (Task 9)

**Status: Partial.** `views/Channel.tsx` (112 lines) exists and was not inspected in depth this session. `useDurableEvents.ts`'s reconnect/stale-banner behavior is already live at the shell level (`App.tsx`).

## Settings / provider / billing (Task 10)

**Status: Partial.** `views/Settings.tsx`, `views/Billing.tsx` exist; not inspected in depth this session. No `lib/settings-data.ts` exists per the plan's file list.

## Persona / Arrangements (Task 11)

**Status: Partial.** `views/Persona.tsx` (64 lines), `views/Arrangements.tsx` (83 lines) exist; not inspected in depth this session. No `lib/persona-data.ts` exists per the plan's file list.

## Luthiery / Flashmob honesty (Task 12)

**Luthiery — Status: Backend-blocked.** `apps/carnegie/src/views/Luthiery.tsx` now renders no local registry rows and exposes only a dependency view. The view names the missing durable `listSkills`/`getSkill` and `listTools`/`getTool` reads, certification/rejection/hash/tag records, project-scoped usage/reuse reads, and authority-checked mutations. Disabled buttons cannot create or certify local records. Re-entry requires the Phase 9 control-plane, typed API-client, Electron-bridge, and durable evidence contracts described in `roadmap/act-1-foundation/phase-09-luthiery.md`. Evidence: `apps/carnegie/src/views/Luthiery.test.tsx` (2/2 passing in the Task 12 focused run).

**Flashmob/Vanguard — Status: Out-of-scope.** Act 2 starts only after Act 1 certification (`roadmap/act-2-flashmob/README.md`); this repository has no durable pre-Goal Flashmob session/run, provenance, bounded execution, or idempotent promotion-to-Goal contract. `Flashmob.tsx` and `FlashmobSession.tsx` therefore render explicit deferred/dependency states only: no sample Worker, Goal, progress, completion, or local promotion state is shown; promotion and composer controls remain disabled. Home's Flashmob mode is likewise non-submitting and points operators to the live Maestro path. Evidence: `apps/carnegie/src/views/Flashmob.test.tsx` (3/3) and `apps/carnegie/src/views/Home.test.tsx` (2/2) in the Task 12 focused run. Re-entry requires the Act 2 roadmap gate plus the missing typed Control Plane/API/bridge contracts and durable evidence linkage.

## Accessibility / layout (Task 13)

**Status: Partial infrastructure exists.** Carnegie now has Task 13 semantic/responsive checks, rendered active-route/mode tests, and CDP-gated live specs in `apps/carnegie/src/task13-a11y.test.ts`, `apps/carnegie/src/components/Sidebar.test.tsx`, `apps/carnegie/tests/e5-a11y.spec.ts`, and `apps/carnegie/tests/e5-live-acceptance.spec.ts`. The current focused UI suite passes 8 files / 35 tests; root/Carnegie builds, changed-file ESLint, exact Carnegie Playwright (4 passed / 5 designed skips), and radial smoke pass. Real-CDP a11y execution reached the recovery renderer but was backend-blocked; no browser success is claimed for unavailable backend routes.

## Tasks 14–15 (live project progression, final gate)

**Attempted, not complete.** Task 14 reached the real Electron/CDP boundary and is `Backend-blocked` at existing PGlite bootstrap. Task 15 automated verification is now fresh and green: real PostgreSQL `npm test` passed 432 files / 2,874 tests (exit 0), root and Carnegie builds passed, exact Carnegie Playwright passed 4 with 5 designed skips, changed-file ESLint and `git diff --check` passed, and secret/artifact scans were clean. E5 is still not closed because the live Task 14 project progression/provider check has no usable Control Plane, database, or provider listener. See the dated entries below and `execution/PENDING_LIVE_CHECKS.md`.

---

## Immediate next steps for whoever picks this up

1. Restore a real PostgreSQL endpoint for the existing local session or provide the packaged Control Plane/database path; do not reset or rotate credentials as a shortcut.
2. Re-run Task 14 against the real Control Plane and configured provider, using the bounded no-effect scenario and recording only real durable IDs/evidence.
3. Re-run Task 15's unrestricted `npm test` against real PostgreSQL, then repeat the independent review and secret/artifact checks.
4. The former E6 work is integrated into E5 Tasks 14–20. Do not create a second E6 execution path; continue from the Task 14 foundation into Task 15 role runtime only after this persistence boundary remains green.

## Bridge duplication risk (flagged during this session's plan review, still unresolved)

`exposedApiMethods` lives twice — `apiBridge.ts` (ESM, used by `main.ts`'s IPC dispatch and `isExposedMethod`) and `preload.cts` (CJS, used by `contextBridge.exposeInMainWorld`) — kept in sync only by a code comment and a test that checks every method's exact quoted string appears in `preload.cts`'s source text. This test now covers the full list (this session), which closes the immediate risk, but the structural fragility (two hand-maintained lists across module systems) remains. Not fixed this session; flagging for whoever next touches Task 1.



## Integrated Task 14 foundation implementation (2026-09-23)

**Status: Partial, code-level foundation green; live E5 gate remains open.** Added the strict Overture domain and contract surfaces, six-role policy taxonomy, goal-less authority boundary, `plan00`/phase/slice path grammar, canonical content hashes, and deterministic plan manifest. Added PostgreSQL migration `0107_overture_runs_and_plan_sets.sql` with durable Overture Run, role assignments, same-channel messages, clarifications, artifacts, plan documents/revisions, manifest revisions, lifecycle events, and outbox rows. Added project/conversation composite foreign-key boundaries, append-only triggers, command identity uniqueness, sensitive-content rejection, and revision hash validation.

**Verified:** the hardened focused gate (`packages/domain/src/overture.test.ts`, domain/contracts surface tests, `packages/contracts/src/overture.test.ts`, `packages/persistence/src/overture.integration.test.ts`, and the persistence surface test) passed **6 files / 17 tests** against real PostgreSQL. `npm run build`, targeted ESLint, Prettier, migration numbering, and `git diff --check` passed. The integration proves goal-less Run replay and `executionPhase: overture`, deterministic role activation events with outbox parity, same-channel message turn identity and per-Run cursor ordering, concurrent command replay, unassigned-role and cross-conversation rejection, artifact/clarification persistence, `plan00 → plan01 → plan01-slice01` dependency edges, stored manifest hash, cross-project read denial, append-only revision protection, and database-level provider-token rejection.

**Not implemented yet:** Control Plane Overture routes, role-specific model runtime, Task Editor conversation loop, Task Contract handoff, exact Launch orchestration, and live Electron acceptance. Those are E5 Tasks 15–20.

## Task 14 live verification update (2026-09-23)

Task 14 was attempted against the real Electron window at commit `e6dc7db8`. Carnegie built and exposed CDP `9222`, but local bootstrap stopped at the existing PGlite database: `bootstrap.status()` returned `setup-required` after a mutex timeout. No Control Plane, Model Gateway, or database listener became available. A fresh disposable PGlite directory passed, while a copied existing-data probe failed with `RuntimeError: Aborted()`. The live matrix therefore remains `backend-blocked`; no project, conversation, contract, Goal, Worker, evidence, certification, report, or provider response was created. See `execution/e5-live-evidence/README.md`.

## Task 14 live verification rerun (2026-09-23)

A fresh Electron profile with no explicit `MAESTRO_API_URL` used Docker-backed local auto-bootstrap. The visible Carnegie window reached the authenticated Home UI with PostgreSQL on `55432`, Control Plane on `4310`, and Model Gateway on `4321`; the bounded window capture passed. A documentation-only request was submitted through the visible composer and the UI returned `conversation not started`, `turn failed`, and `No Concertmaster model is available`. No conversation, Task Contract, Goal, Worker, evidence, certification, report, provider response, or external effect was produced. This is a provider/model-catalog blocker at the exact boundary, not a fabricated success. Evidence: `/tmp/e5-live-rerun22-home-after-turn.png`, `/tmp/e5-live-rerun22-turn.log`.

## Latest live retry (2026-09-23)

- Docker-backed local bootstrap and bounded Electron window capture passed with PostgreSQL `55432`, Control Plane `4310`, Model Gateway `4321`, and CDP `9225`.
- In-app ChatGPT/Codex managed binding completed; the authenticated Gateway catalog exposed five real Codex models.
- The visible documentation-only Home composer created conversation `a352ec21-72fe-4e14-9f23-d35f54fa0f67` and received a completed real assistant response.
- No Task Contract draft or durable contract identity was returned by the current Home intake, so no Goal, Worker, evidence, certification, or report evidence exists. Task 14 Steps 3–6 remain backend/UI-flow open; E5 is not closed.
