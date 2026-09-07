# Maestro Terminal TUI Implementation Plan

> **Implementation workflow:** Execute this plan task by task and keep the checkboxes updated. Use the repository's current agent workflow; this document is the source of truth for scope and order.

**Goal:** Build an interactive conversation-first terminal TUI invoked by `maestro` that exposes the complete Maestro operational surface through the existing Control Plane, typed API client, durable events, and approval boundaries.

**Architecture:** Add a TUI client layer above `@maestro/api-client`; keep Control Plane, PostgreSQL, leases, fencing, approvals, and the provider-neutral `MaestroAgentRuntime` authoritative. Preserve existing non-interactive CLI and `--json` modes. The TUI never owns provider credentials or worker authority. Start with a truthful shell/connection/session foundation, then add streaming conversation and progressive-disclosure views without inventing a second runtime.

**Tech Stack:** TypeScript, Node.js 24, npm workspaces, existing `@maestro/api-client`, Fastify Control Plane HTTP/SSE, `@earendil-works/pi-tui` `0.85.1`, Vitest, real PostgreSQL integration fixtures, and real-process tests where lifecycle behavior is involved.

**Spec:** `plan/specs/2026-09-06-maestro-tui-design.md`

## Global Constraints

- The current working directory is the Maestro workspace; detect its Git root without requiring Project/Goal IDs in the normal local flow.
- `maestro` opens interactive TUI; `maestro <command>` remains non-interactive; `maestro --json ...` remains machine-readable.
- The TUI never imports persistence internals, writes PostgreSQL, spawns a provider/runtime directly, or creates a second scheduler/recovery protocol.
- All mutations use the existing typed API, authenticated actor/project/Goal context, command identity, lease/fencing proof where required, and durable acceptance.
- Critical actions, external sends, remote Git effects, deployment, payment, deletion, permission/credential changes, and other configured high-impact actions require explicit confirmation.
- No fabricated success, mock operational state, plaintext bearer-secret fallback, or silent unavailable behavior.
- User-facing product name is Maestro; Concertmaster is the conversational identity; Secretary is not displayed as the app name.
- Every slice uses TDD, focused tests, `npm run build`, relevant integration tests, `git diff --check`, and a Conventional Commit. PostgreSQL/real-process acceptance is required before claiming operational completion.

---

### Task 1: Define the TUI runtime boundary and command-mode entrypoint

**Files:**
- Create: `apps/cli/src/tui/types.ts`
- Create: `apps/cli/src/tui/runtime.ts`
- Create: `apps/cli/src/tui/entry.ts`
- Modify: `apps/cli/src/main.ts`
- Test: `apps/cli/src/tui/runtime.test.ts`
- Test: `apps/cli/src/main.test.ts`

**Interfaces:**
- `TuiRuntime` owns terminal lifecycle, render loop, focus, and clean shutdown.
- `startInteractiveTui(options: { cwd: string; env: NodeJS.ProcessEnv; io: CliIo }): Promise<number>` starts the TUI.
- Existing `executeCli` keeps all current subcommand and `--json` behavior.

- [ ] Write tests proving `--help`, existing subcommands, and `--json` do not enter TUI; no-subcommand mode selects TUI; Ctrl-C stops cleanly.
- [ ] Run `npm test -- apps/cli/src/main.test.ts apps/cli/src/tui/runtime.test.ts` and confirm the new no-subcommand assertions fail for the missing runtime.
- [ ] Implement the smallest runtime boundary using the installed `@earendil-works/pi-tui` primitives.
- [ ] Run the focused tests and `npm run build`; confirm existing command tests remain green.
- [ ] Commit with `feat(cli): add interactive maestro tui entrypoint`.

### Task 2: Build the Maestro visual shell and truthful workspace header

**Files:**
- Create: `apps/cli/src/tui/theme.ts`
- Create: `apps/cli/src/tui/components/shell.ts`
- Create: `apps/cli/src/tui/components/status-header.ts`
- Create: `apps/cli/src/tui/workspace.ts`
- Test: `apps/cli/src/tui/workspace.test.ts`
- Test: `apps/cli/src/tui/components/shell.test.ts`

