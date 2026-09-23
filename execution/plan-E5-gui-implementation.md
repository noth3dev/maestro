# E5 Carnegie GUI Full Project-Execution Implementation Plan

> **For agentic workers:** Execute this plan task-by-task. Use the project's existing worktree, TDD, independent review, live Electron verification, and `execution/PENDING_LIVE_CHECKS.md` rules. Every unchecked item is an explicit implementation or verification task.

**Goal:** Make Carnegie a real operator console where Concertmaster can awaken an interactive, multi-role Overture Crew; the Crew can converse with the operator, investigate the project, research, review security, produce design options, and maintain a complete execution plan; the operator can confirm one exact Task Contract; and the launched Goal can progress through planning, workers, Git, approvals, evidence, certification, and final reporting.

**Architecture:** Keep the Control Plane, contracts, authority gateway, leases/fencing, and durable PostgreSQL state as the source of truth. Carnegie is a renderer over a narrowly allow-listed Electron bridge; every write uses the existing API client's command/idempotency and version/hash fields. Concertmaster owns the operator conversation and awakens a project-scoped Overture Run when planning is required. Overture roles participate in that same durable channel with explicit identity, role-specific prompts, model policies, and tool grants. The Task Editor incrementally maintains `plan00.md` for the project-wide blueprint, `plan01.md`/`plan02.md` for phases, and multiple slice documents under each phase. Only after the plan set and Task Contract are reviewed and exactly confirmed may Launch create or attach a Goal and start automatic orchestration. Build the whole path as real vertical slices, not disconnected mock screens. A capability is complete only when the real API, success state, rejection state, durable evidence, and live Electron path work.

**Tech Stack:** Electron 33, React 19, TypeScript, Vite, `@maestro/api-client`, `@maestro/contracts`, Vitest, Playwright, axe-core, the existing local backend, PostgreSQL, and the existing durable event stream.

**Spec:** This document's `Capability Contract`, `Scope`, and `Definition of Done` sections are the E5 specification.

## Current execution status — 2026-09-23

- E5 Tasks 1–13 have code-level evidence recorded in `execution/e5-capability-matrix.md` and `roadmap/act-1-foundation/active/operations/progress.md`; this does not close the integrated live gate.
- The latest managed-provider retry reached a real Carnegie conversation and received a real assistant response, but the current Home intake returned no Task Contract draft or durable contract identity. Integrated Tasks 14–16 must provide the real Overture-to-Contract boundary before live Task 17 can close.
- The former E6 work is now part of this E5 plan. There is one authoritative interactive Overture Crew and Task Editor path; no one-shot client-side or conversation-only producer may be added.
- `execution/plan-E6-overture-crew-autonomous-planning.md` is now an archival pointer only. Do not execute it separately.

## Global Constraints

- Never store or expose plaintext provider tokens; keep the existing encrypted main-process storage boundary.
- Never bypass `AuthorizedEffectExecutor`, authority levels, approval records, leases, fencing, idempotency, or append-only evidence rules.
- Never use illustrative/example data for an operation that claims to be live.
- Every renderer write must cross the explicit `exposedApiMethods` allow-list in `apps/carnegie/electron/apiBridge.ts`.
- Every mutating command must use a fresh command/idempotency ID and the server's expected version/content hash where the contract requires it.
- Confirmation and launch remain separate actions. A user confirmation must not silently execute the project.
- Destructive controls require a visible effect summary and an explicit confirmation step; `emergency-stop` must remain visually and semantically distinct.
- Existing Act 1 backend contracts are the implementation boundary. If a required backend contract is absent, record the exact dependency in `execution/PENDING_LIVE_CHECKS.md` and do not fake the feature.
- Flashmob/Vanguard and Muze/Transcription remain outside the Act 1 execution slice unless their roadmap gates are explicitly opened by the project owner.
- Any change touching `apps/carnegie/src/**` must run `cd apps/carnegie && npm run build`.
- Any claim that the project progressed must include a real task ID/Goal ID, durable state evidence, and the actual live outcome.
- Keep the existing dark neutral palette, terracotta accent, native cursor, frameless window chrome, and work-area maximization behavior.

## Scope

E5 covers the full operator path for implemented Act 1 capabilities:

1. Connection and local bootstrap.
2. Project and Goal selection.
3. Goal-less natural-language conversation with the Concertmaster.
4. Project-scoped Concertmaster conversation and interactive Overture Crew activation.
5. Multi-role Crew dialogue, project investigation, external research, security review, design/mock exploration, and clarification.
6. Durable `plan00.md` project blueprint, phase plans, and multiple slice plans with versioned hashes.
7. Task Contract drafting, review, edit, exact confirmation, and launch.
8. Overture-to-Goal automatic orchestration through Head/Council planning.
9. Department Plan and Mission Bundle inspection.
10. Worker spawn, observation, messaging, cancellation, worktree, integration, acceptance, and certification.
11. Goal lifecycle controls and durable event/projection updates.
12. Critical-action request, approval, denial, and full-access selection.
13. Inbox and Concertmaster discussion.
14. Channel messaging and roster state.
15. Git integration state and evidence/certification/report views.
16. Metronome, Encore Council, budget, billing, persona, and arrangements reads/actions that have real backend contracts.
17. Accessibility, loading/error/empty states, reconnect behavior, responsive layouts, and live Electron acceptance.

E5 does not silently invent a durable Luthiery registry or Flashmob backend. Those screens must become honest, useful blocked/dependency states until their contracts exist.

## Capability Contract

For each capability, the implementation must record one of these statuses in `execution/e5-capability-matrix.md`:

- **Live:** the GUI calls a real Control Plane method, renders durable success state, renders a real error/rejection, and has a passing automated or live test.
- **Partial:** a real read or write works, but a required next action is not yet available; the missing method and dependency are named.
- **Backend-blocked:** the GUI has no valid server contract or durable source of truth; no fake action is presented.
- **Out-of-scope:** excluded by an explicit roadmap gate, with the gate and re-entry condition named.

The primary E5 acceptance scenario is:

```text
open Carnegie
→ connect to the real project
→ speak to the Concertmaster without selecting a Goal
→ Concertmaster awakens the required Overture Crew roles in the same conversation
→ exchange user/role messages, clarifications, research, security findings, and design options
→ receive `plan00.md`, phase plans, and multiple slice plans with durable hashes
→ receive the Task Editor's Task Contract draft bound to the exact plan-set manifest
→ edit the plan/contract through the conversation and review projection
→ confirm the exact version and content hash
→ explicitly launch
→ observe Goal/Plan/Council/Department/Mission state
→ spawn or observe a real Worker
→ inspect its real evidence and Git state
→ approve a real critical action when policy requires it
→ accept/certify the work
→ read the durable evidence bundle and Concertmaster report
→ see the project progress in the live Dashboard, Inbox, Channel, and Git views
```

## Current Code Map

- Electron bridge: `apps/carnegie/electron/apiBridge.ts`, `preload.cts`, `main.ts`, `store.ts`, `connection-storage.ts`.
- Renderer shell: `apps/carnegie/src/App.tsx`, `views.ts`, `connection.tsx`, `goals.tsx`, `useDurableEvents.ts`.
- Existing task authoring: `apps/carnegie/src/views/Home.tsx`, `src/lib/task-contract-authoring.ts`.
- Existing Dashboard reads/controls: `apps/carnegie/src/views/Dashboard.tsx`, `useGoalDetail.ts`, `useGoalWorkers.ts`, `useGoalEvidenceBundle.ts`, `views/panels/useGoalProjection.ts`, `src/lib/goal-control.ts`.
- Existing connected views: `Channel.tsx`, `Inbox.tsx`, `EvidenceLog.tsx`, `Git.tsx`, `Floor.tsx`, `Billing.tsx`, `Settings.tsx`, `Persona.tsx`, `Arrangements.tsx`.
- Existing honest blocked views: `Luthiery.tsx`, `Flashmob.tsx`, `FlashmobSession.tsx`.
- API client contracts: `packages/api-client/src/client.ts`, `packages/api-client/src/methods/**`, `packages/contracts/src/**`.
- Control Plane routes/services: `apps/control-plane/src/**` and the corresponding API-client method modules.
- Live verification records: `execution/PENDING_LIVE_CHECKS.md` and `roadmap/act-1-foundation/active/operations/progress.md`.

## API Surface Required by E5

The bridge must expose every API-client method used by the GUI, while retaining the separate renderer event subscription path. The missing bridge methods currently needed for full execution include the following groups:

- Workspace: `createGoal`, `listProjects`, `getOrganization`, `provisionProjectAccess`.
- Conversation: `getConversation`, `cancelConversation`, `listConversationEvents`.
- Goal: `transitionGoal`, `activateHead`.
- Planning: `getCouncil`, `getDepartmentPlan`, `getMissionBundle`.
- Worker: `getWorker`, `observeWorker`, `sendWorkerMessage`.
- Git: `freezeGoalIntegrationRevision`, `advanceWorkerIntegration`.
- Evidence: `captureEvidence`, `getEvidenceDump`.
- Oversight: `scanMetronome`, `raiseMetronomeChallenge`, `resolveMetronomeChallenge`, `runEncoreReview`.
- Reporting: `generateConcertmasterReport`.
- Account/provider paths only when their existing UI contract requires them: `startAccountLogin`, `accountLoginStatus`, `cancelAccountLogin`, `logoutAccount`.

The implementation must compare this list against the current `ApiClient` interface before editing it. Do not expose a method merely because it exists; expose it only when a real Carnegie screen and acceptance path use it.

---

## Task 0: Establish the E5 baseline and capability matrix

**Files:**
- Create: `execution/e5-capability-matrix.md`
- Modify: `execution/PENDING_LIVE_CHECKS.md`
- Modify: `roadmap/act-1-foundation/active/operations/progress.md`
- Inspect: `apps/carnegie/src/App.tsx`, `apps/carnegie/src/views/*.tsx`, `apps/carnegie/electron/apiBridge.ts`, `packages/api-client/src/client.ts`, `packages/contracts/src/**`

**Deliverable:** A source-backed matrix that prevents a “looks implemented” screen from being counted as a working feature.

- [ ] **Step 1: Capture the clean baseline.**

  Run:

  ```bash
  git status --short
  cd apps/carnegie && npm run build
  cd ../.. && npm test -- --runInBand
  ```

  Record the exact results. If the repository's Vitest command does not accept `--runInBand`, run `npm test` and record that exact command instead.

- [ ] **Step 2: Enumerate every reachable view.**

  Read `apps/carnegie/src/App.tsx`, `src/views.ts`, and `src/components/Sidebar.tsx`. Put every view, nested panel, action button, and current navigation route in the matrix. Include Home, Dashboard, Channel, Git, Floor, Inbox, Evidence Log, Billing, Settings, Persona, Arrangements, Luthiery, Flashmob, and Flashmob Session.

- [ ] **Step 3: Map each action to a typed API method or an explicit blocked reason.**

  For every button and form, record the exact method name, input type, command/idempotency argument, expected version/hash requirement, and resulting durable read. A row with no method must say `backend-blocked` or `out-of-scope`; it must not say “wire later.”

- [ ] **Step 4: Add the first live blockers to `execution/PENDING_LIVE_CHECKS.md`.**

  Preserve existing entries. Add only verified blockers, each with: reproduction command, observed error, owning layer, smallest next check, and the evidence file or log path.

- [ ] **Step 5: Record the baseline in `progress.md`.**

  Prefix the entry `E5 baseline:` and include the build/test commands, current bridge method count, current connected-view count, and the matrix path.

