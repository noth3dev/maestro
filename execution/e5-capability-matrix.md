# E5 Capability Matrix

**Plan-E5 Task 0 deliverable**, written retroactively after Tasks 1, 2 (partial), and 5 (partial) had already started — this is the missing baseline that should have existed before that work began. It exists now so the next agent picking this up (this document is being handed to a fresh agent) does not have to re-derive current state from scratch.

Statuses follow `plan-E5-gui-implementation.md`'s own contract exactly:

- **Live** — real Control Plane method, durable success/error rendering, passing test or live evidence.
- **Partial** — a real read or write works, but a required next action is missing; that method/dependency is named.
- **Backend-blocked** — no valid server contract/durable source of truth; no fake action is shown.
- **Out-of-scope** — excluded by an explicit roadmap gate.

**Historical verification state (2026-09-23):** The fresh real-PostgreSQL suite passed 432 test files / 2,874 tests (exit 0); root and Carnegie builds passed; exact Carnegie Playwright passed 4 tests with 5 designed CDP skips; changed-file ESLint and `git diff --check` passed; and secret/artifact scans were clean. A fresh Docker-backed Electron rerun now auto-bootstrapped PostgreSQL, Control Plane (`4310`), and Model Gateway (`4321`) and reached the authenticated Home UI; the bounded real composer request failed at the exact provider boundary with `No Concertmaster model is available`. Task 14 remains `Backend-blocked`; no row is upgraded to `Live` without durable/provider evidence.

**Current local UI verification (2026-09-25):** After the Router Catalog SRP extraction, `npx vitest run apps/carnegie/src/views/RouterCatalogPanel.test.tsx apps/carnegie/src/views/Settings.test.tsx --reporter=dot` passed 2 files / 30 tests; targeted ESLint, Carnegie build, and `git diff --check` passed. The post-extraction Playwright suite passed 4 tests with 5 CDP-gated skips. Prettier checks passed for `Settings.test.tsx`, `RouterCatalogPanel.tsx`, `RouterCatalogPanel.test.tsx`, and this matrix. `Settings.tsx` retains its pre-existing formatting to avoid unrelated churn; whole-file Prettier checks fail both at base and after extraction. The real Electron/CDP check predates the refactor: on a disposable profile/database it opened Settings → Ensemble Router and Providers read-only; 7 router rows showed unknown candidate/account state and all switches were disabled; the first switch exposed an accessible explanation. Both API-key rows showed `not connected`, with empty-field `connect` buttons disabled. No OAuth sign-in, provider turn, Task Contract, Goal, or Worker evidence was attempted. This remains a limited UI pass, not full E5 acceptance; see `execution/PENDING_LIVE_CHECKS.md` and `execution/e5-live-evidence/README.md`.

**Heartbeat #49 automated verification (2026-09-24):** A fresh unrestricted `npm test` against PostgreSQL `127.0.0.1:55432` passed **440 test files / 2,916 tests**, exit 0, duration **1,001.90s** (`/tmp/maestro-full-test-2.log`). This supersedes the older automated count only; Task 14 remains `Backend-blocked`, and no live provider/Task Contract/Goal/Worker evidence exists.

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

### Renderer recovery usability follow-up (2026-09-25)

The Setup renderer keeps the Retry button's visible text and accessible name stable while a status region announces the active startup step and repeated failure. Known EN/KO step labels take precedence over backend progress prose; failing-step messages remain visible. Manual drafts persist across retry. Retry failure retains focus on Retry; retry or manual-connect success moves focus to the workspace main landmark. The page `lang` follows the selected locale.

Recovery guidance uses known local-backend reason shapes rather than matching the word “Docker” anywhere: invalid `MAESTRO_LOCAL_DB_ENGINE` and `MAESTRO_EMBEDDED_DATABASE_PORT` reasons explain accepted values and that the environment used to launch Carnegie must be changed and Carnegie restarted; the actual Docker-daemon-unavailable reason offers the backend-supported Docker/`MAESTRO_LOCAL_DATABASE_URL` path; known Docker container failures point to the diagnostic command already shown in the reason; other failures retain the reason and show a neutral next step plus the separate Manual connection fallback. Recovery copy and both the primary-action text and button boundary meet AA contrast in light and dark themes.

