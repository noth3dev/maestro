# E6 Overture Crew Collaborative Planning and Autonomous Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans to implement this plan task-by-task. Every task ends with a focused test cycle and an independent review gate.

**Goal:** Make Maestro's real product flow work from one natural-language planning conversation: Concertmaster assembles a bounded Overture Crew, the Crew writes a durable artifact-backed Task Contract with the operator, one exact launch approval starts the Goal, and the post-launch organization proceeds automatically through Heads, Council, Department Plans, Mission Bundles, Workers, Evidence, and certification.

**Architecture:** Keep Carnegie and the CLI as operator surfaces, but move Overture composition and post-launch progression into the Control Plane. A project-scoped Overture Run owns role assignments, durable artifacts, clarification state, and Task Contract revisions before a Goal exists. After exact Task Contract confirmation and launch, one durable orchestration controller advances existing Head, Council, Department Plan, Mission Bundle, Worker, Evidence, Metronome, Encore, and report services through idempotent events; it pauses only at explicit critical or unsafe boundaries.

**Tech Stack:** TypeScript, Zod contracts, PostgreSQL migrations, `@maestro/agent-runtime`, `ExecutionKernelPort`, `ModelGatewayPort`, Fastify routes, Electron API bridge, React Carnegie renderer, Vitest, real-PostgreSQL integration tests.

**Spec:** `docs/02-hierarchical-orchestration.md`, `roadmap/act-1-foundation/phase-02-hierarchical-execution.md`, `roadmap/act-1-foundation/phase-07-secretary-office-ui.md`, `execution/plan-E1-conversational-intake.md`, and the completed E5 boundary in `execution/plan-E5-gui-implementation.md`.

## Global Constraints

- E5 must be closed before E6 execution begins. E6 is a follow-on capability plan, not a replacement for E5's GUI bridge work.
- The operator uses one Concertmaster conversation. Raw Department IDs, Council IDs, plan versions, item IDs, and provider execution references are not primary operator inputs.
- Overture is a selectively activated Crew, not six always-running agents and not a local checkbox list.
- The six canonical roles are `conversation-lead`, `architecture-analyst`, `external-research-scout`, `security-evaluator`, `design-mock-specialist`, and `task-editor`.
- External research and design roles are conditional. Security boundary review is always present. The minimum role set is selected from the request and recorded durably.
- Every role receives a role-specific prompt, context boundary, model policy, tool allowlist, output budget, and project scope. No Overture role can spawn a Worker, create a Mission Bundle, modify the repository, or perform a critical action.
- Role output is durable artifact state with content hashes and evidence references. Provider text alone is never authoritative state.
- Task Editor owns one versioned Task Contract. A substantive change creates a new version and content hash.
- No Goal, Department Head, Mission Bundle, Worker, or execution-side state advances before the operator confirms the exact Task Contract version and content hash and launches it.
- Launch approval is the only ordinary execution approval. Critical actions, material scope changes, budget breaches, and unsafe ambiguity still stop and request the operator.
- PostgreSQL remains the operational source of truth. Mutations use command identity, project boundaries, append-only events where required, transactional outbox delivery, leases, and fencing.
- Do not overload `missionBundleId` to represent pre-launch Overture work. Add an explicit execution phase or equivalent authority field so pre-launch grants remain distinct from Worker Mission Bundles.
- Do not claim live provider, Electron, or deployed Control Plane acceptance without real environment evidence. Record blocked boundaries verbatim in `execution/PENDING_LIVE_CHECKS.md`.
- Do not touch `apps/cli/src/tui/**` for E6 unless a separately accepted TUI slice is required; Carnegie and Control Plane are the primary E6 surfaces.
- Do not add a new provider abstraction when the existing `createMaestroAgentRuntime`, `ExecutionKernelPort`, `ToolRegistry`, and `ModelGatewayPort` can express the required behavior.

## Entry Gate and Dependency Check