- [ ] **Step 6: Commit the planning artifact.**

  ```bash
  git add execution/e5-capability-matrix.md execution/PENDING_LIVE_CHECKS.md roadmap/act-1-foundation/active/operations/progress.md
  git commit -m "docs(carnegie): establish E5 GUI capability matrix"
  ```

**Acceptance:** The matrix contains a row for every visible user action and no row claims Live without a real API method and evidence path.

---

## Task 1: Complete the secure Electron API bridge

**Files:**
- Modify: `apps/carnegie/electron/apiBridge.ts`
- Modify: `apps/carnegie/electron/preload.cts`
- Modify: `apps/carnegie/src/global.d.ts`
- Test: `apps/carnegie/electron/apiBridge.test.ts`
- Inspect: `packages/api-client/src/client.ts`

**Interfaces:**

```ts
export const exposedApiMethods: readonly (keyof ApiClient)[];
export type ExposedApiMethod = (typeof exposedApiMethods)[number];
export function isExposedMethod(method: string): method is ExposedApiMethod;
export function createBridgedApi(config: ConnectionConfig): ApiClient;
```

- [ ] **Step 1: Write failing allow-list tests.**

  Add tests that assert every method needed by Tasks 3–11 is exposed, `streamEvents` is not callable as a renderer property, an unknown method is rejected, and the bridge does not return the connection token.

  ```ts
  it("exposes every method used by the full project execution path", () => {
    expect(isExposedMethod("createConversation")).toBe(true);
    expect(isExposedMethod("sendConversationTurn")).toBe(true);
    expect(isExposedMethod("getCouncil")).toBe(true);
    expect(isExposedMethod("observeWorker")).toBe(true);
    expect(isExposedMethod("advanceWorkerIntegration")).toBe(true);
    expect(isExposedMethod("getEvidenceDump")).toBe(true);
    expect(isExposedMethod("generateConcertmasterReport")).toBe(true);
  });
  ```

- [ ] **Step 2: Run the bridge tests and confirm RED.**

  ```bash
  npx vitest run apps/carnegie/electron/apiBridge.test.ts
  ```

  Expected: failure for at least the currently missing methods.

- [ ] **Step 3: Extend the explicit allow-list and generated renderer type.**

  Add only the methods backed by `ApiClient` and used by a planned Carnegie surface. Keep `streamEvents` on the existing `events.subscribe` bridge. Keep credentials in the main process.

- [ ] **Step 4: Run bridge tests and the Carnegie build.**

  ```bash
  npx vitest run apps/carnegie/electron/apiBridge.test.ts
  cd apps/carnegie && npm run build
  ```

- [ ] **Step 5: Commit the bridge slice.**

  ```bash
  git add apps/carnegie/electron/apiBridge.ts apps/carnegie/electron/preload.cts apps/carnegie/src/global.d.ts apps/carnegie/electron/apiBridge.test.ts
  git commit -m "feat(carnegie): expose full project execution API safely"
  ```

**Acceptance:** A renderer can call every method required by the E5 vertical slice, cannot call arbitrary methods, and cannot read plaintext connection credentials.

---

## Task 1.5: Zero-config local bootstrap on launch

**Added 2026-09-21, operator instruction:** "GUI를 켜자마자 GUI만 켜도 추가적인 연결 등등 없이 쓸 수 있도록" — opening Carnegie must be enough by itself, with no separate manual step to start a Control Plane, database, or provider gateway first.

**Why this is now Task 1.5, not a later task:** every live-run blocker recorded in `execution/PENDING_LIVE_CHECKS.md` for plan-E5 so far (`no MAESTRO_TEST_DATABASE_URL`, `no Control Plane/provider listener`, the Task 3 Step 8 live attempt failing with `Control plane request failed`) is a **manual-setup-not-done** problem, not a genuine missing-capability problem — `packages/local-backend/src/local-bootstrap.ts` (955 lines, already implemented and unit-tested: `resolveLocalConnection`, `ensureLocalControlPlane`, embedded-Postgres and Docker-Postgres paths, `buildLocalControlPlaneEnvironment`/`buildLocalModelGatewayEnvironment`, a five-step bootstrap sequence `LOCAL_BOOTSTRAP_STEP_ORDER = ["docker-check", "postgres-ready", "migrations", "control-plane-up", "model-gateway-up"]`, and a `LocalSecretStore` for the generated token) is a **complete, tested, already-built local-stack launcher that Carnegie's Electron main process never calls.**

**Confirmed gap (read, not guessed):** `apps/carnegie/electron/store.ts` imports only `createLocalSecretStore` from `@maestro/local-backend` — for token storage, nothing else. `apps/carnegie/electron/main.ts`'s `maestro:config:get` handler only ever calls `loadConnectionConfig()` (a previously *manually saved* config) and returns `undefined` if none exists, at which point `App.tsx`'s `Connected()` renders `<Setup />` and blocks on the operator typing an API URL/token/project ID by hand. `resolveLocalConnection`/`ensureLocalControlPlane` are never imported or called anywhere in `apps/carnegie/electron/**`.

**Files:**
- Modify: `apps/carnegie/electron/main.ts` (the `maestro:config:get`/app-ready path)
- Inspect, do not duplicate: `packages/local-backend/src/local-bootstrap.ts`, `local-control-plane.ts`, `connection.ts`
- Create (if the design needs one): a small orchestration module, e.g. `apps/carnegie/electron/local-launch.ts`, that calls `resolveLocalConnection` and adapts its `ConnectionState`/`onStep` events to what `main.ts` and the renderer need
- Modify: `apps/carnegie/src/connection.tsx` (loading state should reflect real bootstrap step progress, not just a boolean)
- Modify: `apps/carnegie/src/views/Setup.tsx` (becomes the genuine-failure fallback, not the default first screen)
- Test: unit tests for the new orchestration module; keep `local-bootstrap.test.ts`'s existing coverage as the source of truth for `resolveLocalConnection` itself — do not re-test its internals here

**Design constraints:**
- On app ready, before ever showing `<Setup />`, call `resolveLocalConnection` with a real `ConnectionEnvironment` (respecting any operator-set `MAESTRO_API_URL`/`MAESTRO_LOCAL_DATABASE_URL`/etc. env overrides — never silently ignore an explicit operator configuration in favor of auto-bootstrap).
- Stream `onStep` bootstrap events (`docker-check` → `postgres-ready` → `migrations` → `control-plane-up` → `model-gateway-up`) to the renderer so the UI can show real progress ("starting local database…", "running migrations…") instead of a blank/frozen window during what may be a several-second first-run cold start.
- On `{ kind: "configured", ... }`: save/use that config exactly as if the operator had typed it into `Setup.tsx` — same `saveConnectionConfig`/`connect` path, no second code path.
- On `{ kind: "setup-required", reason }`: **this** is when `Setup.tsx` should appear, now pre-filled with the concrete `reason` (e.g., "Docker is not available and no packaged Control Plane was found") so the operator isn't blankly asked to type a URL for a problem that has nothing to do with a URL.
- `includeProjectId` (an existing `LocalBootstrapOptions` field): use it so a fresh local install gets a real default project auto-provisioned too — the operator should not need to separately create a project before Task 3's conversation flow works.
- Never start a second, competing local Control Plane/database if one is already reachable — `resolveLocalConnection` already needs to own this reuse-vs-launch decision; do not reimplement that logic at the Electron layer.
- This must not weaken `Setup.tsx`'s existing ability to point at a real remote/shared Control Plane — auto-bootstrap is the *default first-run path*, not the only path. An operator who wants to connect elsewhere must still be able to, via `Setup.tsx` or a "use a different Control Plane" escape hatch.

**Acceptance:** a completely fresh install/launch of Carnegie — no prior `maestro:config:save`, no manually-started Control Plane, no manually-started database — reaches a connected, usable Home/Dashboard without the operator typing anything, using only what `resolveLocalConnection` can start itself (embedded/Docker Postgres, migrations, Control Plane, Model Gateway). `Setup.tsx` is reached only when auto-bootstrap genuinely cannot succeed (e.g., no Docker and no packaged binaries found), with the real reason shown, not a generic "not connected" message.

**Side effect worth noting for whoever picks this up:** once this lands, most of `PENDING_LIVE_CHECKS.md`'s current plan-E5 blockers (empty `MAESTRO_TEST_DATABASE_URL`, no Control Plane/provider listener) stop being environment gaps this sandbox can't fix — they become "launch Carnegie and let Task 1.5 do its job" instead. Re-attempt Task 3 Step 8's live conversation and Task 14 after this task closes, in whatever environment has Docker or a packaged Control Plane binary available (this specific sandbox may still lack both — check before assuming this alone unblocks every live check).

---

## Task 2: Add shared renderer action, error, confirmation, and reconnect primitives

**Files:**
- Create: `apps/carnegie/src/components/AsyncState.tsx`
- Create: `apps/carnegie/src/components/ConfirmActionDialog.tsx`
- Create: `apps/carnegie/src/components/ApiErrorNotice.tsx`
- Create: `apps/carnegie/src/lib/command-id.ts`
- Modify: `apps/carnegie/src/useDurableEvents.ts`
- Modify: `apps/carnegie/src/App.tsx`
- Test: `apps/carnegie/src/components/AsyncState.test.tsx`
- Test: `apps/carnegie/src/components/ConfirmActionDialog.test.tsx`
- Test: `apps/carnegie/src/lib/command-id.test.ts`

**Interfaces:**

```ts
export function newCommandId(): string;
export function classifyApiError(error: unknown): { title: string; detail: string; retryable: boolean };
export function ConfirmActionDialog(props: {
  open: boolean;
  title: string;
  effectSummary: string;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}): JSX.Element | null;
```

- [ ] **Step 1: Write tests for stable error classification and explicit confirmation.**

  Cover `ApiError` status/code extraction, stale-version errors as retryable, authority denial as non-retryable until approval, missing connection as actionable, and dialog keyboard cancel/confirm behavior.

- [ ] **Step 2: Run the focused tests and confirm RED.**

  ```bash
  npx vitest run apps/carnegie/src/components/AsyncState.test.tsx apps/carnegie/src/components/ConfirmActionDialog.test.tsx apps/carnegie/src/lib/command-id.test.ts
  ```

- [ ] **Step 3: Implement the primitives without adding a state library.**

  Reuse the existing CSS tokens and `ApiError` type. Generate command IDs with `crypto.randomUUID()`. Make the dialog focusable, labelled, keyboard-operable, and impossible to confirm by accidental Enter on an unrelated control.

- [ ] **Step 4: Add reconnect visibility to the existing durable event stream.**

  Preserve the last durable cursor, show stale state while reconnecting, and let each affected screen retry without resetting the selected Goal.

- [ ] **Step 5: Run tests, renderer typecheck, and build.**

  ```bash
  npx vitest run apps/carnegie/src/components/AsyncState.test.tsx apps/carnegie/src/components/ConfirmActionDialog.test.tsx apps/carnegie/src/lib/command-id.test.ts
  cd apps/carnegie && npm run build
  ```

- [ ] **Step 6: Commit.**

  ```bash
  git add apps/carnegie/src/components apps/carnegie/src/lib/command-id.ts apps/carnegie/src/useDurableEvents.ts apps/carnegie/src/App.tsx
  git commit -m "feat(carnegie): add shared safe action states"
  ```

**Acceptance:** Every later screen can show loading, stale, retryable failure, authority denial, and explicit confirmation using one tested pattern.

---

## Task 3: Finish the real Concertmaster conversation and Task Contract flow