**Verification:** focused unit tests passed **5 files / 25 tests**; `bootstrap-recovery.playwright.ts` passed **19/19**; the full Carnegie accessibility suite passed **28** tests and skipped **5** CDP-gated cases. Carnegie build, changed-file ESLint, new-file/document Prettier checks, and `git diff --check` passed.

**Evidence boundary:** `bootstrap-recovery.playwright.ts` runs against a Chromium fixture with a stubbed `window.maestro` bridge. It proves renderer/helper behavior only—not Electron IPC/preload, local bootstrap, keychain isolation, a running Control Plane/PostgreSQL, or provider actions. Live first-run and E5 acceptance remain open; see `execution/PENDING_LIVE_CHECKS.md`.

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

Task 3 implementation checkpoint: `lib/conversation-data.ts` paginates the 256-event durable API, validates conversation/project boundaries, and reconstructs operator/Concertmaster/system messages. `Home.tsx` maps turn status after sends and routes cancellation through the server-result helper; it preserves retry identity, resets on project changes, exposes continue/retry/cancel controls, and renders explicit draft/confirmed/launched/rejected phases. Focused conversation/Home tests pass 11/11; live Electron acceptance remains pending.
**Cancellation status checkpoint (2026-09-25, code committed as `aa895bad`):** `cancelHomeTurn` maps the returned conversation through shared `turnStatus`; a rejected request yields `unknown` and a visible error instead of asserting `cancelled` or `failed`. The new unknown, completion-race, and rejected-request regressions passed. Full automated verification of the same code passed 449 test files / 3,001 tests; details below. Independent review found no Critical or Important issues. Minor test boundary: these regressions call the helper directly, not a simulated Home button click.

**Open:** No live cancellation interaction has been exercised, and Home still does not refresh the durable transcript after a completion race. The 2026-09-23 real provider response still produced no Task Contract; the 2026-09-25 isolated Electron run did not attempt provider login or a provider turn. Live Task Contract, Goal, Worker, and overall E5 acceptance remain unverified.

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

**Status: Partial.** `views/Settings.tsx`, `views/RouterCatalogPanel.tsx`, `lib/settings-data.ts`, and `views/Billing.tsx` exist; `settings-data.ts` provides a server-authoritative store. The behavior-preserving SRP refactor moved the Router Catalog UI/helpers and tests into `RouterCatalogPanel.tsx` / `RouterCatalogPanel.test.tsx`; `Settings.tsx` retains server-owned catalog fetch/state and provider/account workflows. Three independent SRP reviews supported the boundary, and an independent code review found no issues. Provider sign-in, Billing, and downstream E5 acceptance remain open; see `execution/e5-live-evidence/README.md`.

## Persona / Arrangements (Task 11)

**Status: Partial.** `views/Persona.tsx` (64 lines), `views/Arrangements.tsx` (83 lines) exist; not inspected in depth this session. No `lib/persona-data.ts` exists per the plan's file list.

## Luthiery / Flashmob honesty (Task 12)

**Luthiery — Status: Backend-blocked.** `apps/carnegie/src/views/Luthiery.tsx` now renders no local registry rows and exposes only a dependency view. The view names the missing durable `listSkills`/`getSkill` and `listTools`/`getTool` reads, certification/rejection/hash/tag records, project-scoped usage/reuse reads, and authority-checked mutations. Disabled buttons cannot create or certify local records. Re-entry requires the Phase 9 control-plane, typed API-client, Electron-bridge, and durable evidence contracts described in `roadmap/act-1-foundation/phase-09-luthiery.md`. Evidence: `apps/carnegie/src/views/Luthiery.test.tsx` (2/2 passing in the Task 12 focused run).