**Interfaces:**
- `resolveWorkspace(cwd: string): Promise<{ cwd: string; gitRoot?: string }>` returns only detected local workspace facts.
- `TuiShellState` contains connection state, selected Goal summary, approval count, worker count, and budget summary as explicit loading/empty/error/value states.

- [ ] Write tests for Git-root detection, non-Git folders, loading/empty/error states, and Maestro/Concertmaster labels.
- [ ] Run the focused tests in RED state.
- [ ] Implement the dark control-room shell, header, timeline placeholder, and input region. Do not add mock operational arrays.
- [ ] Run focused tests, build, and `git diff --check`.
- [ ] Commit with `feat(cli): add maestro tui shell`.

### Task 3: Add local connection bootstrap and secure session configuration

**Files:**
- Create: `apps/cli/src/tui/connection.ts`
- Create: `apps/cli/src/tui/local-control-plane.ts`
- Modify: `apps/cli/src/main.ts`
- Test: `apps/cli/src/tui/connection.test.ts`
- Test: `apps/cli/src/tui/local-control-plane.test.ts`

**Interfaces:**
- `resolveConnection(env, cwd): Promise<ConnectionState>` resolves an explicit configured endpoint first, then the local default, and reports unavailable/setup-required states without exposing secrets.
- `ensureLocalControlPlane(options): Promise<LocalControlPlaneState>` reuses a healthy local server or starts the repository-approved local process with bounded readiness checks.

- [ ] Write tests for explicit endpoint, local default, missing token, healthy reuse, startup timeout, and safe error rendering.
- [ ] Run focused tests in RED state.
- [ ] Implement connection/bootstrap using existing config and lifecycle contracts; do not invent a database or bypass authentication.
- [ ] Run focused tests and build. Exercise only a disposable local control-plane process in integration verification.
- [ ] Commit with `feat(cli): bootstrap local maestro connection`.

### Task 4: Add durable session restore and reconnectable event activity

**Files:**
- Create: `apps/cli/src/tui/session.ts`
- Create: `apps/cli/src/tui/activity-stream.ts`
- Create: `apps/cli/src/tui/components/activity-timeline.ts`
- Modify: `packages/api-client/src/index.ts` only if an existing typed SSE/request cancellation seam is missing
- Test: `apps/cli/src/tui/session.test.ts`
- Test: `apps/cli/src/tui/activity-stream.test.ts`
- Integration test: `apps/control-plane/src/tui-event-reconnect.integration.test.ts`

**Interfaces:**
- `loadWorkspaceSession(cwd): Promise<WorkspaceSession | undefined>` and `saveWorkspaceSession(session): Promise<void>` store only non-secret session identity and workspace metadata.
- `subscribeToEvents(options: { projectId: string; goalId?: string; cursor?: string; signal: AbortSignal }): AsyncIterable<GoalEvent>` resumes from a durable cursor and deduplicates only by server event identity.

- [ ] Write tests for `/new`, last-session restore, reconnect cursor, duplicate event suppression, terminal disconnect, and no fabricated activity.
- [ ] Run unit tests in RED state.
- [ ] Implement session metadata and SSE activity rendering through the typed client/control-plane event contract.
- [ ] Run focused tests, build, and the disposable PostgreSQL integration fixture.
- [ ] Commit with `feat(cli): restore maestro sessions and live activity`.

### Task 5: Implement chat editor, slash commands, autocomplete, and command palette

**Files:**
- Create: `apps/cli/src/tui/input/chat-editor.ts`
- Create: `apps/cli/src/tui/commands/registry.ts`
- Create: `apps/cli/src/tui/commands/parser.ts`
- Create: `apps/cli/src/tui/commands/palette.ts`
- Modify: `apps/cli/src/main.ts` to route interactive input only
- Test: `apps/cli/src/tui/commands/parser.test.ts`
- Test: `apps/cli/src/tui/input/chat-editor.test.ts`