**Files:**
- Modify: `apps/carnegie/src/views/Home.tsx`
- Modify: `apps/carnegie/src/lib/task-contract-authoring.ts`
- Modify: `apps/carnegie/src/global.d.ts`
- Create: `apps/carnegie/src/lib/conversation-data.ts`
- Test: `apps/carnegie/src/lib/task-contract-authoring.test.ts`
- Test: `apps/carnegie/src/lib/conversation-data.test.ts`
- Test: `apps/carnegie/src/views/Home.test.tsx`

**Interfaces:**

```ts
export type GoalLessIntakeApi = Pick<ApiClient,
  "listModels" | "createConversation" | "getConversation" |
  "listConversationEvents" | "sendConversationTurn" | "cancelConversation"
>;

export type ConversationMessage = {
  id: string;
  role: "operator" | "concertmaster" | "system";
  content: string;
  createdAt: string;
};

export async function loadConversation(
  api: GoalLessIntakeApi,
  input: { conversationId: string; projectId: string },
): Promise<ConversationMessage[]>;
```

- [ ] **Step 1: Add RED tests for the complete no-Goal path.**

  Test that Home creates a conversation only once, sends real turns with idempotency keys, renders the real assistant response, parses a valid `TaskContract` draft, keeps non-JSON responses visible without fabricating a draft, and reloads a conversation from durable events.

- [ ] **Step 2: Add RED tests for draft safety.**

  Test edit → `updateTaskContract(expectedVersion)` → exact hash confirmation → separate `launchTaskContract`, including stale-version failure and launch failure. Test that a confirmed draft cannot be edited and a launched draft cannot be launched twice.

- [ ] **Step 3: Run the focused tests and confirm RED.**

  ```bash
  npx vitest run apps/carnegie/src/lib/task-contract-authoring.test.ts apps/carnegie/src/lib/conversation-data.test.ts apps/carnegie/src/views/Home.test.tsx
  ```

- [ ] **Step 4: Implement the conversation transcript and follow-up composer.**

  Keep the selected Goal optional. For no Goal, use `createConversation({ projectId, goalId: null, model })`, then `sendConversationTurn`. For a selected Goal, preserve the existing direct Task Contract authoring path unless the Control Plane contract explicitly supports a Goal-attached conversation. Display conversation ID, turn status, real response, and retry action.

- [ ] **Step 5: Implement the review/confirm/launch state machine.**

  Use the existing `submitHomeBrief`, `updateTaskContractDraft`, `confirmTaskContractDraft`, and `launchTaskContractDraft` helpers. Do not replace server version/content-hash checks with client-only state. Add visible transition labels: `conversation`, `draft`, `confirmed`, `launched`, `rejected`.

- [ ] **Step 6: Add an explicit “continue conversation” path after a non-draft response.**

  The operator must be able to answer the Concertmaster instead of being forced to create a local placeholder draft. A local draft is allowed only when the server returns a valid contract or when the existing attached-Goal contract explicitly permits direct authoring.

- [ ] **Step 7: Run the focused tests and Carnegie build.**

  ```bash
  npx vitest run apps/carnegie/src/lib/task-contract-authoring.test.ts apps/carnegie/src/lib/conversation-data.test.ts apps/carnegie/src/views/Home.test.tsx
  cd apps/carnegie && npm run build
  ```

- [ ] **Step 8: Perform the first real Electron conversation.**

  Start Carnegie with the existing CDP command, connect to a real project, enter a bounded non-destructive request, read the real Concertmaster response, and save the screenshot plus conversation/contract IDs. If the Control Plane reports `Durable store is unavailable` or another real blocker, record it verbatim in `execution/PENDING_LIVE_CHECKS.md`.

- [ ] **Step 9: Commit.**

  ```bash
  git add apps/carnegie/src/views/Home.tsx apps/carnegie/src/lib/task-contract-authoring.ts apps/carnegie/src/lib/conversation-data.ts apps/carnegie/src/global.d.ts apps/carnegie/src/**/*.test.tsx apps/carnegie/src/**/*.test.ts
  git commit -m "feat(carnegie): complete Concertmaster task intake flow"
  ```

**Acceptance:** An operator can speak to the real assistant, see the real response, review/edit a real Task Contract, confirm its exact server version/hash, and launch it through two explicit actions. No fake assistant message or fake launch is possible.

---

## Task 4: Make Goal creation, selection, Dashboard, projection, and lifecycle real

**Files:**
- Modify: `apps/carnegie/src/goals.tsx`
- Modify: `apps/carnegie/src/views/Dashboard.tsx`
- Modify: `apps/carnegie/src/views/Floor.tsx`
- Modify: `apps/carnegie/src/lib/goal-control.ts`
- Create: `apps/carnegie/src/lib/goal-operations.ts`
- Test: `apps/carnegie/src/lib/goal-control.test.ts`
- Test: `apps/carnegie/src/lib/goal-operations.test.ts`
- Test: `apps/carnegie/src/views/Dashboard.test.tsx`

**Interfaces:**

```ts
export async function loadGoalsAfterLaunch(
  api: Pick<ApiClient, "listGoals">,
  input: { projectId: string },
): Promise<GoalList>;

export async function runGoalControlAction(
  api: Pick<ApiClient, "pauseGoal" | "resumeGoal" | "stopGoal" | "emergencyStopGoal">,
  input: { goalId: string; projectId: string; action: GoalControlAction; expectedVersion: number },
): Promise<GoalResult>;
```

- [ ] **Step 1: Add RED tests for selected Goal persistence and refresh.**

  Cover initial selection, explicit selection changes, selected Goal disappearing, refresh after a durable event, and retaining selection during reconnect.

- [ ] **Step 2: Add RED tests for all lifecycle actions.**

  Assert exact input shape, expected version, command ID, confirmation requirement for stop/emergency-stop, and a refresh after success. Assert stale version and authority denial are rendered as actionable errors rather than generic failure.

- [ ] **Step 3: Run focused tests and confirm RED.**

  ```bash
  npx vitest run apps/carnegie/src/lib/goal-control.test.ts apps/carnegie/src/lib/goal-operations.test.ts apps/carnegie/src/views/Dashboard.test.tsx
  ```

- [ ] **Step 4: Implement real Goal creation/selection and lifecycle controls.**

  Use `createGoal` only when the server contract says the launched contract produces a Goal directly; otherwise read the resulting Goal from the durable event/projection. Never invent a local Goal ID. Add explicit confirmations for stop and emergency-stop.

- [ ] **Step 5: Render durable projection sections.**

  The Dashboard must show Goal state, durable version, budget, workers, certifications, evidence, Metronome, Encore, final report, and stale/reconnect status from their real methods. The Floor must use `getProjection` with the selected Goal and current event cursor.

- [ ] **Step 6: Run tests and build.**

  ```bash
  npx vitest run apps/carnegie/src/lib/goal-control.test.ts apps/carnegie/src/lib/goal-operations.test.ts apps/carnegie/src/views/Dashboard.test.tsx
  cd apps/carnegie && npm run build
  ```

- [ ] **Step 7: Live-check Goal lifecycle.**

  On a disposable or explicitly bounded real Goal, select it, pause/resume it, and verify the durable version and event cursor change. Do not stop or emergency-stop a real operator Goal without explicit confirmation. Record unavailable operations honestly.

- [ ] **Step 8: Commit.**

  ```bash
  git add apps/carnegie/src/goals.tsx apps/carnegie/src/views/Dashboard.tsx apps/carnegie/src/views/Floor.tsx apps/carnegie/src/lib/goal-control.ts apps/carnegie/src/lib/goal-operations.ts
  git commit -m "feat(carnegie): drive real goal lifecycle and projection"
  ```

**Acceptance:** Goal state is durable and refreshable; lifecycle actions reach the real Control Plane with concurrency and authority safeguards; Dashboard and Floor never show locally invented operational state.

---

## Task 5: Add the Overture → Head → Council → Department Plan → Mission Bundle flow

**Files:**
- Create: `apps/carnegie/src/views/Planning.tsx`
- Create: `apps/carnegie/src/lib/planning-data.ts`
- Modify: `apps/carnegie/src/views/Home.tsx`
- Modify: `apps/carnegie/src/views/Dashboard.tsx`
- Modify: `apps/carnegie/src/views.ts`
- Modify: `apps/carnegie/src/components/Sidebar.tsx`
- Test: `apps/carnegie/src/lib/planning-data.test.ts`
- Test: `apps/carnegie/src/views/Planning.test.tsx`

**Interfaces:**

```ts
export type PlanningApi = Pick<ApiClient,
  "selectOvertureRoles" | "activateHead" | "createCouncil" |
  "getCouncil" | "submitCouncilBrief" | "revealCouncil" | "decideCouncil" |
  "getDepartmentPlan" | "getMissionBundle" | "createDepartmentPlan" | "createMissionBundle"
>;

export type PlanningStage = "overture" | "head" | "council" | "department-plan" | "mission-bundle" | "ready-for-worker";
```

- [ ] **Step 1: Add RED tests for stage transitions and server IDs.**

  Test that each stage uses the ID produced by the previous stage, does not permit a later action before its prerequisite, passes project/Goal scope, sends command IDs, and reloads each stage through a durable GET method.

- [ ] **Step 2: Run focused tests and confirm RED.**

  ```bash
  npx vitest run apps/carnegie/src/lib/planning-data.test.ts apps/carnegie/src/views/Planning.test.tsx
  ```

- [ ] **Step 3: Implement Overture role selection.**

  Show the server's available roles and selected roles. Submit via `selectOvertureRoles` and display the returned selection ID/version. Do not treat a local checkbox selection as accepted until the server returns success.

- [ ] **Step 4: Implement Head activation and Council creation.**

  Show department/Head status, call `activateHead` where the contract permits, create a Council with the selected Goal and departments, and display the Council's durable state.

- [ ] **Step 5: Implement brief/reveal/decide with explicit action state.**

  Provide separate buttons for submit brief, reveal, and decide. Show authority and validation errors next to the affected stage. Do not auto-reveal or auto-decide after a brief submission.

- [ ] **Step 6: Implement Department Plan and Mission Bundle reads/actions.**

  Render plan version, item IDs, dependencies, scope, worker inputs, and stopping conditions. Call `getDepartmentPlan` and `getMissionBundle`; use creation methods only where the server contract requires an explicit command.

- [ ] **Step 7: Link planning output to the Worker screen.**

  The “ready for worker” action must carry real `councilId`, `departmentId`, `planVersion`, and `itemId`; it must not use sample IDs.

- [ ] **Step 8: Run tests, build, and commit.**

  ```bash
  npx vitest run apps/carnegie/src/lib/planning-data.test.ts apps/carnegie/src/views/Planning.test.tsx
  cd apps/carnegie && npm run build
  git add apps/carnegie/src/views/Planning.tsx apps/carnegie/src/lib/planning-data.ts apps/carnegie/src/views/Home.tsx apps/carnegie/src/views/Dashboard.tsx apps/carnegie/src/views.ts apps/carnegie/src/components/Sidebar.tsx
  git commit -m "feat(carnegie): add durable planning workflow"
  ```

**Acceptance:** A real launched task can be progressed through the actual planning records without skipping a server stage or presenting a local-only plan.

---

## Task 6: Add real Worker execution inside the Secretary Office conversation surface

**Design correction:** The approved mockup and Phase 7/Phase 2 design do not define a standalone Worker CRUD screen or a top-level Worker navigation item. Workers are temporary, Goal-bound participants. The operator sees their durable activity in the selected Department Channel and opens Worker detail from the Channel roster. Dashboard and Floor summarize execution; Channel is the conversational surface; Inbox remains the approval surface; Git/Evidence remain lineage surfaces.