**Flashmob/Vanguard — Status: Out-of-scope.** Act 2 starts only after Act 1 certification (`roadmap/act-2-flashmob/README.md`); this repository has no durable pre-Goal Flashmob session/run, provenance, bounded execution, or idempotent promotion-to-Goal contract. `Flashmob.tsx` and `FlashmobSession.tsx` therefore render explicit deferred/dependency states only: no sample Worker, Goal, progress, completion, or local promotion state is shown; promotion and composer controls remain disabled. Home's Flashmob mode is likewise non-submitting and points operators to the live Maestro path. Evidence: `apps/carnegie/src/views/Flashmob.test.tsx` (3/3) and `apps/carnegie/src/views/Home.test.tsx` (2/2) in the Task 12 focused run. Re-entry requires the Act 2 roadmap gate plus the missing typed Control Plane/API/bridge contracts and durable evidence linkage.

## Accessibility / layout (Task 13)

**Status: Partial: scoped Router Catalog implementation and renderer-fixture evidence are complete; live and full-route acceptance remain open.** Carnegie has semantic/responsive tests and CDP-gated specs in `apps/carnegie/src/task13-a11y.test.ts`, `apps/carnegie/src/components/Sidebar.test.tsx`, `apps/carnegie/tests/e5-a11y.spec.ts`, and `apps/carnegie/tests/e5-live-acceptance.spec.ts`. The 2026-09-25 real-Electron Router Catalog read-only slice recorded `2880x1716`, DPR 1, but it predates the layout patch and is baseline evidence only.

The scoped patch is implemented in `fix/carnegie-router-catalog-layout`: `.router-catalog-panel` uses `width:min(100%, 1180px)` and a panel-local `--text-muted: var(--text-secondary)` override; the shared `.settings-panel-wide` rule remains 780px. Each native provider table has a unique provider-specific, keyboard-focusable region wrapper. The fixture measures the shared 780px class using a placeholder; it does not claim an end-to-end Providers UI check.

**Renderer-fixture verification (not live Electron):** `RouterCatalogPanel.test.tsx` passes 23/23; `RouterCatalogPanel.playwright.ts` passes 5/5. The full Carnegie Playwright accessibility suite passes 9 tests and skips 5 CDP-gated live tests when no Electron endpoint is configured. The fixture uses the real Router Catalog component and production CSS and covers 2880x1716 CSS px at DPR 1, a 1180px catalog cap, the shared 780px width, 960px, simulated 720/640/390px widths, the 641/640px filter breakpoint, local keyboard scrolling, and light/dark axe checks for WCAG 2.0/2.1/2.2 A/AA. This does not establish post-patch Electron behavior or full-page accessibility.

**Automated suite checkpoint (2026-09-25):** root `npm run check` passed 449/449 files and 3,002/3,002 tests, exit 0, duration 1,586.56s, using disposable tmpfs PostgreSQL at `127.0.0.1:55446`; the container was removed, port 55446 is free, and persistent `maestro-local-postgres` on `55432` remained running. The suite's existing live Codex app-server test detected the local login and ran read-only `login status`, `accountRead`, and `model/list` checks; no login/OAuth flow or model turn was started, and no credential material was printed or copied. This is automated verification, not post-patch Electron or E5 live acceptance.

**Still open:** post-patch live Electron visual acceptance, full route/window-scale accessibility, and the actual Settings route heading outline (including the separate H1 finding). The live slice must use isolated XDG/HOME, local data, keyring, and disposable tmpfs PostgreSQL; do not bootstrap until native keyring isolation is proven or explicitly authorized. Overall Task 13 remains partial.
## Tasks 14–15 (live project progression, final gate)