**Interfaces:**
- `parseSlashCommand(input: string): ParsedCommand | { kind: "natural-language"; text: string }` never executes a command.
- `CommandRegistry` maps every exposed operation to metadata, argument help, read/write classification, and handler.
- `ConversationController.submit(text): Promise<void>` routes natural language to Concertmaster through the existing server contract; it does not directly mutate local state.

- [ ] Write tests for command parsing, quoted values, unknown commands, autocomplete, multiline input, IME-safe cursor behavior, and keyboard shortcuts.
- [ ] Run focused tests in RED state.
- [ ] Implement the editor and registry with native pi-tui input patterns, keeping output in the conversation timeline.
- [ ] Run focused tests and build.
- [ ] Commit with `feat(cli): add maestro conversational input`.

### Task 6: Wire full read surfaces and progressive-disclosure panels

**Files:**
- Create: `apps/cli/src/tui/commands/read-commands.ts`
- Create: `apps/cli/src/tui/panels/goal-panel.ts`
- Create: `apps/cli/src/tui/panels/organization-panel.ts`
- Create: `apps/cli/src/tui/panels/evidence-panel.ts`
- Create: `apps/cli/src/tui/panels/incident-panel.ts`
- Create: `apps/cli/src/tui/panels/portfolio-panel.ts`
- Modify: `apps/cli/src/tui/commands/registry.ts`
- Test: `apps/cli/src/tui/commands/read-commands.test.ts`
- Test: `apps/cli/src/tui/panels/*.test.ts`

**Interfaces:**
- Read handlers consume only typed `ApiClient` methods and return renderable read models with loading/error/empty states.
- Panels expose keyboard navigation and a linear text representation for every detail view.

- [ ] Write tests for Goal/project discovery, budget, workers, Council, plans, Git, environments, devices, Discord incidents, Metronome, certifications, reports, evidence, and improvement digest reads.
- [ ] Run focused tests in RED state.
- [ ] Implement read commands and panels without hardcoded operational records.
- [ ] Run focused tests, build, and API integration tests against disposable PostgreSQL.
- [ ] Commit with `feat(cli): expose maestro operational read panels`.

### Task 7: Wire full mutation flows and approval confirmations

**Files:**
- Create: `apps/cli/src/tui/commands/write-commands.ts`
- Create: `apps/cli/src/tui/components/approval-dialog.ts`
- Create: `apps/cli/src/tui/confirmation.ts`
- Modify: `apps/cli/src/tui/commands/registry.ts`
- Test: `apps/cli/src/tui/commands/write-commands.test.ts`
- Test: `apps/cli/src/tui/confirmation.test.ts`
- Integration test: `apps/control-plane/src/tui-command-parity.integration.test.ts`

**Interfaces:**
- `confirmCriticalAction(summary: CriticalActionSummary): Promise<"approved" | "cancelled">` displays exact action/target/Goal/expiry/effect/rollback details.
- Write handlers call existing typed API methods for Task Contract, Goal, Head, Council, Department Plan, Mission Bundle, Worker, Git, device, Discord, Metronome, Encore, certification/report, and approval flows.

- [ ] Write tests proving read actions do not prompt, critical actions cannot call the client before approval, cancellation has no mutation, replay uses durable command identity, and server rejection is visible.
- [ ] Run focused tests in RED state.
- [ ] Implement handlers and approval dialog. Use one registry metadata source to avoid command drift.
- [ ] Run focused tests, build, and real-PostgreSQL parity integration tests.
- [ ] Commit with `feat(cli): wire maestro operations and approvals`.

### Task 8: Add natural-language orchestration and truthful unavailable states

**Files:**
- Create: `apps/cli/src/tui/conversation/concertmaster-controller.ts`
- Create: `apps/cli/src/tui/conversation/plan-message.ts`
- Create: `apps/cli/src/tui/conversation/result-message.ts`
- Test: `apps/cli/src/tui/conversation/concertmaster-controller.test.ts`
- Integration test: `apps/control-plane/src/tui-conversation.integration.test.ts`

