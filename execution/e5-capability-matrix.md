# E5 Capability Matrix

**Plan-E5 Task 0 deliverable**, written retroactively after Tasks 1, 2 (partial), and 5 (partial) had already started — this is the missing baseline that should have existed before that work began. It exists now so the next agent picking this up (this document is being handed to a fresh agent) does not have to re-derive current state from scratch.

Statuses follow `plan-E5-gui-implementation.md`'s own contract exactly:

- **Live** — real Control Plane method, durable success/error rendering, passing test or live evidence.
- **Partial** — a real read or write works, but a required next action is missing; that method/dependency is named.
- **Backend-blocked** — no valid server contract/durable source of truth; no fake action is shown.
- **Out-of-scope** — excluded by an explicit roadmap gate.

**Not attempted this session:** any live Electron/Playwright/real-provider verification. No `MAESTRO_TEST_DATABASE_URL`, no Docker, no running Control Plane were available in this sandbox — every status below is from static code reading and `vitest`/`tsc -b`, never a live run. Do not upgrade any row to `Live` from this document alone.

---

## Electron bridge (Task 1)

**Status: Live (code-level).** `apps/carnegie/electron/apiBridge.ts`'s `exposedApiMethods` was extended this session from ~58 to 85 methods — it previously did **not** expose `getCouncil`, `observeWorker`, `advanceWorkerIntegration`, `getEvidenceDump`, `generateConcertmasterReport`, `getConversation`, `cancelConversation`, `listConversationEvents`, `getWorker`, `sendWorkerMessage`, `activateHead`, `getDepartmentPlan`, `getMissionBundle`, `freezeGoalIntegrationRevision`, `captureEvidence`, `scanMetronome`, `raiseMetronomeChallenge`, `resolveMetronomeChallenge`, `runEncoreReview`, `createGoal`, `listProjects`, `getOrganization`, `provisionProjectAccess`, `transitionGoal`, `startAccountLogin`, `accountLoginStatus`, `cancelAccountLogin`, `logoutAccount` — 27 methods the plan's own Task 1 Step 1 example RED test and "API Surface Required by E5" section require. `preload.cts`'s duplicated allow-list was kept in sync (there is no other mechanism enforcing that beyond a hand-written test — see Known risk below). `apiBridge.test.ts` now asserts the full required surface plus a comprehensive `exposedApiMethods` ↔ `preload.cts` sync check, not just the original 5-method spot check.
**Verified:** `npx vitest run apps/carnegie/electron/apiBridge.test.ts` (8/8 pass), full `npm run build` (`tsc -b` + renderer typecheck) clean.
**Known risk:** the allow-list is still hand-duplicated across two module systems (ESM `apiBridge.ts` / CJS `preload.cts`) with no single source of truth — see plan-E5 review notes below.
**Not done:** no test asserts the bridge withholds the plaintext connection token (Task 1's prose claims this; no RED test in the plan or in this codebase currently checks it). `global.d.ts`'s `MaestroBridge.config` methods return `PublicConnectionConfig`/`void`, never `token` — that's where the real guarantee lives, structurally, not in the method allow-list.

## Shared primitives (Task 2)

- `lib/command-id.ts` — **Live.** `newCommandId()` and `classifyApiError()` implemented and unit-tested (7/7 passing), classifying every `StableApiErrorCode` into retryable/non-retryable with a title/detail pair.
- `components/ApiErrorNotice.tsx` — **Live.** Renders `classifyApiError()`'s output with a retry button only when retryable. No test file yet (`ApiErrorNotice.test.tsx` per plan's own convention is missing).
- `components/AsyncState.tsx` — **Not started.** No file exists.
- `components/ConfirmActionDialog.tsx` — **Not started.** No file exists. This blocks Task 6's "use the shared confirmation dialog for cancellation" requirement and Task 4's stop/emergency-stop confirmation requirement — those currently have no confirmation step at all (see Dashboard below).
- `useDurableEvents.ts` reconnect visibility — **Live already**, pre-existing (`App.tsx` renders a stale banner from `eventState.stale`).

## Home / Task Contract intake (Task 3)