**Files:**
- Create: `apps/carnegie/src/views/Workers.tsx` (contextual Worker detail/operations panel, not a primary navigation route)
- Create: `apps/carnegie/src/lib/worker-data.ts`
- Modify: `apps/carnegie/src/views/Channel.tsx`
- Modify: `apps/carnegie/src/useGoalWorkers.ts` (preserve same-scope stale roster during refresh)
- Test: `apps/carnegie/src/useGoalWorkers.test.ts`
- Modify: `apps/carnegie/src/views/Planning.tsx` (dispatch only the loaded Mission Bundle)
- Modify: `apps/carnegie/src/App.tsx` (pass the durable event cursor to Channel)
- Modify: `apps/carnegie/src/styles/components.css`
- Test: `apps/carnegie/src/lib/worker-data.test.ts`
- Test: `apps/carnegie/src/views/Workers.test.tsx`
- Modify/test as needed: `apps/carnegie/src/views/Channel.test.tsx`
- Modify/test as needed: `apps/carnegie/src/views/Planning.test.tsx`

**Interfaces:**

```ts
export type WorkerApi = Pick<ApiClient,
  "spawnWorker" | "getWorker" | "observeWorker" | "sendWorkerMessage" |
  "cancelWorker" | "listWorkersForGoal" | "createWorkerWorktree"
>;

export async function loadWorkers(api: WorkerApi, goalId: string, projectId: string): Promise<WorkerList>;
export async function spawnWorkerFromMissionBundle(
  api: Pick<WorkerApi, "spawnWorker">,
  projectId: string,
  bundle: MissionBundle,
  commandId?: string,
): Promise<Worker>;
export function missionBundleMatchesWorker(bundle: MissionBundle, worker: Worker): boolean;
export async function loadWorkerObservation(api: Pick<WorkerApi, "listWorkersForGoal" | "getWorker" | "observeWorker">, workerId: string, scope: WorkerActionScope, commandId?: string): Promise<WorkerObservation>;
export async function sendWorkerMessage(api: Pick<WorkerApi, "listWorkersForGoal" | "getWorker" | "sendWorkerMessage">, workerId: string, scope: WorkerActionScope, message: string, commandId?: string): Promise<Worker>;
export type WorkerActionScope = { goalId: string; projectId: string; bundle: MissionBundle };
export async function cancelWorkerAfterConfirmation(
  api: Pick<WorkerApi, "listWorkersForGoal" | "getWorker" | "cancelWorker">,
  workerId: string,
  scope: WorkerActionScope,
  confirmed: boolean,
  commandId?: string,
): Promise<Worker>;
```

- [x] **Step 1: Add RED tests for Worker identity, scope, and conversation placement.**

  Assert that a Worker is spawned only from real Mission Bundle council/department/plan/item identity, that worker list entries reload through `listWorkersForGoal`, that observation uses `getWorker`/`observeWorker`, and that messages carry the selected Worker ID, project scope, and command ID. Assert that the Worker surface is opened from the Channel roster and does not become a new top-level sidebar item. Assert that only durable Channel messages and Worker observations/tool events are rendered; the renderer must not fabricate agent-to-agent messages.

- [x] **Step 2: Add RED tests for cancellation and stale Worker state.**

  Require explicit confirmation, reject cancellation of an already terminal Worker without pretending success, reject a Mission Bundle whose content hash or scope does not match the selected Worker, and refresh after cancellation. A stale or disconnected read must remain visibly stale and must not clear a newer durable Worker state.

- [x] **Step 3: Run focused tests and confirm RED.**

  ```bash
  npx vitest run apps/carnegie/src/lib/worker-data.test.ts apps/carnegie/src/useGoalWorkers.test.ts apps/carnegie/src/views/Workers.test.tsx apps/carnegie/src/views/Channel.test.tsx apps/carnegie/src/views/Planning.test.tsx
  ```

- [x] **Step 4: Implement the contextual Worker detail surface.**

  Keep the Channel feed as the primary conversation. Dispatch is available only from the already loaded Mission Bundle in Planning, and the resulting Worker becomes selectable from the Goal-scoped Channel roster after the durable event arrives. Show status, durable identity, department, mission item, Mission Bundle content hash, lease/fencing state if returned, latest observation, tool activity, cost/budget when returned, terminal reason, and a real empty state. Use progressive disclosure; do not add a Worker management route or wake a Worker just to inspect its durable profile.

- [x] **Step 5: Implement scoped operations.**

  Planning's `spawnWorker` action must receive the actual loaded Mission Bundle council/department identity and a schema-valid server-defined `SpawnWorkerInput`; the operator cannot type those IDs. `observeWorker`, `sendWorkerMessage`, and cancellation must revalidate the current Goal roster Worker against the loaded Mission Bundle and project scope before the effect; UI-only checks are insufficient. Worker messages and bounded cross-worker coordination are displayed only through durable Goal-scoped channel/observation data. Do not post a fake worker-authored Channel message from the renderer. Use explicit confirmation for cancellation and preserve the server's terminal/unknown result.

- [x] **Step 6: Implement durable refresh.**

  Refresh the selected channel and Worker roster from the durable event cursor and provide a manual retry. Do not poll aggressively or replace newer durable state with an older response. When the existing backend does not yet project a Worker-originated message into Channel history, record that exact backend dependency instead of simulating it.

- [x] **Step 7: Run tests, build, and commit.**

  ```bash
  npx vitest run apps/carnegie/src/lib/worker-data.test.ts apps/carnegie/src/useGoalWorkers.test.ts apps/carnegie/src/views/Workers.test.tsx apps/carnegie/src/views/Channel.test.tsx apps/carnegie/src/views/Planning.test.tsx
  cd apps/carnegie && npm run build
  git add apps/carnegie/src/views/Workers.tsx apps/carnegie/src/lib/worker-data.ts apps/carnegie/src/useGoalWorkers.ts apps/carnegie/src/useGoalWorkers.test.ts apps/carnegie/src/views/Channel.tsx apps/carnegie/src/views/Planning.tsx apps/carnegie/src/App.tsx apps/carnegie/src/styles/components.css apps/carnegie/src/lib/worker-data.test.ts apps/carnegie/src/views/Workers.test.tsx apps/carnegie/src/views/Channel.test.tsx apps/carnegie/src/views/Planning.test.tsx execution/plan-E5-gui-implementation.md
  git commit -m "feat(carnegie): add real worker operations"
  ```

**Acceptance:** Planning can dispatch only the loaded real Mission Bundle; the Secretary Office then shows that Worker in the Goal-scoped Channel roster, where the operator can observe its durable status, send a real scoped message, and cancel it through the authority path. The interface visibly supports durable agent conversation without inventing messages or introducing a standalone Worker CRUD surface.


## Task 7: Add Git integration, worktree, acceptance, certification, and evidence

**Implementation status (2026-09-22):** The slice is implemented and merged as `7767f2ff`. Focused Carnegie coverage passed 4 files / 17 tests, changed-file ESLint and `git diff --check` passed. The full Carnegie build remains blocked by the pre-existing missing `@playwright/test` and `@earendil-works/pi-tui` dependencies plus unrelated CLI type errors; this does not claim the overall E5 completion gate.

**Files:**
- Modify: `apps/carnegie/src/views/Git.tsx`
- Modify: `apps/carnegie/src/views/EvidenceLog.tsx`
- Modify: `apps/carnegie/src/views/Inbox.tsx`
- Create: `apps/carnegie/src/views/WorkerReview.tsx`
- Create: `apps/carnegie/src/lib/integration-data.ts`
- Test: `apps/carnegie/src/lib/integration-data.test.ts`
- Test: `apps/carnegie/src/views/Git.test.tsx`
- Test: `apps/carnegie/src/views/WorkerReview.test.tsx`

**Interfaces:**

```ts
export type IntegrationApi = Pick<ApiClient,
  "createGoalIntegrationBranch" | "createDepartmentBranch" |
  "createWorkerWorktree" | "advanceWorkerIntegration" |
  "freezeGoalIntegrationRevision" | "getGitIntegrationState" |
  "acceptWorker" | "certifyWorker" | "certifyConditionalWorker" |
  "captureEvidence" | "getEvidenceBundle" | "getEvidenceDump" |
  "listCertifications"
>;
```

- [ ] **Step 1: Add RED tests for branch/worktree identity.**

  Test that Goal integration branch creation is scoped to the selected Goal and base revision, Worker worktree creation uses the real Worker ID, and integration advances cannot run without the server's current revision/input.

- [ ] **Step 2: Add RED tests for review gates.**

  Require real evidence and test results before acceptance/certification UI enables. Verify conditional certification displays its condition and never looks like a passed certification.

- [ ] **Step 3: Run focused tests and confirm RED.**

  ```bash
  npx vitest run apps/carnegie/src/lib/integration-data.test.ts apps/carnegie/src/views/Git.test.tsx apps/carnegie/src/views/WorkerReview.test.tsx
  ```

- [ ] **Step 4: Implement Git state and integration actions.**

  Add controls for creating the Goal branch, department branch, Worker worktree, advancing integration, and freezing a revision only when the corresponding backend state allows it. Render repository path, branch, base revision, frozen revision, commit SHA, and rejection reason from the API.

- [ ] **Step 5: Implement Worker acceptance and certification.**

  Show evidence bundle, test output references, diff/integration state, and the exact certification input before enabling `acceptWorker`, `certifyWorker`, or `certifyConditionalWorker`. Require explicit review confirmation.

- [ ] **Step 6: Implement evidence capture and read-only evidence dump.**

  Add `captureEvidence` only for the documented evidence input. Render `getEvidenceBundle`, `listCertifications`, and `getEvidenceDump` as durable records. Do not allow editing or deleting evidence.

- [ ] **Step 7: Run tests, build, and commit.**

  ```bash
  npx vitest run apps/carnegie/src/lib/integration-data.test.ts apps/carnegie/src/views/Git.test.tsx apps/carnegie/src/views/WorkerReview.test.tsx
  cd apps/carnegie && npm run build
  git add apps/carnegie/src/views/Git.tsx apps/carnegie/src/views/EvidenceLog.tsx apps/carnegie/src/views/Inbox.tsx apps/carnegie/src/views/WorkerReview.tsx apps/carnegie/src/lib/integration-data.ts
  git commit -m "feat(carnegie): connect git evidence and certification workflow"
  ```

**Acceptance:** A Worker can progress from real worktree/integration state to real acceptance and certification, and the evidence log shows immutable durable records.

---

## Task 8: Complete approval, authority, Inbox, and Concertmaster discussion

**Implementation status (2026-09-22):** The slice is implemented and merged as `e3f5645a` (RED tests) and `9cdf98ae` (GREEN). Focused coverage passed 4 files / 12 tests; changed-file ESLint passed. The full Carnegie build remains blocked by the documented baseline dependency/type errors; this does not claim the overall E5 completion gate.

**Files:**
- Modify: `apps/carnegie/src/views/Inbox.tsx`
- Create: `apps/carnegie/src/views/Approvals.tsx`
- Create: `apps/carnegie/src/lib/approval-data.ts`
- Modify: `apps/carnegie/src/lib/inbox-data.ts`
- Test: `apps/carnegie/src/lib/approval-data.test.ts`
- Test: `apps/carnegie/src/views/Inbox.test.tsx`
- Test: `apps/carnegie/src/views/Approvals.test.tsx`

**Interfaces:**

```ts
export type ApprovalApi = Pick<ApiClient,
  "listInbox" | "requestCriticalAction" | "approveAndRunCriticalAction" |
  "denyCriticalAction" | "selectFullAccessMode" | "createConversation" |
  "sendConversationTurn"
>;
```

- [ ] **Step 1: Add RED tests for approval expiry and idempotency.**

  Cover expired approval rejection, wrong command ID rejection, double approval handling, denial, and discussion with the Concertmaster retaining Goal/project scope.