**Attempted, not complete.** The 2026-09-25 full automated check passed 449 test files / 3,002 tests (exit 0; see Task 13 above), superseding the prior `aa895bad` run of 449 files / 3,001 tests. A 2026-09-23 real ChatGPT/Codex binding and assistant response did not produce a Task Contract. The 2026-09-25 isolated Electron run verified only read-only Settings UI and did not attempt OAuth or a provider turn. The integrated Overture → Task Contract → exact Launch → Goal/Head/Council/Worker flow remains unverified; see `execution/PENDING_LIVE_CHECKS.md` for current blockers and next evidence gates.

**Historical Heartbeat #49 correction (2026-09-24):** The unrestricted PostgreSQL suite passed **440 files / 2,916 tests**, exit 0 in **1,001.90s**. This automated result was superseded by the later Task 16 run 16 checkpoint (446 files / 2,957 tests); neither run closes the live provider or E5 gate.

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


## Heartbeat #50 routing and GUI-gap update (2026-09-24)

- Commit `ec3141a5` gates Ensemble candidates on exact live Gateway model presence and host-authorized account bindings, and propagates routing configuration through local bootstrap. Focused verification passed **3 files / 66 tests**; root build and ESLint passed.
- The model-selection specification was repaired at `docs/superpowers/specs/2026-09-23-carnegie-ensemble-concertmaster-model-selection.md`.
- Static audit found a concrete Task 15 usability gap: Overture clarification answers stop at persistence. No Control Plane answer route, API-client method, Electron bridge method, or Home answer form exists yet. This remains code-level planning evidence only.
- No live provider, Task Contract, Goal, Worker, or E5 completion claim is made; Task 14 remains `Backend-blocked` and E6 remains gated.


## Heartbeat #50 clarification-answer checkpoint (2026-09-24)

- Commit `11e11429` closes the operator-facing Overture clarification answer seam: safe question/answer event payloads, Control Plane answer route, API client, Electron allow-list, and Carnegie Home form.
- RED/GREEN focused evidence: **7 files / 75 tests passed**, with real PostgreSQL Overture persistence **6 tests passed**; build, renderer typecheck, lint, and diff checks passed.
- This proves the code-level round-trip only. The role-runtime continuation and live provider boundary remain unverified; Task 14 stays `Backend-blocked`, E5 remains open, and E6 remains gated.


## Heartbeat #51 automated verification update (2026-09-24)

The full unrestricted PostgreSQL-backed suite passed **440 files / 2,919 tests**, exit 0, duration **912.60s** (`/tmp/maestro-full-test-3.log`) after the clarification-answer path and fail-closed event projection fix. Task 14 remains `Backend-blocked`; this does not claim live provider, Task Contract, Goal, Worker, or E5 completion.


## Task 15 role-continuation regression checkpoint (2026-09-24)

After commit `4c02785a`, unrestricted `npm test` against PostgreSQL `127.0.0.1:55432` passed **441 test files / 2,920 tests**, exit 0, duration **916.12s** (`/tmp/maestro-full-test-4.log`). This includes the Overture-owned turn and replay-safe role-continuation integration path. Automated regression is green; live provider, Task Contract, Goal, Worker, and E5 acceptance remain unclaimed.


## Task 16 exact Launch → Goal handoff checkpoint (2026-09-24)

The next narrow slice now couples exact Task Contract Launch to a server-derived Goal in one PostgreSQL transaction. The launch response returns `{ taskContract, goalId, scheduling: "queued" }`. The transaction writes the `GoalCreated` receipt/event, `goal_controls`, and `goal-events` outbox handoff, and marks a linked reviewed Overture Run launched. The nested Overture state event uses its own event-local command ID so the default Launch ID cannot collide with the earlier `task_contract_attached` event. Replay with the same or a new launch command reuses the unique Task Contract→Goal binding without creating a second Goal. Focused PostgreSQL/API/UI/CLI/Overture/surface verification passed **105 tests across 9 files**; `npm run build` passed. This is automated local evidence only: legacy contracts without a linked Overture Run remain supported, while the repository still has no outbox consumer that advances Head/Council/Worker orchestration and live provider access remains unavailable; E5 and E6 are not complete.