Before Task 1, re-run the E5 final verification and inspect the status of `execution/plan-E1-conversational-intake.md`.

E6 may start only when:

1. E5 has its required focused tests, Carnegie build, root non-integration suite, independent review, documentation update, and commit.
2. E1 G1–G5 are either complete or explicitly marked as dependencies carried into E6. E6 must not create a second goal-less conversation path.
3. Existing `TaskContractService`, task-contract exact confirmation, launch, Conversation Service, and native execution kernel contracts are re-used rather than shadowed.
4. The current E5 Task 5 reviewer findings are resolved before the E5 commit or explicitly separated from E6.

## Product State Machine

The implementation must make these states observable and durable:

```text
project conversation
  → overture collecting
  → overture waiting_for_operator (clarification)
  → overture synthesizing
  → task contract review
  → task contract amended/reviewed
  → exact confirmation
  → launched
  → goal orchestration running
  → blocked / paused / completed / failed
```

The following transitions are forbidden:

- vague text → fabricated Task Contract;
- Overture artifact → launched Goal without exact confirmation;
- launch → manual Department or Worker identity entry as a required step;
- provider reply → durable success without a persisted result;
- stale project, conversation, run, or artifact data → current UI state;
- failed automatic step → silent local retry without an idempotent durable command.

---

### Task 1: Define Overture Crew, Artifact, and Execution-Phase Contracts

**Files:**
- Create: `packages/domain/src/overture-crew.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `packages/domain/src/overture-crew.test.ts`
- Create: `packages/contracts/src/schemas/overture-crew.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/overture-crew.test.ts`
- Modify: `packages/domain/src/execution-kernel.ts`
- Modify: `packages/domain/src/execution-kernel.test.ts`

**Interfaces:**

```ts
export type OvertureCrewRoleId =
  | "conversation-lead"
  | "architecture-analyst"
  | "external-research-scout"
  | "security-evaluator"
  | "design-mock-specialist"
  | "task-editor";

export type OvertureRunState =
  | "collecting"
  | "waiting_for_operator"
  | "synthesizing"
  | "review"
  | "blocked"
  | "launched"
  | "cancelled";

export type OvertureArtifactKind =
  | "intent"
  | "project-context"
  | "external-research"
  | "security-review"
  | "design-preview"
  | "decision-note"
  | "task-contract";

export interface OvertureRun {
  readonly runId: string;
  readonly conversationId: string;
  readonly projectId: string;
  readonly state: OvertureRunState;
  readonly selectedRoles: readonly OvertureCrewRoleId[];
  readonly taskContractId?: string;
  readonly taskContractVersion?: number;
  readonly taskContractHash?: string;
  readonly version: number;
}

export interface OvertureArtifact {
  readonly artifactId: string;
  readonly runId: string;
  readonly projectId: string;
  readonly roleId: OvertureCrewRoleId;
  readonly kind: OvertureArtifactKind;
  readonly version: number;
  readonly title: string;
  readonly content: string;
  readonly contentHash: string;
  readonly evidenceReferences: readonly string[];
  readonly status: "draft" | "accepted" | "superseded";
  readonly createdAt: string;
}