- [ ] **Step 2: Add RED tests for authority escalation.**

  Show the requested effect, capability scope, duration, and reason. Require explicit selection before `selectFullAccessMode`; never treat a UI toggle as an active capability session before the server confirms it.

- [ ] **Step 3: Run focused tests and confirm RED.**

  ```bash
  npx vitest run apps/carnegie/src/lib/approval-data.test.ts apps/carnegie/src/views/Inbox.test.tsx apps/carnegie/src/views/Approvals.test.tsx
  ```

- [ ] **Step 4: Implement Inbox grouping.**

  Group pending critical actions, worker/certification decisions, and Concertmaster discussions. Each item must show target, effect, reason, scope, expiry, and current state from `listInbox`.

- [ ] **Step 5: Implement request/approve/deny/full-access flows.**

  Use the existing `approveInboxItem` and `denyInboxItem` patterns, but show the exact command and expiry values used. Route approval through `approveAndRunCriticalAction`; route denial through `denyCriticalAction`.

- [ ] **Step 6: Implement real discussion.**

  Create or resume a scoped conversation and render the actual assistant response. Do not use a local canned answer. Preserve the pending approval while discussion is open.

- [ ] **Step 7: Run tests, build, and commit.**

  ```bash
  npx vitest run apps/carnegie/src/lib/approval-data.test.ts apps/carnegie/src/views/Inbox.test.tsx apps/carnegie/src/views/Approvals.test.tsx
  cd apps/carnegie && npm run build
  git add apps/carnegie/src/views/Inbox.tsx apps/carnegie/src/views/Approvals.tsx apps/carnegie/src/lib/approval-data.ts apps/carnegie/src/lib/inbox-data.ts
  git commit -m "feat(carnegie): complete approval and authority workflows"
  ```

**Acceptance:** A real critical action can be requested, discussed, approved and run, or denied, with expiry, scope, authority, and durable state visible to the operator.

---

## Task 9: Make Channel, durable events, and live refresh useful for project progress

**Implementation status (2026-09-22):** The slice is implemented and merged as `7953a180` (RED tests) and `0f722726` (GREEN). Focused coverage passed 3 files / 16 tests; changed-file ESLint and `git diff --check` passed. The full Carnegie build remains blocked by the documented baseline dependency/type errors; this does not claim the overall E5 completion gate.

**Files:**
- Modify: `apps/carnegie/src/views/Channel.tsx`
- Modify: `apps/carnegie/src/useDurableEvents.ts`
- Modify: `apps/carnegie/src/views/EvidenceLog.tsx`
- Create: `apps/carnegie/src/lib/event-data.ts`
- Test: `apps/carnegie/src/lib/event-data.test.ts`
- Test: `apps/carnegie/src/views/Channel.test.tsx`

**Interfaces:**

```ts
export type EventApi = Pick<ApiClient, "getChannel" | "postChannelMessage" | "listEvents">;
export async function loadEventPage(api: EventApi, query: EventQuery): Promise<GoalEventPage>;
```

- [ ] **Step 1: Add RED tests for channel scope and message idempotency.**

  Assert selected Goal/project/channel selector are passed exactly, Enter submits one message, retries reuse the same command ID only when the API contract says the request is retry-safe, and errors leave the draft text intact.

- [ ] **Step 2: Add RED tests for event cursor handling.**

  Assert out-of-order events do not overwrite newer state, reconnect resumes from the last durable cursor, and stale state is announced accessibly.

- [ ] **Step 3: Run focused tests and confirm RED.**

  ```bash
  npx vitest run apps/carnegie/src/lib/event-data.test.ts apps/carnegie/src/views/Channel.test.tsx
  ```

- [ ] **Step 4: Implement live Channel refresh and roster actions.**

  Replace clickable non-button roster toggle with a labelled button. Refresh the selected channel after a successful message and on relevant durable events. Keep all message content server-backed.

- [ ] **Step 5: Implement event filtering and evidence links.**

  Let the operator filter by Goal, event type, cursor range, and time window using `EventQuery`. Link execution/certification events to the relevant Worker, Git, Evidence, Inbox, or Dashboard state.

- [ ] **Step 6: Run tests, build, and commit.**

  ```bash
  npx vitest run apps/carnegie/src/lib/event-data.test.ts apps/carnegie/src/views/Channel.test.tsx
  cd apps/carnegie && npm run build
  git add apps/carnegie/src/views/Channel.tsx apps/carnegie/src/useDurableEvents.ts apps/carnegie/src/views/EvidenceLog.tsx apps/carnegie/src/lib/event-data.ts
  git commit -m "feat(carnegie): connect live channels and durable event refresh"
  ```

**Acceptance:** Operators can communicate in a real Goal channel and see durable project progress update without losing messages or cursor ordering.

---

## Task 10: Complete settings, provider/model configuration, billing, budget, and session recovery

**Implementation status (2026-09-22):** The slice is implemented and merged as `3b945b89`. Settings/Billing coverage passed 3 files / 22 tests and connection recovery coverage passed 1 file / 5 tests; changed-file ESLint, secret scan, and `git diff --check` passed. The full Carnegie build remains blocked by the documented baseline dependency/type errors; the SettingsRead contract has no version field, so the UI does not invent one. This does not claim the overall E5 completion gate.

**Files:**
- Modify: `apps/carnegie/src/views/Settings.tsx`
- Modify: `apps/carnegie/src/views/Billing.tsx`
- Modify: `apps/carnegie/src/connection.tsx`
- Create: `apps/carnegie/src/lib/settings-data.ts`
- Test: `apps/carnegie/src/lib/settings-data.test.ts`
- Test: `apps/carnegie/src/views/Settings.test.tsx`
- Test: `apps/carnegie/src/views/Billing.test.tsx`

**Interfaces:**

```ts
export type SettingsApi = Pick<ApiClient,
  "getSettings" | "updateSettingsPreferences" | "updateSettingsModelPool" |
  "updateSettingsAuthorityDefaults" | "listModels" | "listProviderConnections" |
  "loginProvider" | "logoutProvider" | "getBudgetSummary" | "getBillingSummary"
>;
```

- [ ] **Step 1: Add RED tests for provider and settings writes.**

  Test optimistic state is not treated as saved, server-returned settings replace stale local state, provider tokens never render or enter logs, and failed updates leave the previous saved values visible.

- [ ] **Step 2: Add RED tests for billing/budget empty and error states.**

  Cover no Goal, no billing record, provider error, currency/cents formatting, and stale budget state.

- [ ] **Step 3: Run focused tests and confirm RED.**

  ```bash
  npx vitest run apps/carnegie/src/lib/settings-data.test.ts apps/carnegie/src/views/Settings.test.tsx apps/carnegie/src/views/Billing.test.tsx
  ```

- [ ] **Step 4: Implement settings/provider model pool.**

  Keep provider credential input in a secure form, submit to the main-process-backed API route, render only provider identity/status, and clear the input after a successful or failed submit. Add model availability checks before conversation creation.

- [ ] **Step 5: Implement authority defaults with visible safety copy.**

  Show current defaults and their effect. Require save confirmation for changes that raise authority. Display the server-returned settings version.

- [ ] **Step 6: Implement budget and billing reads.**

  Use `getBudgetSummary(goalId, query)` and `getBillingSummary(projectId)`; render reserved, actual, remaining, provider, and period fields exactly as returned. Never infer cost from UI-local timers.

- [ ] **Step 7: Test session recovery.**

  Clear/invalid session, API 401, durable store unavailable, and reconnect must each show a distinct recovery action without printing tokens.

- [ ] **Step 8: Run tests, build, and commit.**

  ```bash
  npx vitest run apps/carnegie/src/lib/settings-data.test.ts apps/carnegie/src/views/Settings.test.tsx apps/carnegie/src/views/Billing.test.tsx
  cd apps/carnegie && npm run build
  git add apps/carnegie/src/views/Settings.tsx apps/carnegie/src/views/Billing.tsx apps/carnegie/src/connection.tsx apps/carnegie/src/lib/settings-data.ts
  git commit -m "feat(carnegie): connect settings provider and billing state"
  ```

**Acceptance:** The operator can configure the real provider/model and authority settings, recover from connection failure, and read real budget/billing state without token leakage.

---

## Task 11: Complete Persona and Act 3 read-only surfaces without faking mutation

**Implementation status (2026-09-22):** The slice is implemented and merged as `96cd5782`. Focused coverage passed 4 files / 14 tests; changed-file ESLint and `git diff --check` passed. Persona active/candidate state and Act 3 evidence remain server-backed/read-only. The full Carnegie build remains blocked by the documented baseline dependency/type errors; this does not claim the overall E5 completion gate.

**Files:**
- Modify: `apps/carnegie/src/views/Persona.tsx`
- Modify: `apps/carnegie/src/views/Arrangements.tsx`
- Create: `apps/carnegie/src/lib/persona-data.ts`
- Test: `apps/carnegie/src/lib/persona-data.test.ts`
- Test: `apps/carnegie/src/views/Persona.test.tsx`
- Test: `apps/carnegie/src/views/Arrangements.test.tsx`

**Interfaces:**

```ts
export type PersonaApi = Pick<ApiClient, "getPersona" | "proposePersona" | "editPersonaCandidate">;
export type ArrangementApi = Pick<ApiClient, "getArrangements" | "listImprovementDigestsForGoal" | "listEncoreCouncilRounds">;
```

- [ ] **Step 1: Add RED tests for server-backed candidate editing.**

  Test `getPersona` load, `proposePersona`, `editPersonaCandidate`, candidate version conflicts, and the difference between a proposal and an active persona.

- [ ] **Step 2: Add RED tests for arrangement read-only truth.**

  Test active/candidate/Encore/negative-evidence tabs use `getArrangements` and do not enable a mutation that lacks a GUI/API contract.

- [ ] **Step 3: Run focused tests and confirm RED.**

  ```bash
  npx vitest run apps/carnegie/src/lib/persona-data.test.ts apps/carnegie/src/views/Persona.test.tsx apps/carnegie/src/views/Arrangements.test.tsx
  ```

- [ ] **Step 4: Implement Persona proposal/edit states.**

  Render current persona, candidate, version, status, rationale, and server errors. Use explicit “propose” and “save candidate edit” actions; do not label a candidate active until the backend says so.

- [ ] **Step 5: Implement Arrangements evidence links.**

  Show content hash, evaluation stages, metric deltas, rollout status, Council judgments, and negative evidence. Use an explicit Act 3 read-only badge.

- [ ] **Step 6: Run tests, build, and commit.**

  ```bash
  npx vitest run apps/carnegie/src/lib/persona-data.test.ts apps/carnegie/src/views/Persona.test.tsx apps/carnegie/src/views/Arrangements.test.tsx
  cd apps/carnegie && npm run build
  git add apps/carnegie/src/views/Persona.tsx apps/carnegie/src/views/Arrangements.tsx apps/carnegie/src/lib/persona-data.ts
  git commit -m "feat(carnegie): make persona and arrangement state truthful"
  ```

**Acceptance:** Persona and Act 3 data shown in Carnegie is real and versioned; unavailable mutation remains visibly unavailable instead of pretending to execute.

---

## Task 12: Make Luthiery and Flashmob honest, useful, and gate-safe

**Implementation status (2026-09-22):** The slice is implemented and merged as `92cdeb06`, with review-gap tests added in `58eb7902`. Focused coverage passed 3 files / 9 tests; changed-file ESLint and `git diff --check` passed. Luthiery is explicitly backend-blocked and Flashmob is explicitly out-of-scope/deferred with no fake Goal, Worker, progress, local registry, or promotion path. The delegated independent reviewer did not return before handoff; the identified gaps were fixed test-first and parent independent verification passed. The full Carnegie build remains blocked by the documented baseline dependency/type errors; this does not claim the overall E5 completion gate.

