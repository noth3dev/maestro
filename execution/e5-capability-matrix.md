# E5 Capability Matrix

**Plan-E5 Task 0 deliverable**, written retroactively after Tasks 1, 2 (partial), and 5 (partial) had already started — this is the missing baseline that should have existed before that work began. It exists now so the next agent picking this up (this document is being handed to a fresh agent) does not have to re-derive current state from scratch.

Statuses follow `plan-E5-gui-implementation.md`'s own contract exactly:

- **Live** — real Control Plane method, durable success/error rendering, passing test or live evidence.
- **Partial** — a real read or write works, but a required next action is missing; that method/dependency is named.
- **Backend-blocked** — no valid server contract/durable source of truth; no fake action is shown.
- **Out-of-scope** — excluded by an explicit roadmap gate.

**Not attempted this session:** any live Electron/Playwright/real-provider verification. Current checks confirm `MAESTRO_TEST_DATABASE_URL` is empty; Docker is available but only unrelated Supabase containers are running; no Control Plane/provider is available. The Electron process is present, but no live E5 path was exercised. Every status below remains from static code reading and `vitest`/`tsc -b`, never a live run. Do not upgrade any row to `Live` from this document alone.

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

1. **Build Task 1.5 (zero-config local bootstrap)** — **partial:** `resolveLocalConnection` is reached through `initializeCarnegieConnection`, and startup progress reaches the renderer. Live first-run acceptance still requires Docker or packaged local binaries; no live auto-bootstrap claim is made.
2. ~~Wire `getConversation`/`cancelConversation`/`listConversationEvents` into `Home.tsx`~~ — **done**, per `roadmap/act-1-foundation/active/operations/progress.md`'s Task 3 checkpoints (`conversation-data.ts` added, Home reloads durable conversation events, draft/confirmed/launched/rejected phase labels derive from real server state). Re-verify current HEAD before assuming Task 3 is fully closed — a live Electron attempt on 2026-09-21 reached CDP but failed on `Control plane request failed` for lack of a reachable Control Plane (see Task 1.5's rationale).
3. Verify the resolved Task 5 direction against the actual route code, then build the read-only Department Plan / Mission Bundle panel (see above) — this unblocks Task 6, since `spawnWorker` needs the real `councilId`/`departmentId`/`itemId` a resolved Mission Bundle carries.
4. `views/Workers.tsx` (Task 6) is the single highest-value missing screen for an end-to-end run, once Task 5's question is resolved.
5. Read `lib/inbox-data.ts` in full to confirm/correct the Task 8 approval-routing note above before building a separate `Approvals.tsx`.

## Bridge duplication risk (flagged during this session's plan review, still unresolved)

`exposedApiMethods` lives twice — `apiBridge.ts` (ESM, used by `main.ts`'s IPC dispatch and `isExposedMethod`) and `preload.cts` (CJS, used by `contextBridge.exposeInMainWorld`) — kept in sync only by a code comment and a test that checks every method's exact quoted string appears in `preload.cts`'s source text. This test now covers the full list (this session), which closes the immediate risk, but the structural fragility (two hand-maintained lists across module systems) remains. Not fixed this session; flagging for whoever next touches Task 1.