export interface InvocationContext {
  readonly executionPhase?: "conversation" | "overture" | "head" | "worker" | "review";
}
```

- [ ] **Step 1: Write failing domain tests for canonical role selection.**
  Cover the mandatory roles, conditional external research and design roles, stable ordering, legacy role migration, duplicate removal, and rejection of unknown role IDs.
- [ ] **Step 2: Write failing contract tests for run and artifact schemas.**
  Reject empty IDs, invalid role or state values, empty content, invalid hashes, cross-project references, negative versions, and unknown fields. Round-trip a complete run and artifact.
- [ ] **Step 3: Write failing execution-context tests for the explicit phase.**
  Prove that `overture` context is project-scoped, has no Goal requirement, cannot carry Worker-only authority fields, and is not silently accepted as a `worker` context.
- [ ] **Step 4: Implement the domain helpers and Zod schemas.**
  Reuse the existing canonical Overture role list and hash helper. Keep `missionBundleId` required for existing Worker paths; add the explicit phase and enforce its meaning at the native admission boundary rather than using a fake Mission Bundle identity.
- [ ] **Step 5: Run focused contract tests.**

```bash
npx vitest run packages/domain/src/overture-crew.test.ts packages/domain/src/execution-kernel.test.ts packages/contracts/src/overture-crew.test.ts
```

- [ ] **Step 6: Commit.**

```bash
git add packages/domain/src/overture-crew.ts packages/domain/src/overture-crew.test.ts packages/domain/src/execution-kernel.ts packages/domain/src/execution-kernel.test.ts packages/domain/src/index.ts packages/contracts/src/schemas/overture-crew.ts packages/contracts/src/overture-crew.test.ts packages/contracts/src/index.ts
git commit -m "feat(domain): define overture crew and artifact contracts"
```

---

### Task 2: Persist Overture Runs, Role Assignments, Artifacts, and Clarifications

**Files:**
- Create: `packages/persistence/migrations/0106_overture_crew_runs.sql`
- Create: `packages/persistence/src/overture-crew.ts`
- Create: `packages/persistence/src/overture-crew.test.ts`
- Create: `packages/persistence/src/overture-crew.integration.test.ts`
- Modify: `packages/persistence/src/index.ts`
- Modify: `packages/persistence/src/test-migrations.integration.test.ts`

**Database shape:**

- `overture_runs`: `run_id`, `conversation_id`, `project_id`, `state`, `selected_roles`, `task_contract_id`, `task_contract_version`, `task_contract_hash`, `version`, `created_at`, `updated_at`.
- `overture_artifacts`: `artifact_id`, `run_id`, `project_id`, `role_id`, `kind`, `version`, `title`, `content`, `content_hash`, `evidence_references`, `status`, `created_at`.
- `overture_clarifications`: `clarification_id`, `run_id`, `project_id`, `question`, `answer`, `state`, `command_id`, `created_at`, `answered_at`.
- Foreign keys bind every row to the same project and run. Unique constraints prevent two active versions of the same role/kind artifact and two different results for one command ID.
- Append-only artifact and clarification history is preserved. Current state is read through a deterministic latest-version query.

**Interfaces:**

```ts
export interface OvertureCrewStore {
  createRun(input: { runId: string; conversationId: string; projectId: string; roles: readonly OvertureCrewRoleId[]; commandId: string }): Promise<OvertureRun>;
  readRun(runId: string, projectId: string): Promise<OvertureRun>;
  transitionRun(runId: string, projectId: string, expectedVersion: number, state: OvertureRunState, commandId: string): Promise<OvertureRun>;
  appendArtifact(input: OvertureArtifactInput, commandId: string): Promise<OvertureArtifact>;
  listArtifacts(runId: string, projectId: string): Promise<readonly OvertureArtifact[]>;
  recordClarification(input: ClarificationInput, commandId: string): Promise<Clarification>;
}
```

- [ ] **Step 1: Write failing unit tests for project-bound reads, idempotency, version conflicts, and append-only artifact revisions.**
- [ ] **Step 2: Write failing PostgreSQL tests for migration shape, foreign keys, unique constraints, command replay, and cross-project denial.**
- [ ] **Step 3: Add migration `0106_overture_crew_runs.sql` using the repository's migration style.**
- [ ] **Step 4: Implement transactional store functions with command receipts and stable hashes.**
  A repeated command with identical content returns the original result. Reusing a command ID with changed content fails. State transitions require the expected run version.
- [ ] **Step 5: Add durable domain events and outbox rows for run creation, role activation, artifact append, clarification request, clarification answer, synthesis, and launch readiness.**
- [ ] **Step 6: Run focused persistence tests with the repository's embedded or PostgreSQL test harness.**

```bash
npx vitest run packages/persistence/src/overture-crew.test.ts packages/persistence/src/overture-crew.integration.test.ts packages/persistence/src/test-migrations.integration.test.ts
```

- [ ] **Step 7: Commit.**

```bash
git add packages/persistence/migrations/0106_overture_crew_runs.sql packages/persistence/src/overture-crew.ts packages/persistence/src/overture-crew.test.ts packages/persistence/src/overture-crew.integration.test.ts packages/persistence/src/index.ts packages/persistence/src/test-migrations.integration.test.ts
git commit -m "feat(persistence): store overture runs and planning artifacts"
```

---

### Task 3: Build Role-Specific Overture Runtime and Safe Crew Tools

**Files:**
- Create: `packages/agent-runtime/src/overture-role-prompts.ts`
- Create: `packages/agent-runtime/src/overture-crew-runtime.ts`
- Create: `packages/agent-runtime/src/overture-crew-runtime.test.ts`
- Modify: `packages/agent-runtime/src/overture-drafting-tool.ts`
- Modify: `packages/agent-runtime/src/index.ts`
- Create: `apps/control-plane/src/overture-crew-tools.ts`
- Create: `apps/control-plane/src/overture-crew-tools.test.ts`

**Role behavior:**

- `conversation-lead`: maintain the operator dialogue and request one focused clarification when required.
- `architecture-analyst`: use only authorized project read and Git revision evidence; produce project-context artifacts.
- `external-research-scout`: use only explicitly permitted public evidence; produce cited research artifacts.
- `security-evaluator`: inspect scope, data boundary, authority, budget, critical actions, and stopping conditions.
- `design-mock-specialist`: produce a disposable design artifact only when the Task Contract requires a preview; no production UI mutation.
- `task-editor`: read the accepted role artifacts, resolve contradictions, and propose a complete Task Contract version.

**Interfaces:**

```ts
export interface OvertureCrewRuntime {
  runRole(input: {
    run: OvertureRun;
    roleId: OvertureCrewRoleId;
    trigger: "initial" | "operator-answer" | "artifact-revision";
    commandId: string;
  }): Promise<{ invocation: InvocationRef; artifact?: OvertureArtifact; clarification?: Clarification }>;
}
```

- [ ] **Step 1: Write failing tests proving each role receives a distinct role prompt and only its allowed tools.**
- [ ] **Step 2: Write failing authority tests.**
  Prove no Overture role can call Worker spawn, Mission Bundle creation, repository write, Git integration, critical-action approval, or a tool not present in its grant.
- [ ] **Step 3: Write failing tests for read-only project context and public research data boundaries.**
  Use the existing authorized read-only file and Git revision ports. Reject `.env`, credentials, paths outside the project, and undeclared outbound data classes.
- [ ] **Step 4: Write failing tests for clarification behavior.**
  A role that lacks required facts records a durable clarification request and leaves the run in `waiting_for_operator`; it must not fill required Task Contract fields with placeholders.
- [ ] **Step 5: Implement role prompt composition and tool registration.**
  Use `createMaestroAgentRuntime` and the existing gateway/kernel path. Persist provider execution binding before presenting a role result. Keep tool output separate from the provider's final text.
- [ ] **Step 6: Implement Task Editor synthesis through the existing Task Contract service.**
  The tool may create or amend an awaiting-confirmation contract only. It may not confirm or launch it.
- [ ] **Step 7: Run focused runtime and authority tests.**

```bash
npx vitest run packages/agent-runtime/src/overture-crew-runtime.test.ts apps/control-plane/src/overture-crew-tools.test.ts packages/agent-runtime/src/overture-drafting-tool.test.ts
```

- [ ] **Step 8: Commit.**

```bash
git add packages/agent-runtime/src/overture-role-prompts.ts packages/agent-runtime/src/overture-crew-runtime.ts packages/agent-runtime/src/overture-crew-runtime.test.ts packages/agent-runtime/src/overture-drafting-tool.ts packages/agent-runtime/src/index.ts apps/control-plane/src/overture-crew-tools.ts apps/control-plane/src/overture-crew-tools.test.ts
git commit -m "feat(agent-runtime): compose bounded overture crew roles"
```

---

### Task 4: Connect Goal-Less Conversation to the Durable Overture Run

**Files:**
- Create: `apps/control-plane/src/overture-crew-service.ts`
- Create: `apps/control-plane/src/overture-crew-service.test.ts`
- Create: `apps/control-plane/src/routes/overture.ts`
- Create: `apps/control-plane/src/overture-api.integration.test.ts`
- Modify: `apps/control-plane/src/conversation-service.ts`
- Modify: `apps/control-plane/src/server.ts`
- Modify: `apps/control-plane/src/composition/foundation-services.ts`
- Modify: `packages/contracts/src/schemas/conversation.ts` or its current owning file
- Modify: `packages/api-client/src/client.ts`
- Create: `packages/api-client/src/methods/overture.ts`
- Create: `packages/api-client/src/methods/overture.test.ts`

**Interfaces:**

```ts
export interface OvertureCrewService {
  start(input: { conversationId: string; projectId: string; brief: string; commandId: string }, operator: OperatorContext): Promise<OvertureRun>;
  answer(runId: string, input: { projectId: string; clarificationId: string; answer: string; commandId: string }, operator: OperatorContext): Promise<OvertureRun>;
  get(runId: string, projectId: string, operator: OperatorContext): Promise<OvertureRun>;
  listArtifacts(runId: string, projectId: string, operator: OperatorContext): Promise<readonly OvertureArtifact[]>;
}
```

- [ ] **Step 1: Write failing Control Plane tests for a project-scoped, goal-less conversation starting one Overture Run.**
  The same conversation cannot create two runs for the same active planning request. A Goal-bound conversation cannot call the Overture start route.
- [ ] **Step 2: Write failing tests for natural-language follow-up.**
  A vague request produces a real clarification event. A complete answer resumes the same run and does not create a second conversation or run.
- [ ] **Step 3: Write failing route tests for project boundaries, operator role, idempotency, and stable error envelopes.**
- [ ] **Step 4: Implement the service and route composition.**
  The Conversation Service remains the user-facing stream. The Overture service owns Crew state and artifact reads. Concertmaster is the conversation coordinator; role runtimes are subordinate bounded invocations.
- [ ] **Step 5: Add the API-client methods and Electron bridge entries.**
  Expose only typed methods for starting a run, reading the run, listing artifacts, answering a clarification, and reading the linked Task Contract. Do not expose raw provider execution references as operator actions.
- [ ] **Step 6: Run focused Control Plane and API-client tests.**

```bash
npx vitest run apps/control-plane/src/overture-crew-service.test.ts apps/control-plane/src/overture-api.integration.test.ts packages/api-client/src/methods/overture.test.ts apps/control-plane/src/conversation-service.test.ts
```

- [ ] **Step 7: Commit.**

```bash
git add apps/control-plane/src/overture-crew-service.ts apps/control-plane/src/overture-crew-service.test.ts apps/control-plane/src/routes/overture.ts apps/control-plane/src/overture-api.integration.test.ts apps/control-plane/src/conversation-service.ts apps/control-plane/src/server.ts apps/control-plane/src/composition/foundation-services.ts packages/contracts/src packages/api-client/src/client.ts packages/api-client/src/methods/overture.ts packages/api-client/src/methods/overture.test.ts apps/carnegie/electron/apiBridge.ts
 git commit -m "feat(control-plane): connect conversation to overture runs"