**Files:**
- Modify: `apps/carnegie/src/views/Luthiery.tsx`
- Modify: `apps/carnegie/src/views/Flashmob.tsx`
- Modify: `apps/carnegie/src/views/FlashmobSession.tsx`
- Modify: `apps/carnegie/src/views/Home.tsx`
- Test: `apps/carnegie/src/views/Luthiery.test.tsx`
- Test: `apps/carnegie/src/views/Flashmob.test.tsx`

- [ ] **Step 1: Add RED tests proving no illustrative state is presented as live.**

  Test that Flashmob example sessions are labelled as examples or replaced with an explicit deferred-feature state, the disabled composer cannot submit, and “promote to Goal” cannot create a Goal without a real backend method.

- [ ] **Step 2: Replace sample sessions with an honest deferred state.**

  Keep the screen navigable, but show the roadmap gate, missing durable contract, and the exact re-entry condition. Remove text that looks like a current active Worker or completed project.

- [ ] **Step 3: Keep Luthiery as a capability dependency view.**

  Show that no durable skill/tool registry API is exposed, list the required future contract (`listSkills`, `getSkill`, certification/usage reads), and disable mutation buttons. Do not create a local registry.

- [ ] **Step 4: Run tests and build.**

  ```bash
  npx vitest run apps/carnegie/src/views/Luthiery.test.tsx apps/carnegie/src/views/Flashmob.test.tsx
  cd apps/carnegie && npm run build
  ```

- [ ] **Step 5: Update the capability matrix and commit.**

  Mark these surfaces `backend-blocked` or `out-of-scope` with the roadmap citation and evidence path.

  ```bash
  git add apps/carnegie/src/views/Luthiery.tsx apps/carnegie/src/views/Flashmob.tsx apps/carnegie/src/views/FlashmobSession.tsx apps/carnegie/src/views/Home.tsx execution/e5-capability-matrix.md
  git commit -m "fix(carnegie): remove misleading deferred feature examples"
  ```

**Acceptance:** No user can mistake a sample Flashmob session or absent Luthiery registry for real project progress.

---

## Task 13: Accessibility, visual polish, responsive behavior, and window-scale verification

**Implementation status (2026-09-22):** The slice is implemented and merged as `fa4a4454` (RED checks) and `8e9f2ed2` (GREEN). Focused coverage passed 7 files / 34 tests; changed-file ESLint and `git diff --check` passed; Electron radial smoke passed. Playwright browser collection is blocked by missing `@playwright/test`, and the full Carnegie build retains the documented baseline dependency/type errors; no browser evidence is fabricated. This does not claim the overall E5 completion gate.

**Files:**
- Modify: `apps/carnegie/src/styles/components.css`
- Modify: `apps/carnegie/src/styles/index.css`
- Modify: affected views/components under `apps/carnegie/src/**`
- Modify: `apps/carnegie/playwright.config.ts`
- Create: `apps/carnegie/tests/e5-live-acceptance.spec.ts`
- Create: `apps/carnegie/tests/e5-a11y.spec.ts`
- Test: `apps/carnegie/src/setup-layout.test.ts`

- [ ] **Step 1: Add RED browser checks for keyboard and semantics.**

  Cover sidebar navigation, Home textarea, draft form labels, confirmation dialog focus, loading/error announcements, selected Goal state, channel send, approval actions, and native window controls through the existing Electron/CDP test setup.

- [ ] **Step 2: Run the browser checks and record current failures.**

  ```bash
  cd apps/carnegie && npx playwright test tests/e5-a11y.spec.ts --reporter=line
  ```

- [ ] **Step 3: Implement semantic controls and focus order.**

  Replace clickable `div` actions with buttons, add labels and `aria-describedby` for effect summaries, preserve focus after modal close, and mark live updates with `role=status` or `role=alert` only where appropriate.

- [ ] **Step 4: Implement responsive states.**

  Verify 1280px, 1920px, and the observed 2879px viewport; verify narrow content widths without horizontal clipping; keep the frameless header and controls usable.

- [ ] **Step 5: Verify zoom without changing backend behavior.**

  Apply the agreed Electron page zoom at load, preserve `Ctrl +/-/0`, and verify text/button sizing with a real Electron capture. Do not globally inflate CSS values as a substitute for page-scale behavior.

- [ ] **Step 6: Run build, browser accessibility, and visual capture.**

  ```bash
  cd apps/carnegie && npm run build
  npx playwright test tests/e5-a11y.spec.ts --reporter=line
  node scripts/electron-radial-renderer-smoke.mjs
  ```

  Save captures under `/tmp` during iteration and record final evidence paths in `progress.md`.

- [ ] **Step 7: Commit.**

  ```bash
  git add apps/carnegie/src/styles apps/carnegie/src apps/carnegie/tests apps/carnegie/playwright.config.ts
  git commit -m "feat(carnegie): harden full workflow accessibility and layout"
  ```

**Acceptance:** Every E5 screen is keyboard usable, readable at the supported window sizes, announces durable state changes, and passes the renderer build plus automated accessibility checks.

---

## Integrated Overture Crew and automatic orchestration tasks

The following tasks absorb the former E6 plan into E5. They are part of the same acceptance path and must be completed before the live project progression task below. The operator-facing channel remains primary throughout; artifact and plan panels are projections of the same durable Overture Run.

### Task 14: Define and persist the interactive Overture Crew and plan set

**Purpose:** Replace the missing conversation-to-Task-Contract boundary with one durable, project-scoped Overture Run.

**Required contracts:**

- Canonical roles: `conversation-lead`, `architecture-analyst`, `external-research-scout`, `security-evaluator`, `design-mock-specialist`, and `task-editor`.
- Run states: `collecting`, `waiting_for_operator`, `synthesizing`, `review`, `blocked`, `launched`, and `cancelled`.
- Explicit execution phase: `overture`; do not use a fake `missionBundleId` for pre-Goal work.
- Durable role messages with role identity, conversation cursor, turn identity, and bounded content.
- Durable artifacts with content hashes and source references.
- Durable clarifications with answer state and command identity.
- Durable plan documents:
  - `plan00.md`: project-wide blueprint, stack, architecture, global invariants, phase map, and overall acceptance gates.
  - `plan01.md`, `plan02.md`, …: phase plans with phase objectives, boundaries, dependencies, and exit conditions.
  - `plan01-slice01.md`, `plan01-slice02.md`, …: multiple bounded slices under each phase, each with file boundaries, tests, evidence, retry rules, and stop conditions.
- A plan manifest containing document IDs, versions, content hashes, dependency edges, and a manifest hash.
- `TaskContract` reference `{ planId, version, manifestHash }`, included in canonical content hashing and exact confirmation.

**TDD gates:**

- Add RED tests for role selection, state transitions, project scoping, message ordering, clarification resumability, plan00/phase/slice document relationships, append-only revisions, idempotency, hash integrity, and cross-project denial.
- Add RED tests proving `overture` context has no Goal or Worker authority and cannot be accepted as a Worker context.
- Implement the domain/Zod contracts and PostgreSQL store only after the intended RED tests execute.
- Add transactional events/outbox rows for run creation, role activation, role message, clarification, artifact revision, plan revision, synthesis, review readiness, and launch readiness.
- Run focused unit and real-PostgreSQL persistence tests, then record RED/GREEN evidence in progress documentation.

**Acceptance:** A project-scoped conversation can own one resumable Overture Run. A phase may contain any number of ordered or safely parallel slices. Every current document and artifact is hash-bound, project-bound, and recoverable.

**Task 14 final checkpoint (2026-09-23):** Committed and pushed as `6a3e8492` (`feat(overture): add durable crew planning foundation`); `HEAD` and `origin/main` are synchronized. The focused gate passed **6 files / 17 tests** against real PostgreSQL, the unrestricted suite passed **435 files / 2,888 tests**, and build/typecheck, targeted ESLint, Prettier, migration numbering, and diff checks passed. Independent no-edit re-review returned **PASS**. Live E5 remains open because the current Home/provider path produced no Task Contract, Goal, Worker, or downstream evidence.

**Task 15 vertical-slice start (2026-09-23):** The first unblocked slice adds pure, tested role runtime policies (`createOvertureRoleRuntimePolicy`) and an agent-runtime factory (`createOvertureRoleRuntime`) with distinct prompts, role-specific capability axes/tool allowlists, bounded output budgets, project/run/conversation context, and explicit no-private-reasoning/no-execution boundary language. The factory creates a role-scoped `CapabilityGrant` and binds the selected model policy; it does not admit a provider or write durable state by itself. Control Plane routes, same-channel role turns, Task Editor, and Task Contract handoff remain unimplemented and are not claimed.

**Task 15 Control Plane/API slice checkpoint (2026-09-23):** Added persistence-backed `OvertureService` composition, guarded Control Plane routes for run create/read, operator-message append, and event listing, stable Overture API error mapping, and typed `@maestro/api-client` methods. Focused verification passed **6 files / 50 tests** (`apps/control-plane/src/overture-route.test.ts`, `apps/control-plane/src/api-error.test.ts`, `packages/api-client/src/client.test.ts`, contracts Overture/surface tests, and API-client surface); root `npm run build`, targeted ESLint, Prettier, migration numbering, boundary checks, and `git diff --check` passed. The route slice is persistence/API plumbing only: it does not yet admit provider-backed Crew turns, stream SSE, expose artifacts/plans/linked Task Contract, wire Electron, or produce a Task Contract/Goal/Worker. Live E5 remains open.

**Task 15 Electron bridge checkpoint (2026-09-23):** Added the four typed Overture API methods to Carnegie's main-process allow-list and CommonJS preload allow-list. Focused verification passed **3 files / 51 tests** (`apiBridge`, API client, and Overture route); root build/typecheck passed. The bridge exposes persistence/API plumbing only; it does not claim renderer Overture UI, provider-backed role turns, SSE, Task Editor, Task Contract, Goal, or Worker evidence.

**Task 15 event-stream checkpoint (2026-09-23):** Added cursor-reconciled Overture SSE at `/v1/overture/runs/:runId/events/stream` with `Last-Event-ID` validation, bounded active-stream registration, polling, heartbeat, cleanup, and typed API-client parsing/reconnect headers. Focused verification passed **3 files / 52 tests** (API client, Control Plane Overture routes, Carnegie bridge); root build/typecheck, targeted ESLint, and `git diff --check` passed. The stream carries durable Overture events only; it does not claim role/provider execution, message streaming, artifacts/plans/linked Task Contract, renderer UI, or downstream Goal/Worker evidence.

**Task 15 durable-message-read checkpoint (2026-09-23):** Added project/run/conversation-scoped persistence reads for durable Overture messages, a Control Plane message-list route, typed API-client support, and Electron/preload exposure. Focused verification passed **3 files / 53 tests**; root build/typecheck, targeted ESLint, and `git diff --check` passed. This still does not claim renderer Overture UI, provider-backed Crew turns, Task Editor, Task Contract, Goal, Worker, or post-Launch evidence.

**Task 15 PostgreSQL verification note (2026-09-23):** The new durable-message assertion is present in `packages/persistence/src/overture.integration.test.ts`, but the requested real-PostgreSQL run could not start: `MAESTRO_TEST_DATABASE_URL=postgresql://maestro@127.0.0.1:55432/maestro_local npx vitest run packages/persistence/src/overture.integration.test.ts` exited 1 with `connect ECONNREFUSED 127.0.0.1:55432` during migration setup. This is an environment blocker, not passing database evidence; no PostgreSQL acceptance claim is made for this slice.