**Status: Partial.** `views/Home.tsx` + `lib/task-contract-authoring.ts` implement create-conversation → send-turn → parse-draft → edit → confirm(exact version+hash) → launch, as two explicit separate actions, matching the plan's core safety requirement.
**Missing:** `getConversation`, `cancelConversation`, `listConversationEvents` are not called anywhere in `Home.tsx` even though the bridge now exposes them — "reload a conversation from durable events" and an explicit cancel path (Task 3 Steps 1 and 6) are not implemented. No live Electron conversation has been run (Task 3 Step 8) — this sandbox has no provider/Control Plane.

## Dashboard / Goal lifecycle (Task 4)

**Status: Partial.** `views/Dashboard.tsx` + `lib/goal-control.ts` + `lib/goal-data.ts` + `lib/dashboard-data.ts` render real durable Goal state, budget, workers (kanban), and a full "Goal office" projection panel (`views/panels/GoalDepartmentPanels.tsx`, driven by the generic `getProjection` read model — this already substantially covers Task 5/6's *read* side across Council/Department/Worker/Evidence/Routing/Certification/Metronome/Encore/Discord, independent of the typed per-entity methods).
**Missing:** pause/resume/stop/emergency-stop call the real API with the correct `expectedVersion`, but **no confirmation step exists** for stop/emergency-stop — Task 4 Step 4 explicitly requires "explicit confirmations for stop and emergency-stop," which depends on the still-unbuilt `ConfirmActionDialog`. `createGoal` is not used anywhere (Goals apparently only come from a launched Task Contract, which may be correct — not independently verified against the server contract this session).

## Planning: Overture → Head → Council (Task 5)

**Status: Partial**, new this session (`views/Planning.tsx`, `lib/planning-data.ts`, `lib/planning-data.test.ts`, wired into `views.ts`/`Sidebar.tsx`/`App.tsx`/`i18n`).
**Live:** Overture role selection (`selectOvertureRoles`), Head activation (`activateHead`), Council create/brief/reveal/decide (`createCouncil`/`submitCouncilBrief`/`revealCouncil`/`decideCouncil`/`getCouncil`) — each a separate explicit action per the plan's "do not auto-reveal or auto-decide" rule, using real IDs from the prior stage (never sample IDs). `currentPlanningStage()` and all API pass-through wrappers are unit-tested, 10/10 passing.
**RESOLVED (2026-09-21, operator confirmed):** `createDepartmentPlan`/`createMissionBundle` content is produced by the Head/Council's own reasoning process, **not hand-authored by the Carnegie operator.** Do not build a substance-authoring form for either. Next agent's Planning screen work for these two:
- Render `getDepartmentPlan`/`getMissionBundle` as **read-only** views (plan version, item IDs, dependencies, scope, worker inputs, stopping conditions — per plan-E5 Task 5 Step 6's own wording, which already says "render," not "author").
- If — and only if confirmed by reading `apps/control-plane/src`'s council/department-plan/mission-bundle route handlers — the real flow needs an explicit human **trigger** (e.g., an operator-visible "ask the Department to produce its Plan now" action with no content the operator supplies), build that as a single confirm-and-fire button, not a form. Verify this need against the actual route/service code before adding even that button; it may turn out plan creation fires automatically once the Council resolves, in which case Carnegie needs no write action here at all beyond the read.
- The originally-cited complexity reason (`MissionBundleSubstance` embedding a branded `TaskDemand`) is exactly why this must be system-generated, not a red flag to investigate further — that stands as the closed rationale, not an open question anymore.
**Not verified:** no live Council round has actually been run against a real Control Plane.

## Worker execution (Task 6)

**Status: Not started.** No `views/Workers.tsx` or `lib/worker-data.ts` exists. Dashboard shows worker existence/status read-only (kanban + office panel); there is no spawn/observe/message/cancel UI anywhere. This is blocked on Task 5's Mission Bundle question above — `spawnWorker` needs a real `councilId`/`departmentId`/`SpawnWorkerInput`, and the plan explicitly forbids sample IDs here.

## Git / evidence / certification / review (Task 7)

**Status: Partial, read-only.** `views/Git.tsx` (via `useGitIntegrationState`) renders the real integration branch/base revision/frozen revision read-only. No write actions exist: `createGoalIntegrationBranch`, `createDepartmentBranch`, `createWorkerWorktree`, `advanceWorkerIntegration`, `freezeGoalIntegrationRevision`, `acceptWorker`, `certifyWorker`, `certifyConditionalWorker`, `captureEvidence` are all bridged (Task 1, this session) but unused. No `views/WorkerReview.tsx` or `lib/integration-data.ts` exists. `views/EvidenceLog.tsx` exists (41 lines, not inspected in depth this session).

## Approvals / Inbox / critical actions (Task 8)

**Status: Partial — more complete than the plan's file list implies.** `views/Inbox.tsx` + `lib/inbox-data.ts` already implement `loadInbox`, `approveInboxItem`, `denyInboxItem`, and `discussWithConcertmaster` — the core approve/deny/discuss flow the plan describes exists, just not as a separate `views/Approvals.tsx`/`lib/approval-data.ts` module. **Not verified:** whether `approveInboxItem`/`denyInboxItem` actually route through `approveAndRunCriticalAction`/`denyCriticalAction` as the plan requires, or through some other path — read `lib/inbox-data.ts` in full before assuming either way. `requestCriticalAction` and `selectFullAccessMode` are bridged but not observed in use anywhere.

## Channel / durable events (Task 9)

**Status: Partial.** `views/Channel.tsx` (112 lines) exists and was not inspected in depth this session. `useDurableEvents.ts`'s reconnect/stale-banner behavior is already live at the shell level (`App.tsx`).

## Settings / provider / billing (Task 10)

**Status: Partial.** `views/Settings.tsx`, `views/Billing.tsx` exist; not inspected in depth this session. No `lib/settings-data.ts` exists per the plan's file list.

## Persona / Arrangements (Task 11)

**Status: Partial.** `views/Persona.tsx` (64 lines), `views/Arrangements.tsx` (83 lines) exist; not inspected in depth this session. No `lib/persona-data.ts` exists per the plan's file list.

## Luthiery / Flashmob honesty (Task 12)

**Status: Likely already substantially closed**, based on `operations/findings.md`'s 2026-09-21 entries ("luthiery honestly reported that the control plane does not durably track skill/tool registries") from a separate live dogfood session — re-verify rather than trust this note, but do not treat Task 12 as untouched.

## Accessibility / layout (Task 13)

**Status: Partial infrastructure exists.** Per `roadmap/act-1-foundation/phase-08-hardening-release-certification.md`, Carnegie already has `axe-core`, `@playwright/test`, `playwright.config.ts`, and `src/accessibility.playwright.ts` from Plan 7 §S8 — reuse it, do not reinstall. `apps/carnegie/tests/e5-a11y.spec.ts` and `e5-live-acceptance.spec.ts` (Task 13/14's deliverables) do not exist yet.

## Tasks 14–15 (live project progression, final gate)

**Not started, and not attemptable from this sandbox** — no PostgreSQL, no Docker, no running Control Plane, no configured model provider. These require the user's local dev environment.

---

## Immediate next steps for whoever picks this up

1. **Verify the resolved Task 5 direction against the actual route code, then build the read-only Department Plan / Mission Bundle panel** (see above) — this unblocks Task 6, since `spawnWorker` needs the real `councilId`/`departmentId`/`itemId` a resolved Mission Bundle carries.
2. Build `components/AsyncState.tsx` and `components/ConfirmActionDialog.tsx` (Task 2) — several already-built screens (Dashboard's stop/emergency-stop) are missing required confirmation because of this gap.
3. Wire `getConversation`/`cancelConversation`/`listConversationEvents` into `Home.tsx` (Task 3 gap).
4. `views/Workers.tsx` (Task 6) is the single highest-value missing screen for an end-to-end run, once Task 5's question is resolved.
5. Read `lib/inbox-data.ts` in full to confirm/correct the Task 8 approval-routing note above before building a separate `Approvals.tsx`.

## Bridge duplication risk (flagged during this session's plan review, still unresolved)

`exposedApiMethods` lives twice — `apiBridge.ts` (ESM, used by `main.ts`'s IPC dispatch and `isExposedMethod`) and `preload.cts` (CJS, used by `contextBridge.exposeInMainWorld`) — kept in sync only by a code comment and a test that checks every method's exact quoted string appears in `preload.cts`'s source text. This test now covers the full list (this session), which closes the immediate risk, but the structural fragility (two hand-maintained lists across module systems) remains. Not fixed this session; flagging for whoever next touches Task 1.