## Task 16 first orchestration-command handoff (2026-09-24)

**Status: Partial.** Exact Launch now atomically records a server-derived Goal and a scoped `start_goal` command in the existing `goal-events` outbox payload. The command is bound to the GoalCreated event ID and carries project, Goal, and Task Contract identity. PostgreSQL API/persistence/Overture tests and build/typecheck/lint checks pass. No consumer currently claims or executes this command; automatic Head/Council/Department Plan/Mission Bundle/Worker progression remains a named backend dependency.

## Task 16 durable outbox lease prerequisite (2026-09-24)

**Status: Partial.** The existing `goal-events` outbox now has restart-safe PostgreSQL claim, owner-fenced acknowledgement, and retry release primitives. Focused verification passed **19 tests across 2 files**, and build/typecheck/lint/diff checks passed. This does not add a typed `start_goal` consumer or advance any Head, Council, Department Plan, Mission Bundle, or Worker; E5 remains open and no live provider evidence is claimed.

## Task 16 Launch-result Goal selection (2026-09-24)

**Status: Partial.** Carnegie now refreshes and server-confirms the Goal returned by exact Launch before selecting it in the GUI. Focused tests, the full Carnegie suite (**55 files / 249 tests**), build/typecheck/lint/diff checks passed. This does not execute the Goal or add the missing typed outbox consumer and downstream hierarchy progression; E5 remains open.

## Task 16 post-Launch GUI regression (2026-09-24)

Fresh unrestricted PostgreSQL verification after `7e0e7f82` passed **441 files / 2,926 tests**, exit 0, duration **927.57s** (`/tmp/maestro-full-test-5.log`). Automated regression is green; this does not close the live provider or downstream orchestration gates.

## Task 16 typed `start_goal` envelope guard (2026-09-24)

**Status: Partial.** A pure persistence boundary now validates the exact scoped `start_goal` envelope after claim without acknowledging or executing it. Focused verification passed **30 tests across 3 files**, with build/typecheck/lint/diff checks green. This is not a consumer and does not advance the Goal hierarchy; E5 remains open.

## Task 16 post-parser regression (2026-09-24)

Fresh unrestricted PostgreSQL verification after `7098cb5b` passed **441 files / 2,931 tests**, exit 0, duration **904.09s** (`/tmp/maestro-full-test-6.log`). Automated regression is green; live provider and downstream orchestration gates remain open.

## Task 16 durable `start_goal` binding (2026-09-24)

**Status: Partial.** Parsed `start_goal` identity is now checked against the durable `GoalCreated` event, Goal binding, launched Task Contract, project scope, and content hash. Focused verification passed **30 tests across 3 files**, with build/typecheck/lint/diff checks green. This is validation only, not consumption or execution; E5 remains open.

## Task 16 regression follow-up: soak lock race (2026-09-24)

The post-binding full PostgreSQL regression was not green: **441 files / 2,930 passed of 2,931 tests**, exit 1, duration **918.47s** (`/tmp/maestro-full-test-7.log`). The only failure exposed a concurrent soak-report lock publication race. The lock now uses complete temporary metadata plus atomic `link` publication; focused soak verification and four parallel repeats passed. Repository-wide verification remains pending.

## Task 16 post-soak-fix regression (2026-09-24)

Fresh unrestricted PostgreSQL verification after `5634e9d1` passed **441 files / 2,931 tests**, exit 0 (`/tmp/maestro-full-test-8.log`). This validates the repository after the atomic soak-lock fix; it does not close live provider or automatic downstream orchestration gates.

## Task 16 typed start_goal consumer (2026-09-24)

**Status: Partial.** An opt-in control-plane loop now drains only explicitly typed `start_goal` outbox rows after startup reconciliation. It performs envelope/binding validation and owner-fenced delivery/retry, but intentionally does not activate Heads or create downstream hierarchy records. Focused verification passed **46 tests across 4 files** plus **10 main integration tests**; build/typecheck/lint/diff passed. E5 remains open.