**Task 15 PostgreSQL recovery checkpoint (2026-09-23):** Disposable container `maestro-local-postgres` is running on `127.0.0.1:55432`. Rerunning `MAESTRO_TEST_DATABASE_URL=postgresql://maestro@127.0.0.1:55432/maestro_local npx vitest run packages/persistence/src/overture.integration.test.ts` passed **1 file / 5 tests** in 5.78s, including the durable message-reader assertion. This closes the prior database-availability blocker for the persistence slice. Provider-backed Crew execution remains unverified because no Model Gateway listener is currently available on `127.0.0.1:4321`.

**Task 15 Model Gateway probe (2026-09-23):** Temporarily started the built Model Gateway on `127.0.0.1:4321` with a fresh local bearer token and no provider credentials. `GET /healthz` returned HTTP 200 `{"status":"ok"}`; authenticated `GET /v1/models` returned HTTP 200 with `[]`. The gateway process was stopped after the probe. This proves the gateway HTTP boundary is reachable when started, but no provider-qualified model is admitted; provider-backed Overture role execution remains blocked/unverified.

**Task 15 provider-backed role-turn seam checkpoint (2026-09-23):** Added the first tested `conversation-lead` role-turn runner. It records the selected provider-qualified model in the role assignment before gateway admission, creates the role-scoped runtime/grant, excludes the current operator message from initial history, invokes the shared gateway, and persists the bounded role answer to the same conversation turn. Production composition passes the optional Model Gateway context; absent credentials/models remain an explicit `provider_unavailable` boundary. RED correctly failed on the missing runner module; GREEN focused verification passed **2 files / 5 tests**, the broader Overture/API focused set passed **7 files / 63 tests**, root build/typecheck passed, and targeted ESLint, migration, boundary, and diff checks passed. Real PostgreSQL Overture integration passed **1 file / 5 tests**. No live provider turn, Task Contract, Goal, Worker, or downstream evidence is claimed.

**Task 15 durable artifact/plan-read checkpoint (2026-09-23):** Added PostgreSQL-backed artifact reads and hash-bound plan-manifest reads, Control Plane routes, typed API-client methods, and Electron/preload exposure. RED exposed the missing artifact reader; GREEN passed **7 files / 64 tests** across Overture/API/bridge/contracts, real PostgreSQL Overture integration passed **1 file / 5 tests**, and build/typecheck, targeted ESLint, migration, boundary, and diff checks passed. Task Contract linkage, Task Editor writes, renderer Overture UI, and live provider execution remain unimplemented/unverified.

**Task 15 Task Editor handoff checkpoint (2026-09-23):** Added versioned plan revision and clarification writes, then an exact Overture-to-Task-Contract handoff. The handoff verifies the current plan document version and manifest hash, creates the existing durable Task Contract producer, binds its ID/reference to the Overture Run, and moves the run to `review`; retries remain idempotent and no Goal is advanced. PostgreSQL Overture integration passed **1 file / 6 tests**; focused route/API/bridge/contracts/persistence verification passed **6 files / 63 tests**, with build/typecheck, ESLint, migration, boundary, and diff checks passing. Renderer UI, live provider evidence, confirmation/Launch wiring from this Run, and downstream orchestration remain unimplemented or unverified.

**Task 15 Carnegie channel-first UI checkpoint (2026-09-23):** Home now awakens a real PostgreSQL-backed Overture Run from the completed Concertmaster turn, shows the same-channel role messages and durable run state, lets the operator write and hash `plan00.md`, and exposes required boundary fields before creating the awaiting Task Contract through the exact handoff route. Confirmation and Launch remain separate existing actions; Launch now marks a linked Overture Run `launched` after the durable Task Contract launch succeeds. Carnegie build and focused Home/authoring tests passed **22 tests**, Overture PostgreSQL integration passed **6 tests**, and lint/migration/boundary/diff checks passed. Live provider and downstream Goal/Worker evidence remain blocked by the empty Model Gateway catalog.

The Task Editor UI also supports adding or revising phase and slice documents with server-enforced dependency edges; stale versions and missing phase dependencies fail closed. It never creates a Task Contract until the operator supplies repository, base revision, data boundary, and organization fields.

**Task 15 model-selection/reasoning-effort checkpoint (2026-09-24):** Added provider-advertised reasoning-effort metadata from the Codex model catalog, strict Gateway admission validation, and persistence of the selected effort in the new Conversation's opaque Gateway binding. Unsupported efforts fail closed before provider admission; models without metadata remain at the provider default. Carnegie Home and Inbox now expose exact live model selection plus an accessible dial backed only by the selected model's advertised options. Commits `b4f9dce7`, `e331e1ea`, and `9a80d468` are on local `main`; focused verification passed **11 files / 116 tests**, root and renderer builds passed, ESLint, boundary, and migration checks passed. This is code-level evidence only: it does not create or claim a live Task Contract, Goal, Worker, or E5 completion.

**Task 15 heartbeat #49 verification update (2026-09-24):** Conversation wire compatibility was restored for older responses by making the new `reasoningEffort` output field optional while new server-created conversations still return the selected value or `null`; missing Carnegie titles for `overture_run_not_found` and `overture_conflict` were also added. Compatibility verification passed **4 files / 93 tests**; the fresh unrestricted PostgreSQL-backed suite passed **440 files / 2,916 tests** with exit 0 in **1,001.90s** (`/tmp/maestro-full-test-2.log`). No live provider or downstream E5 evidence was created.

### Task 15: Implement role-specific Crew runtime and interactive Task Editor

**Purpose:** Make Concertmaster awaken real Crew roles that converse with the operator instead of producing hidden one-shot reports.

**Role runtime requirements:**

- Each role receives a distinct system prompt, model policy, output budget, tool allowlist, context boundary, and project binding.
- The model router selects a provider-qualified model per role/task requirement; actual provider/model identity is recorded before admission.
- `conversation-lead` asks focused questions and keeps the dialogue coherent.
- `architecture-analyst` uses authorized project and Git read evidence.
- `external-research-scout` uses only permitted public evidence and records citations.
- `security-evaluator` reviews authority, data, budget, critical actions, and stop conditions.
- `design-mock-specialist` creates disposable design artifacts and never mutates production UI.
- `task-editor` reads accepted role artifacts and the conversation, then revises plan00, phase plans, slice plans, and the Task Contract.
- No Overture role may spawn a Worker, create a Mission Bundle, modify the repository, approve itself, or launch a Goal.

**Conversation behavior:**

- Concertmaster remains the channel owner and invokes or pauses Overture.
- Role messages and operator answers appear in the same durable conversation with explicit role labels.
- A role may request clarification; the run enters `waiting_for_operator` and resumes the same run after the answer.
- Roles may challenge one another, request evidence, and revise their findings. The Task Editor records the material decision and affected plan documents.
- The system never fills missing facts with placeholders merely to reach a valid schema.
- The UI shows the evolving conversation, role activity, open questions, plan00/phase/slice revisions, material diffs, blockers, and exact hashes. It does not expose raw provider execution IDs as operator workflow inputs.

**TDD gates:**

- Add RED tests proving distinct role prompts and grants.
- Add RED tests proving role boundaries, public-research limits, project read scope, secret rejection, and no Worker/repository/critical-action access.
- Add RED tests for a clarification round, same-run resume, role-message ordering, and plan revision after user feedback.
- Add RED tests proving Task Editor writes plan documents before creating an awaiting-confirmation Task Contract.
- Route the existing E1 drafting tool through Task Editor or remove it; do not leave two authoritative producers.
- Add Control Plane routes and typed API/Electron methods for start, answer, read run, read messages, list artifacts, read plan set, and read linked Task Contract.
- Add Carnegie tests for the complete channel-first journey and stale/cross-project protection.

**Acceptance:** Concertmaster can awaken the required Crew, the operator can continue the same conversation, and Task Editor can produce a complete versioned plan set and Task Contract without any Goal or execution-side state advancing.

### Task 16: Connect exact Launch to automatic Goal orchestration

**Purpose:** Remove manual downstream identity entry and start the existing hierarchy automatically after exact launch.

**Required sequence:**

1. Exact confirmation and Launch validate the current Task Contract hash and exact approved plan manifest.
2. Launch records or attaches the durable Goal and enqueues the first orchestration command.
3. The controller activates the smallest valid Head set through existing leases and native admission.
4. Heads produce sealed independent briefs.
5. Council reveal and decision occur through existing durable contracts.
6. Department Plans and Mission Bundles bind to the launched contract and exact plan version.
7. Workers are dispatched through existing capacity, authority, routing, lease, fencing, Git, and evidence boundaries.
8. Metronome, Encore, certification, and final reporting continue through existing services.

**TDD gates:**

- Before Launch, prove no Goal, Head, Council, Department Plan, Mission Bundle, Worker, or provider effect advances.
- After Launch, prove the first durable orchestration command exists without a second operator action.
- Replay Launch and every outbox command across process restart; prove no duplicate Goal, role, provider admission, or external effect.
- Missing artifacts, stale plan manifests, Council timeouts, provider uncertainty, and authority failures must produce durable blocked/unknown states, never fabricated progress.
- The Launch HTTP response returns a scheduling acknowledgement and does not wait for the whole Goal.

**Acceptance:** One exact Launch starts resumable automatic orchestration. All downstream identities are server-derived and all transitions are durable, idempotent, and recoverable.

### Task 17: Run the integrated live Overture-to-Goal scenario

This task is the former Task 14 live progression gate, extended to cover the integrated Crew and plan-set flow. Use a bounded non-destructive request and real PostgreSQL/provider infrastructure.

The evidence must include:

- Conversation ID and durable cursors.
- Selected Crew roles and role-message records.
- Clarification round, if required.
- `plan00.md`, phase plan, and at least two slices under one phase.
- Document hashes and plan manifest hash.
- Task Contract ID, version, content hash, and plan reference.
- Exact confirmation and Launch result.
- Goal, Head, Council, Department Plan, Mission Bundle, and first Worker IDs.
- Provider/model bindings, evidence, certification, and report state, or the exact blocker at the first failing boundary.

Negative cases must prove no execution before Launch, no placeholder completion, no cross-project artifact access, no plan hash tampering, no duplicate Launch effect, and no critical-action bypass.

### Task 18: Final integrated E5 verification and completion gate

The final gate now covers both Carnegie and Overture. It requires:

- Root build and Carnegie build.
- Focused unit/integration tests for Tasks 14–16.
- Full real-PostgreSQL verification.
- Live Electron/provider scenario or a precise backend/provider blocker.
- Independent no-edit review of the Crew, plan hierarchy, Task Editor, exact Launch, orchestration, authority, and evidence boundaries.
- Secret and generated-artifact scans.
- Updated capability matrix and progress records.

E5 may be marked complete only when the operator can see the Crew conversation, plan00, phase/slice plans, Task Contract hashes, Launch state, and post-launch progress without fabricated state.

---

## Task 19: Run the real end-to-end project progression

**Files:**
- Modify: `execution/e5-capability-matrix.md`
- Modify: `execution/PENDING_LIVE_CHECKS.md`
- Modify: `roadmap/act-1-foundation/active/operations/progress.md`
- Create: `execution/e5-live-evidence/README.md`
- Create: `apps/carnegie/tests/e5-live-acceptance.spec.ts`

**Live preconditions:**

- Use the existing authenticated session; do not log out, revoke, rotate, or reset it.
- Use a disposable/bounded project or a Goal explicitly approved for live testing.
- Use a real model/provider connection already configured by the operator.
- Do not run irreversible external effects unless the operator explicitly approves that exact effect.