**Interfaces:**
- `ConcertmasterController.handle(text): Promise<ConversationOutcome>` returns plan, question, approval-needed, progress, result, or unavailable outcomes.
- `ConversationOutcome` always identifies the durable command/event/report reference when one exists and explicitly labels provider or capability unavailability.

- [ ] Write tests for status questions, Goal creation, full launch flow, worker request, pause, emergency stop, risk summary, approval-needed action, ambiguous request, and unavailable AI provider.
- [ ] Run focused tests in RED state.
- [ ] Implement natural-language routing through the existing Concertmaster/Control Plane contract; do not duplicate domain orchestration in the TUI.
- [ ] Run focused tests, build, and real PostgreSQL composition verification.
- [ ] Commit with `feat(cli): add concertmaster conversation controller`.

### Task 9: Add attach/resume, long-running process behavior, and recovery UX

**Files:**
- Create: `apps/cli/src/tui/recovery.ts`
- Create: `apps/cli/src/tui/components/recovery-banner.ts`
- Modify: `apps/cli/src/tui/session.ts`
- Test: `apps/cli/src/tui/recovery.test.ts`
- Real-process test: `apps/control-plane/src/tui-process-recovery.integration.test.ts`

**Interfaces:**
- `reconcileTuiSession(workspace): Promise<RecoverySummary>` reports server-owned work, stale/unknown state, pending approvals, and reconnect actions.
- TUI exit never cancels server-owned work unless the user explicitly invokes a cancel command and confirms it.

- [ ] Write tests for TUI disconnect/reconnect, Control Plane restart, active worker visibility, stale state, and explicit cancellation.
- [ ] Run unit tests in RED state.
- [ ] Implement recovery banner and attach/resume behavior using durable server state.
- [ ] Run real-process recovery tests with disposable PostgreSQL; record any known provider crash-window boundary honestly.
- [ ] Commit with `feat(cli): add maestro attach and recovery ux`.

### Task 10: Rename user-facing Secretary labels to Maestro and verify client parity

**Files:**
- Modify: `apps/secretary/electron/main.ts`
- Modify: `apps/secretary/src/**/*.tsx` only where user-facing labels/titles are present
- Modify: `apps/cli/src/**/*.ts` for help/title copy
- Test: `apps/secretary/src/branding.test.ts`
- Test: `apps/cli/src/main.test.ts`

**Interfaces:**
- `getProductBrand(): { product: "Maestro"; conversationalIdentity: "Concertmaster" }` is the single display-copy source where practical.

- [ ] Write tests proving the desktop window title, TUI title, help text, and onboarding labels use Maestro and Concertmaster, not Secretary.
- [ ] Run tests in RED state.
- [ ] Replace only user-facing product labels; preserve internal package/path compatibility until a separate migration is approved.
- [ ] Run tests, build, and inspect the Electron bundle metadata.
- [ ] Commit with `refactor: align maestro product branding`.

### Task 11: Full parity, accessibility, and live acceptance gate

**Files:**
- Create: `apps/cli/src/tui/acceptance/representative-goal.test.ts`
- Create: `apps/cli/src/tui/acceptance/tui-cli-parity.test.ts`
- Modify: `plan/operations/progress.md`
- Modify: `plan/operations/findings.md`
- Modify: `plan/operations/task_plan.md`

**Interfaces:**
- Representative acceptance uses the same Goal identity and compares durable results from TUI, CLI, and Electron/API surfaces.
- Accessibility checks cover keyboard-only operation, focus visibility, CJK/IME cursor placement, readable status colors, and a linear alternative to every panel.