## Task 16 Launch error mapping (2026-09-24)

**Status: Partial.** The missing `TaskContractOrchestrationUnavailableError` API mapping is now explicit and schema-allowlisted as HTTP 503 `task_contract_orchestration_unavailable`. API/contracts verification passed **20 tests across 2 files**; typecheck/build passed. Orchestration availability and downstream execution remain open.

## Task 16 pre-build regression note (2026-09-24)

Full run 9 was invalidated by build ordering: it started before the new stable API error code was built and the sole new mapping test loaded stale contracts dist. Result: **441 files / 2,940 passed of 2,941 tests**, exit 1, duration **980.36s** (`/tmp/maestro-full-test-9.log`). Post-build focused verification passed 20/20; fresh full verification remains pending.

## Task 16 API error title follow-up (2026-09-24)

Full run 10 found a renderer contract gap for the newly allowlisted error code: **441 files / 2,940 passed of 2,941 tests**, exit 1, duration **901.31s** (`/tmp/maestro-full-test-10.log`). Carnegie now provides a stable non-generic title; focused command-id/API verification passed 16/16 and build/typecheck/lint/diff passed. Fresh full verification remains pending.

## Task 16 full regression run 11 timing note (2026-09-24)

Run 11 was not green: **441 files / 2,941 passed of 2,942 tests**, exit 1, duration **898.53s** (`/tmp/maestro-full-test-11.log`). The sole failure was a short-lease worker cancellation race; diagnostics show the cancellation path correctly rejected a stale Goal proof while the successor takeover fulfilled. The test passed five isolated repetitions and the complete worker integration file (46/46). No production change was made; fresh full verification remains pending.


## Task 16 full regression run 12

**Status: Partial.** Fresh PostgreSQL `npm test` passed **442 files / 2,942 tests**, exit 0, duration **963.28s** (`/tmp/maestro-full-test-12.log`). The explicit Head activation plan/controller slice remains automated-only; it does not establish live provider or downstream E5 evidence.


## Task 16 regression runs 13–14

Run 13 was non-green (**445 files / 2,952 tests**, 5 failures, exit 1, **1034.66s**) because it began before the final hardening, surface snapshot updates, and persistence fixture update. Fresh run 14 after those changes passed **446 files / 2,954 tests**, exit 0, **949.77s** (`/tmp/maestro-full-test-14.log`). This confirms automated regression only; live downstream evidence and E5 acceptance remain open.


## Task 16 Council-creation handoff and run 15

**Status: Partial.** The controller now durably creates the first Head Council after explicit Head activation and replays without a duplicate. Focused verification passed **12 files / 70 tests**; fresh PostgreSQL `npm test` passed **446 files / 2,956 tests**, exit 0, duration **945.94s** (`/tmp/maestro-full-test-15.log`). Brief submission/reveal/decision and live provider/downstream acceptance remain open.


## Task 16 resumable briefs-pending stage and run 16

**Status: Partial.** After durable Council creation, orchestration remains `running` at `briefs_pending`; replay does not create duplicate effects. Focused tests passed **3 files / 9 tests** and fresh PostgreSQL `npm test` passed **446 files / 2,957 tests**, exit 0, duration **949.80s** (`/tmp/maestro-full-test-16.log`). Independent Head briefs, reveal/decision, live provider, downstream execution, and E5 acceptance remain open.



## Task 16 Head brief adapter boundary (2026-09-24)