- [ ] **Step 1: Start the real local backend and Carnegie.**

  Use the project's documented start command and the existing CDP port:

  ```bash
  npm run --workspace @maestro/carnegie start -- --remote-debugging-port=9222
  ```

  Confirm the actual Electron window is visible and record the API URL, project ID (not the token), viewport, window bounds, and commit SHA.

- [ ] **Step 2: Execute the real assistant-to-Task flow.**

  In the visible window, send a bounded project request. Verify that Concertmaster awakens the required Overture Crew in the same conversation, then save role-message evidence, plan00/phase/slice document IDs and hashes, the Task Contract ID/version/content hash, and a screenshot of the real exchange. Verify the response and plan artifacts are not fixtures.

- [ ] **Step 3: Edit, confirm, and launch the real contract.**

  Change one success criterion, save, verify a new server version, confirm the exact hash, and launch explicitly. Save the durable response and resulting Goal ID.

- [ ] **Step 4: Execute the real planning path.**

  Use the server-selected Crew and the plan-set output; do not require manual role or downstream identity entry. Activate a permitted Head, create/inspect Council, submit a brief, reveal/decide only when permitted, read Department Plan, and read Mission Bundle. Save IDs and screenshots for each durable transition.

- [ ] **Step 5: Execute the real Worker path.**

  Spawn a bounded Worker, observe it, send one scoped message, inspect its status, and verify event updates in Dashboard/Channel. Do not claim completion until the server returns the terminal state.

- [ ] **Step 6: Execute the real Git/evidence/review path.**

  Create or inspect the real integration branch/worktree, freeze/advance only when the backend permits, read evidence, accept/certify only with actual evidence, and verify the certification appears in Inbox and Evidence Log.

- [ ] **Step 7: Execute the real approval path where required.**

  Trigger a safe approval-required action, inspect its exact effect and expiry, discuss it with the Concertmaster, then deny or approve according to explicit operator authorization. Record the final durable state.

- [ ] **Step 8: Execute reporting and recovery checks.**

  Read budget, billing, Metronome, Encore, final Concertmaster report, event log, and Git state. Force or wait for a reconnect if safe, verify stale state and recovery, and ensure no token appears in screenshots/logs.

- [ ] **Step 9: Update the matrix honestly.**

  A row becomes `Live` only with the evidence listed above. A failed live check becomes a precise `backend-blocked`/`partial` entry in `PENDING_LIVE_CHECKS.md`; do not convert a unit-test pass into a live pass.

- [ ] **Step 10: Record the dogfood result.**

  Prefix the progress entry `Dogfood loop:` and include exact screens, API methods, IDs, captures, errors, and whether the project actually advanced.

**Acceptance:** One real bounded task progresses through the visible Carnegie workflow far enough to produce durable project state, Worker/evidence/certification/report records, or a fully evidenced blocker at the exact failing boundary.

---

## Task 20: Final verification and E5 completion gate

**Files:**
- Modify: `execution/e5-capability-matrix.md`
- Modify: `execution/PENDING_LIVE_CHECKS.md`
- Modify: `roadmap/act-1-foundation/active/operations/progress.md`
- Inspect: all changed files and `git diff --check`

- [ ] **Step 1: Run the complete automated verification set.**

  ```bash
  npm run build
  cd apps/carnegie && npm run build
  cd ../.. && npm test
  cd apps/carnegie && npx playwright test --reporter=line
  cd ../.. && git diff --check
  ```

  Record each command's exit code and output summary. Do not call the plan complete while a required command is failing; if an existing unrelated failure remains, isolate it with a reproduction and record it as a blocker.

- [ ] **Step 2: Run the independent no-edit review.**

  Review the diff against this plan. Check bridge allow-list, token boundaries, command IDs, expected versions/hashes, authority/approval gates, fake data removal, stale state, and all live evidence. The reviewer must not edit files.

- [ ] **Step 3: Run the real Electron smoke capture.**

  Verify frameless chrome, custom controls, maximized work-area fit, page zoom, Dashboard readability, Home conversation, Task Contract review, Inbox, Worker, Git, and Evidence states. Keep the window visible during the check.

- [ ] **Step 4: Close or document every matrix row.**

  No row may remain blank. Use only `Live`, `Partial`, `Backend-blocked`, or `Out-of-scope`, with evidence and next action.

- [ ] **Step 5: Run secret and artifact checks.**

  Search changed files, captures, and logs for provider token values, authorization headers, and raw credential fields. Remove sensitive artifacts before commit; retain only redacted evidence.

- [ ] **Step 6: Final commit and handoff.**

  ```bash
  git add execution/e5-capability-matrix.md execution/PENDING_LIVE_CHECKS.md roadmap/act-1-foundation/active/operations/progress.md execution/e5-live-evidence apps/carnegie
  git commit -m "feat(carnegie): complete E5 project execution console"
  git status --short
  ```

**E5 completion gate:**

- Every GUI action is classified in the capability matrix.
- The real assistant-to-Task Contract flow works or has an evidenced Control Plane blocker.
- A real task reaches the furthest permitted project stage through Carnegie.
- No fake progress, sample session, local-only Goal, or false certification remains.
- Build, tests, accessibility checks, Electron capture, independent review, and secret checks have evidence.
- Any remaining backend work is named as a separate dependency rather than hidden inside a GUI TODO.

## Execution Order

Run tasks in this order:

```text
0 baseline/matrix
→ 1 secure bridge
→ 1.5 zero-config local bootstrap on launch
→ 2 shared action/reconnect primitives
→ 3 real assistant + Task Contract
→ 4 Goal/Dashboard/lifecycle
→ 5 planning
→ 6 Worker execution
→ 7 Git/evidence/certification
→ 8 approvals/authority/Inbox
→ 9 Channel/events
→ 10 settings/provider/billing
→ 11 Persona/Arrangements
→ 12 blocked/deferred surfaces
→ 13 accessibility/layout/live browser checks
→ 14 Overture Run, plan00/phase/slice persistence
→ 15 role-specific Crew runtime and interactive Task Editor
→ 16 exact Launch and automatic Goal orchestration
→ 17 integrated live Overture-to-Goal progression
→ 18 integrated verification gate
→ 19 full real project progression
→ 20 final E5 completion gate
```

Do not start Tasks 5–8 or Tasks 14–16 as isolated UI mockups. Task 3 and Task 4 must first prove the existing conversation and Goal boundaries; Tasks 14–16 then provide the authoritative interactive Overture path rather than a second producer. If Task 17 or Task 19 is blocked by `Durable store is unavailable`, provider behavior, or another external dependency, stop at the failing boundary, preserve the evidence, and update `PENDING_LIVE_CHECKS.md` rather than bypassing the dependency.

**Task 1.5 should land before any later task attempts a live check.** Every live-run step from Task 3 Step 8 onward assumes a reachable Control Plane; until Task 1.5 lands, those steps keep re-discovering the same "no Control Plane/provider" blocker Task 1.5 exists to remove. Re-attempt any live step recorded as blocked in `PENDING_LIVE_CHECKS.md` once Task 1.5 is closed, before assuming it's still blocked.


## Task 20 verification update (2026-09-23)

The final gate is **not closed**. Evidence at commit `2c767e29` / current verification: root `npm run build` passed; `apps/carnegie npm run build` passed; exact Carnegie Playwright command passed 4 tests with 5 designed skips; `git diff --check` passed. The first unrestricted `npm test` exited 1 because the configured `127.0.0.1:55432` PostgreSQL endpoint was unavailable (336 tests passed before database-backed setup failures). A second run against a disposable PGlite socket on `55432` was stopped after repeated 30-second timeouts; an isolated Improvement Candidate run passed 7/9 but exposed the PGlite socket `Received unexpected parseComplete message from backend` protocol error. No code regression is attributed without a real PostgreSQL run. The live Task 14 blocker remains authoritative; see `execution/e5-live-evidence/README.md`.

Task 15 follow-up evidence: the independent Electron radial smoke passed (`pass:true`, graph/taskContract true, 3 controls, 5 source nodes); committed E5 evidence/spec secret-pattern scans returned zero matches and generated Playwright artifacts were removed.

Task 13/15 follow-up at `f282458c`: active-route/mode semantics and rendered markup tests are merged; the focused UI suite passes 8 files / 35 tests, builds and Playwright checks pass as documented, and the real PostgreSQL/provider gate remains open.


## Task 14 final verification checkpoint (2026-09-23)

The unrestricted real-PostgreSQL suite completed with **435 test files / 2,888 tests passed**, exit 0, in 1027.06s. The post-hardening focused gate completed with **6 files / 17 tests passed**. `npm run build`/workspace typecheck, migration numbering, Prettier, targeted ESLint, and `git diff --check` passed. The database sensitive-content trigger now covers the same provider-token, JWT, private-key, credential, and raw-model-output classes as the application boundary. Task 14 is ready for commit; Task 15 remains gated until that commit and review. Live E5 remains open because the real Home/provider path has not produced a Task Contract or downstream Goal/Worker evidence.


**Provider admission probe (2026-09-24):** Native gateway startup succeeded with a probe token, but authenticated `/v1/models` returned `[]`. The gateway keychain metadata for `local-operator` was empty, and no provider API-key environment variables were present. The probe was stopped without provider execution. Live provider and downstream E5 evidence remain blocked.


## Task 15 routing/bootstrap checkpoint (2026-09-24)

Commit `ec3141a5` gates Ensemble readiness on exact live Gateway presence and host-authorized account bindings. It also propagates optional routing mode, native model, candidate catalog, account refs, and model-map configuration through local bootstrap into the Control Plane. Focused verification passed **3 files / 66 tests** (`router-catalog`, `local-bootstrap`, `connection`); root build and ESLint passed. The live provider catalog is still unavailable/authenticated-empty in this environment, so no provider, Task Contract, Goal, or Worker evidence is claimed.

The next GUI usability slice is the Overture clarification answer round-trip: persistence already supports answers, but Control Plane, API client, Electron bridge, and Home do not yet expose an operator answer form.


## Task 15 clarification-answer checkpoint (2026-09-24)

The missing operator answer path is now implemented in commit `11e11429`. `AnswerOvertureClarificationBodySchema` and the typed API method feed a scoped, idempotent Control Plane route backed by the existing PostgreSQL `answerOvertureClarification` function. Clarification event payloads now carry only the already-safe question/answer text so Home can reconstruct the open question from the durable event stream. Carnegie exposes an accessible answer form and clears it after a successful answer.

RED/GREEN evidence: the new route/API bridge/Home tests first failed at the missing method/route, then focused verification passed **7 files / 75 tests**, including the real PostgreSQL `overture.integration.test.ts` (**6 tests**). Root build, renderer typecheck, ESLint, and `git diff --check` passed. This enables the operator-facing clarification round-trip but does not claim a live provider or E5 completion.


## Heartbeat #51 full regression checkpoint (2026-09-24)

After the clarification answer implementation and fail-closed event projection fix (`d6913d0e`), unrestricted `npm test` against PostgreSQL `127.0.0.1:55432` passed **440 test files / 2,919 tests**, exit 0, duration **912.60s** (`/tmp/maestro-full-test-3.log`). This supersedes the prior 2,916-test automated count; it does not create live provider, Task Contract, Goal, Worker, or E5 evidence.


## Task 15 role-continuation regression checkpoint (2026-09-24)

After commit `4c02785a`, unrestricted `npm test` against PostgreSQL `127.0.0.1:55432` passed **441 test files / 2,920 tests**, exit 0, duration **916.12s** (`/tmp/maestro-full-test-4.log`). This includes the Overture-owned turn and replay-safe role-continuation integration path. Automated regression is green; live provider, Task Contract, Goal, Worker, and E5 acceptance remain unclaimed.