```

---

### Task 5: Add Carnegie's Artifact-Backed Planning Conversation

**Files:**
- Create: `apps/carnegie/src/lib/overture-data.ts`
- Create: `apps/carnegie/src/lib/overture-data.test.ts`
- Modify: `apps/carnegie/src/views/Home.tsx`
- Modify: `apps/carnegie/src/views/Home.test.tsx`
- Modify: `apps/carnegie/src/views/Planning.tsx`
- Modify: `apps/carnegie/src/views/Planning.test.tsx`
- Modify: `apps/carnegie/src/views.ts`
- Modify: `apps/carnegie/src/components/Sidebar.tsx`

**Interfaces:**

```ts
export type OvertureConversationApi = Pick<ApiClient,
  "createConversation" | "getConversation" | "listConversationEvents" |
  "sendConversationTurn" | "cancelConversation" | "startOvertureRun" |
  "getOvertureRun" | "listOvertureArtifacts" | "answerOvertureClarification" |
  "getTaskContract" | "updateTaskContract" | "confirmTaskContract" | "launchTaskContract"
>;

export async function loadOvertureWorkspace(
  api: OvertureConversationApi,
  input: { conversationId: string; runId: string; projectId: string },
): Promise<{ messages: readonly ConversationMessage[]; run: OvertureRun; artifacts: readonly OvertureArtifact[]; contract?: TaskContract }>;
```

- [ ] **Step 1: Write failing renderer tests for the complete operator journey.**
  Start from a project with no Goal, send “plan this”, display the real Concertmaster response, display role activity and artifact revisions, show clarification questions, and continue the same conversation.
- [ ] **Step 2: Write failing tests for stale and cross-project workspace data.**
  A project change clears the workspace. A run or artifact from another project is rejected. Loading and retrying cannot leave a previous artifact or contract visible as current.
- [ ] **Step 3: Write failing tests for Task Contract review and launch.**
  The UI displays version and content hash, uses the server update response, requires exact confirmation, and performs launch as a separate action. It must not expose Head, Council, Department Plan, or Mission Bundle identity fields as required inputs.
- [ ] **Step 4: Implement the Home conversation and artifact workspace.**
  Keep one Concertmaster transcript as the main interaction. Add progressive disclosure for role activity, artifact cards, source references, diffs, clarification state, contract state, and launch readiness.
- [ ] **Step 5: Reduce Planning to a durable post-launch read surface.**
  Keep E5's planning reads useful, but remove manual identity entry as the normal route. When a launched Goal has a durable planning record, derive all IDs from server responses and show unavailable or blocked states honestly.
- [ ] **Step 6: Run focused Carnegie tests and build.**

```bash
npx vitest run apps/carnegie/src/lib/overture-data.test.ts apps/carnegie/src/views/Home.test.tsx apps/carnegie/src/views/Planning.test.tsx
cd apps/carnegie && npm run build
```

- [ ] **Step 7: Commit.**

```bash
git add apps/carnegie/src/lib/overture-data.ts apps/carnegie/src/lib/overture-data.test.ts apps/carnegie/src/views/Home.tsx apps/carnegie/src/views/Home.test.tsx apps/carnegie/src/views/Planning.tsx apps/carnegie/src/views/Planning.test.tsx apps/carnegie/src/views.ts apps/carnegie/src/components/Sidebar.tsx
git commit -m "feat(carnegie): show artifact-backed overture planning"
```

---

### Task 6: Make Launch Start Automatic Goal Orchestration

**Files:**
- Create: `apps/control-plane/src/goal-orchestration-service.ts`
- Create: `apps/control-plane/src/goal-orchestration-service.test.ts`
- Create: `apps/control-plane/src/goal-orchestration.integration.test.ts`
- Modify: `apps/control-plane/src/task-contract-service.ts`
- Modify: `apps/control-plane/src/routes/task-contracts.ts`
- Modify: `apps/control-plane/src/composition/execution-services.ts`
- Modify: `apps/control-plane/src/composition/foundation-services.ts`
- Modify: `packages/persistence/src/commands.ts` or the existing launch command owner
- Modify: `packages/persistence/src/head-participation.ts`
- Modify: `apps/control-plane/src/council-service.ts`
- Modify: `apps/control-plane/src/department-plan-service.ts`
- Modify: `apps/control-plane/src/mission-bundle-service.ts`
- Modify: `apps/control-plane/src/worker-service.ts`

**Automatic sequence:**

1. Exact Task Contract launch creates or attaches the durable Goal using the contract ID and project boundary.
2. The orchestrator reads `expectedGroups` and `expectedDepartments` from the launched contract and selects the smallest valid Head set.
3. Heads are activated through the existing durable reservation and native admission path.
4. Each Head produces an independent sealed brief. Missing evidence may spawn a read-only Scout Worker only when the existing policy allows it.
5. Council reveal and decision happen when required briefs are present or the bounded deadline policy resolves a timeout.
6. Department Plans and Mission Bundles are created from the resolved decision packet, with exact plan version and item identity.
7. Workers are dispatched through the existing capacity, admission, lease, and Mission Bundle checks.
8. Evidence, Metronome, Quality, Encore, and Concertmaster report services continue through existing durable contracts.

- [ ] **Step 1: Write failing integration tests proving launch alone starts the first automatic orchestration command.**
  Before launch, no Goal, Head, Council, Plan, Bundle, or Worker execution state may advance. After launch, the first durable orchestration event must be present without a second operator button.
- [ ] **Step 2: Write failing tests for idempotent outbox replay and process restart.**
  Replaying launch or an orchestration event cannot duplicate a Goal, Head, Council, Plan, Bundle, Worker, or provider side effect.
- [ ] **Step 3: Write failing tests for dependency and timeout handling.**
  A required missing artifact pauses the run with a durable blocker. A bounded Council timeout produces an explicit blocked or escalation state, never a fabricated decision.
- [ ] **Step 4: Write failing authority tests.**
  Automatic progression cannot bypass Task Contract launch, project/Goal scope, leases, fencing, capacity, authority approval, or critical-action boundaries.
- [ ] **Step 5: Implement the orchestration controller as a resumable state machine.**
  Use transactional outbox handlers and durable command receipts. Store the next action and expected version before invoking a provider. Record provider binding and terminal result before releasing runtime state.
- [ ] **Step 6: Connect the launch route to the controller without making the HTTP request wait for the full Goal.**
  The launch response returns the launched contract and durable scheduling acknowledgement. The controller continues from the outbox and can recover after process restart.
- [ ] **Step 7: Run focused orchestration integration tests.**

```bash
npx vitest run apps/control-plane/src/goal-orchestration-service.test.ts apps/control-plane/src/goal-orchestration.integration.test.ts packages/persistence/src/task-contract.integration.test.ts
```

- [ ] **Step 8: Commit.**

```bash
git add apps/control-plane/src/goal-orchestration-service.ts apps/control-plane/src/goal-orchestration-service.test.ts apps/control-plane/src/goal-orchestration.integration.test.ts apps/control-plane/src/task-contract-service.ts apps/control-plane/src/routes/task-contracts.ts apps/control-plane/src/composition/execution-services.ts apps/control-plane/src/composition/foundation-services.ts packages/persistence/src/commands.ts packages/persistence/src/head-participation.ts apps/control-plane/src/council-service.ts apps/control-plane/src/department-plan-service.ts apps/control-plane/src/mission-bundle-service.ts apps/control-plane/src/worker-service.ts
git commit -m "feat(control-plane): start automatic goal orchestration on launch"
```

---

### Task 7: Add End-to-End Overture and Autonomous-Run Evidence

**Files:**
- Create: `test/phase9-scenario/overture-autonomous.integration.test.ts`
- Create: `test/phase9-scenario/RUNBOOK.md`
- Modify: `execution/e5-capability-matrix.md`
- Modify: `execution/PENDING_LIVE_CHECKS.md`
- Modify: `roadmap/act-1-foundation/active/operations/progress.md`
- Modify: `docs/02-hierarchical-orchestration.md`
- Modify: `docs/ko/02-hierarchical-orchestration.md`

- [ ] **Step 1: Write a real-PostgreSQL scenario for a non-destructive planning request.**
  The scenario must record the goal-less conversation, selected Overture roles, at least one artifact per active role, a clarification round when needed, Task Contract versions and hashes, exact confirmation, launch, automatic Head/Council/Plan/Bundle progression, and the first Worker admission.
- [ ] **Step 2: Add negative cases.**
  Verify no execution before launch, no cross-project artifact access, no unknown role, no stale artifact display, no duplicate launch effect, no duplicate provider spawn, and no critical action bypass.
- [ ] **Step 3: Run focused integration coverage with disposable PostgreSQL and the fake provider.**

```bash
npx vitest run test/phase9-scenario/overture-autonomous.integration.test.ts
```

- [ ] **Step 4: Run the full required verification.**

```bash
npx vitest run --exclude '**/*.integration.test.ts'
npx vitest run
cd apps/carnegie && npm run build
```

- [ ] **Step 5: Attempt live Carnegie/provider acceptance only when the environment is available.**
  Save conversation ID, run ID, artifact IDs, contract ID, Goal ID, durable event cursors, and screenshots. If unavailable, record the exact blocker and do not report live success.
- [ ] **Step 6: Perform an independent no-edit review against this plan.**
  The reviewer must inspect role composition, artifact durability, authority boundaries, exact launch binding, automatic progression, restart behavior, project scoping, and the end-to-end scenario.
- [ ] **Step 7: Update capability and status documents only with evidence-backed claims.**
- [ ] **Step 8: Commit.**

```bash
git add test/phase9-scenario execution/e5-capability-matrix.md execution/PENDING_LIVE_CHECKS.md roadmap/act-1-foundation/active/operations/progress.md docs/02-hierarchical-orchestration.md docs/ko/02-hierarchical-orchestration.md
git commit -m "test(phase9): verify overture planning and autonomous execution"
```

## E6 Exit Gate

E6 is complete only when all of these are true:

- A project-scoped conversation can start a real Overture Run without a selected Goal.
- Concertmaster activates the minimum required roles and each active role produces a durable, scoped artifact.
- Clarification is conversational and resumable. Missing facts are never replaced with placeholder values.
- Task Editor produces one versioned Task Contract tied to its source artifacts.
- The operator sees and confirms the exact Task Contract version and content hash.
- No Goal or execution state advances before launch.
- Launch automatically schedules the next orchestration stage without manual Department or Worker identity entry.
- Restart and outbox replay do not duplicate durable state or provider effects.
- All worker execution remains inside existing Mission Bundle, capacity, authority, lease, fencing, Git, evidence, and certification boundaries.
- Carnegie shows the conversation, artifacts, blockers, launch state, and post-launch progress without fabricated success.
- Focused tests, root non-integration tests, full integration tests, Carnegie build, independent review, and the phase scenario have recorded passing evidence or an explicit documented blocker.

## Plan Review Checklist

- [ ] E1 dependency status is recorded before implementation.
- [ ] E5 is committed before E6 execution.
- [ ] No task creates a second Task Contract or goal-less conversation path.
- [ ] No task uses `missionBundleId` as a hidden Overture authority substitute.
- [ ] Every role output has a durable artifact and content hash.
- [ ] Every mutation has project scope, command identity, and a retry rule.
- [ ] Every automatic transition has a durable event and recovery path.
- [ ] Every operator-visible success has a server or provider proof.
- [ ] Every live acceptance claim has IDs, cursors, and saved evidence.