- [ ] Write the representative end-to-end acceptance scenarios from the spec and phase plans before implementation of the gate.
- [ ] Run the new acceptance suite in RED state until all prior slices are present.
- [ ] Run `npm run build`, focused tests, full `npm run check`, disposable PostgreSQL tests, and real-process Control Plane/provider tests where required.
- [ ] Perform a manual terminal live run for `maestro`, a natural-language status request, a slash command, a safe mutation, and an approval-gated action; stop before any external irreversible effect.
- [ ] Record exact evidence, known limitations, and any environment-gated cases in the project docs.
- [ ] Commit with `test(cli): certify maestro tui parity and live flow`.

## Execution order and gates

Tasks 1-5 establish the interactive runtime. Task 6 may begin only after typed read models and event/session behavior are truthful. Task 7 follows the read surface and approval dialog. Task 8 follows the command registry and server conversation contract. Task 9 follows event reconnect and server recovery evidence. Task 10 may proceed in parallel only as a branding-only slice but must not rename internal package paths casually. Task 11 is the final acceptance gate.

Every task ends with focused RED/GREEN evidence, build evidence, and a Conventional Commit. Do not mark the TUI operationally accepted without real PostgreSQL, real Control Plane/provider process behavior, durable stream/reconnect evidence, parity evidence, and independent no-edit review.

## Current execution note

Task 3 is constrained by the existing Control Plane boundary: it requires `DATABASE_URL` and an authenticated token, while no local database manager or first-run credential bootstrap exists. Implement the truthful resolver and setup-required UX first. Do not add an embedded database, plaintext token file, or fake local connection. A later server/bootstrap task must define and verify the local PostgreSQL and credential lifecycle before transparent auto-start can be claimed.


## Approved follow-up: provider-agnostic local first-run bootstrap

**Decision (2026-09-07):** A first-time local user must be able to launch `maestro` without manually assembling the local stack when the required local runtime is already available. Docker is optional, not a product requirement. PostgreSQL remains required by the current durable Control Plane architecture.

### Local startup policy

1. If `MAESTRO_API_URL` and `MAESTRO_API_TOKEN` are configured, connect to that existing Control Plane and do not start local services.
2. If no explicit endpoint is configured, detect the local runtime:
   - reuse a healthy local Control Plane when one is already running;
   - if the repository-approved local PostgreSQL runtime is available through Docker, start/reuse the disposable development database and run migrations;
   - if a native local PostgreSQL service is available, use it without Docker;
   - start/reuse the local Control Plane with bounded health/readiness checks and attach the TUI.
3. If neither Docker nor a usable native PostgreSQL service is available, do not install silently or fall back to SQLite/in-memory state. Show an actionable setup message explaining the missing dependency and the supported choices.
4. Local bootstrap may create only non-production local state and a local operator credential through an approved secure storage path. Provider credentials must not be persisted in PostgreSQL, workspace sessions, prompts, events, logs, or tool results.
5. Model-provider onboarding is explicitly out of scope for this bootstrap slice. An empty/unavailable model catalog must remain truthful until a provider is configured.

### Production boundary

This local convenience flow must not be presented as a production deployment mechanism. Production remains a separate operational path using an existing Control Plane, managed or self-operated PostgreSQL, and an external secret manager/service manager. Docker may be used in production, but is not required.

### Explicit non-goals

- Do not automate Codex or Claude Code login/OAuth.
- Do not invoke provider CLIs directly from the TUI as a bypass around the Control Plane and Model Gateway.
- Do not add SQLite, an embedded fake database, or plaintext bearer-token fallback.
- Do not silently install system packages or claim that a fresh machine is fully self-hosting until an installer/deployment slice is separately designed and verified.

### Acceptance criteria for the future bootstrap slice

- `maestro` with no endpoint configuration reuses or starts a usable local Control Plane when Docker or native PostgreSQL prerequisites are already present.
- A machine with neither supported PostgreSQL runtime receives a concrete, copyable setup instruction instead of `setup required` alone.
- An explicitly configured endpoint is never overridden by local auto-start.
- Startup, migration, credential creation, readiness, failure, and cleanup are bounded and observable without exposing secrets.
- TUI, non-interactive CLI, and provider onboarding remain separate concerns and retain their existing safety boundaries.