Added an unconnected `HeadBriefRuntime` adapter in `packages/agent-runtime/src/head-brief-runtime.ts`. It prompts/observes an opaque Head execution only when an explicit caller invokes it, requires a terminal successful answer, parses strict JSON through the existing `IndependentBrief` validator, returns the exact provider/model identity, bounds output size, and never echoes raw provider text in errors. It does not submit a brief, mutate Council state, or wire into `start_goal`; no provider was contacted in verification. `npx vitest run packages/agent-runtime/src/head-brief-runtime.test.ts packages/agent-runtime/src/surface.test.ts packages/domain/src/council.test.ts --reporter=dot` passed **3 files / 9 tests**; `npm run build` and targeted `npx eslint packages/agent-runtime/src/head-brief-runtime.ts packages/agent-runtime/src/head-brief-runtime.test.ts packages/agent-runtime/src/surface.test.ts` passed.



## Task 16 read-only orchestration status bridge (2026-09-24)

Added a project-bound read-only status surface for the durable post-Launch orchestration run: `GET /v1/goals/:goalId/orchestration?projectId=...`, typed API-client method `getGoalOrchestrationStatus`, and Carnegie Electron/preload exposure. It returns the PostgreSQL-backed `stage`, `state`, `reason`, command/binding identity, and plan hash; missing or different-project runs fail closed as not found. This surface performs no mutation, provider call, brief submission, reveal, or decision.

`npx vitest run apps/control-plane/src/start-goal-orchestration-status-service.test.ts apps/control-plane/src/server.test.ts packages/api-client/src/client.test.ts apps/carnegie/electron/apiBridge.test.ts --reporter=dot` passed **4 files / 116 tests**; `npm run build`, targeted `npx eslint ...`, `npm run boundaries:check`, and `git diff --check` passed.



## Task 16 Carnegie orchestration-stage display (2026-09-24)

Carnegie now loads the read-only orchestration status for each Goal during the existing Goal refresh and displays an available stage such as `briefs_pending` in the Sidebar. Missing legacy orchestration rows are ignored per Goal so the durable Goal list remains usable. This is display-only: it performs no state transition, provider call, brief submission, reveal, or decision.

`npx vitest run apps/carnegie/src --reporter=dot` passed **55 files / 252 tests**; `npm run build`, targeted ESLint, `npm run boundaries:check`, and `git diff --check` passed.

## Full automated verification checkpoint (2026-09-25)

At feature-branch HEAD `3e507fa8`, `npm run check` completed with exit 0 against disposable PostgreSQL 16.15 at `127.0.0.1:55446` using a 4 GiB tmpfs. The check ran `npm run build` (`tsc -b` and Carnegie renderer typecheck) followed by Vitest: **449/449 files and 2,998/2,998 tests passed**; Vitest duration was **1,162.22s**. The earlier 512 MiB tmpfs attempt ended after PostgreSQL logged a WAL `No space left on device` panic; its later connection failures were environmental and are superseded by this passing rerun. After verification, the disposable container was stopped and removed; port `55446` was free, and persistent `maestro-local-postgres` remained running on `55432`. This automated result does not close provider sign-in, integrated Overture/Task Contract/Goal/Worker acceptance, or full E5 live acceptance.

## Cancellation-status full automated verification checkpoint (2026-09-25)

The focused command `npm test -- apps/carnegie/src/lib/conversation-data.test.ts apps/carnegie/src/views/Home.test.tsx --reporter=dot` passed 2 files / 11 tests. `npm run check` then passed the build, Carnegie renderer typecheck, and Vitest: **449/449 files and 3,001/3,001 tests**, exit 0; Vitest duration was **1,200.38s** and total command duration was **1,219.67s**. This ran against a disposable PostgreSQL 16 container with a 4 GiB tmpfs on `127.0.0.1:55446`; after the run the container was removed, `55446` was no longer listening, and persistent `maestro-local-postgres` on `55432` remained healthy. The verified code was committed as `aa895bad`; no code changed between verification and commit. Targeted ESLint, the helper-file Prettier check, Carnegie build, and `git diff --check` also passed. Whole-file Prettier on `Home.tsx` and `conversation-data.test.ts` was already failing at the baseline, so unrelated formatting was preserved. This is automated evidence only: no live cancellation click, provider turn, Task Contract, or downstream E5 acceptance was verified.
