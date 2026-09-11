import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ProviderRegistry, type ModelProviderPort, type ProviderPlugin } from "@maestro/agent-runtime";
import { applyAllMigrations, bootstrapLocalOperator, createDurableTaskContract, launchConfirmedTaskContract, recordExactTaskContractConfirmation } from "@maestro/persistence";
import { grantProjectMembership, grantProjectRole } from "@maestro/persistence/testing";
import { InMemoryCredentialStore } from "../../model-gateway/src/credential-store.js";
import { createModelGateway } from "../../model-gateway/src/gateway.js";
import { buildModelGatewayServer } from "../../model-gateway/src/rpc.js";
import { createControlPlane } from "./main.js";
import type { MaestroConfig } from "./config.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const GATEWAY_OPERATOR_ID = "gateway-operator";
const PROVIDER_ACCOUNT_REF = "acceptance-account-1";
const seenToolSets: string[][] = [];

/** A real provider plugin (not a mocked `ExecutionKernelPort`): it answers over
 * an in-process object, but the Control Plane, native runtime, and Model
 * Gateway HTTP boundary between it and the caller are all real processes. */
function fakeProviderPlugin(pool: Pool): ProviderPlugin {
  const identity = { provider: "test", id: "model-a" };
  const dataPolicy = { allowedDataClasses: ["public"] as const, retention: "none" as const, trainsOnCustomerData: false, regions: ["us"] };
  const preparedWorkers = new Set<string>();
  const port: ModelProviderPort = {
    identity, accountRef: PROVIDER_ACCOUNT_REF, capabilities: new Set(["text"]),
    async turn(request) {
      seenToolSets.push(request.tools.map((tool) => tool.name));
      const hasIpPython = request.tools.some((tool) => tool.name === "ipython");
      const hasToolResult = request.messages.some((message) => message.role === "tool");
      if (hasIpPython && !hasToolResult) {
        const workerResult = await pool.query<{ worker_id: string; goal_id: string; project_id: string; spawn_command_id: string; control_epoch: string; council_id: string }>(
          `SELECT w.worker_id, hc.goal_id, g.project_id, w.spawn_command_id, gc.control_epoch, w.council_id
             FROM workers w JOIN head_councils hc ON hc.council_id = w.council_id
             JOIN goals g ON g.goal_id = hc.goal_id
             JOIN goal_controls gc ON gc.goal_id = g.goal_id AND gc.project_id = g.project_id
            WHERE w.spawn_command_id IS NOT NULL ORDER BY w.heartbeat_at DESC LIMIT 1`,
        );
        const worker = workerResult.rows[0];
        if (worker !== undefined && !preparedWorkers.has(worker.worker_id)) {
          const bundleResult = await pool.query<{ substance: { environment?: unknown } }>(
            "SELECT substance FROM mission_bundles WHERE council_id = $1 AND item_id = 'exec-1' ORDER BY created_at DESC LIMIT 1", [worker.council_id],
          );
          const environmentId = Array.isArray(bundleResult.rows[0]?.substance.environment) ? bundleResult.rows[0]?.substance.environment[0] : undefined;
          if (typeof environmentId !== "string") throw new Error("acceptance environment binding was not declared");
          await pool.query(
            `INSERT INTO environments (environment_id, recipe_version, goal_id, department_id, worker_id, project_id, mission_id, environment_type, recipe, resolved_inputs, capabilities, boundaries, secrets_references, resource_ceilings, expires_at, state, setup_log, health, content_identity, cleanup)
             VALUES ($1, 1, $2, 'product', $3, $4, $5, 'local_worktree', '{}'::jsonb, '{}'::jsonb, $6::jsonb, $7::jsonb, '[]'::jsonb, $8::jsonb, clock_timestamp() + interval '10 minutes', 'ready', '[]'::jsonb, $9::jsonb, $10, $11::jsonb)`,
            [environmentId, worker.goal_id, worker.worker_id, worker.project_id, randomUUID(), JSON.stringify([{ name: "python3", version: "3" }]), JSON.stringify({ network: ["none"], filesystem: ["/tmp"], processes: ["python3"], browsers: [], devices: [] }), JSON.stringify({ cpuMillis: 1000, memoryMb: 128, diskMb: 256, processCount: 2, durationSeconds: 60 }), JSON.stringify({ status: "healthy", checkedAt: null, summary: null }), "e".repeat(64), JSON.stringify({ status: "not_scheduled", scheduledAt: null, completedAt: null, ownedResources: [], retainedEvidence: [] })],
          );
          preparedWorkers.add(worker.worker_id);
        }
        return { requestId: request.requestId, model: identity, text: "", toolCalls: [{ id: "acceptance-ipython-1", name: "ipython", arguments: { state: "valid", value: { code: "write_file('src/approved.txt', 'approved worker effect')\nprint('worker local effect complete')" } } }], stopReason: "tool_use", usage: { state: "unknown" } };
      }
      const toolText = request.messages.filter((message) => message.role === "tool").map((message) => JSON.stringify(message.content)).join("\n");
      const localEffectObserved = toolText.includes("worker local effect complete");
      const complete = localEffectObserved;
      return { requestId: request.requestId, model: identity, text: complete ? "worker ipython local effect complete" : "acceptance run incomplete", toolCalls: [], stopReason: "end_turn", usage: { state: "unknown" } };
    },
    async cancel() { return { state: "confirmed" as const }; },
    async close() {},
  };
  return {
    id: "test", authModes: ["api-key"], capabilities: new Set(["text"]), dataPolicy,
    listModels: () => [{ identity, capabilities: new Set(["text"]), authModes: ["api-key"], dataPolicy }],
    create: async (request) => ({ ...port, accountRef: request.account.accountRef }),
  };
}

describeDatabase("real Control Plane + PostgreSQL + Model Gateway Worker acceptance", () => {
  const basePool = new Pool({ connectionString: databaseUrl });
  const schema = `native_worker_acceptance_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = databaseUrl === undefined ? "" : (() => { const url = new URL(databaseUrl); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })();
  let pool: Pool;
  let gatewayApp: Awaited<ReturnType<typeof buildModelGatewayServer>>;
  let gatewayUrl: string;

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: scopedUrl });
    await applyAllMigrations(pool);
    const credentials = new InMemoryCredentialStore();
    await credentials.bind({ operatorId: GATEWAY_OPERATOR_ID, providerId: "test", authMode: "api-key", accountRef: PROVIDER_ACCOUNT_REF }, "provider-secret-not-real");
    const registry = new ProviderRegistry();
    registry.register(fakeProviderPlugin(pool));
    const gateway = createModelGateway({ registry, credentials, operatorId: GATEWAY_OPERATOR_ID, instanceId: "acceptance-gateway" });
    gatewayApp = buildModelGatewayServer({ gateway, token: "gateway-acceptance-token", operatorId: GATEWAY_OPERATOR_ID });
    await gatewayApp.listen({ host: "127.0.0.1", port: 0 });
    const address = gatewayApp.server.address();
    if (address === null || typeof address === "string") throw new Error("Model Gateway did not bind TCP");
    gatewayUrl = `http://127.0.0.1:${address.port}`;
  });
  beforeEach(async () => {
    seenToolSets.length = 0;
    await pool.query(
      "TRUNCATE native_execution_bindings, workers, team_lead_grants, mission_bundles, department_plans, department_plan_revisions, department_branches, council_protocol_events, council_round_contributions, council_rounds, independent_briefs, council_participants, head_councils, head_activation_edges, head_activation_attempts, goal_head_participations, task_contract_confirmations, task_contract_decisions, task_contracts, evidence_records, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls, local_operator_credentials, local_operators, operator_project_memberships CASCADE",
    );
  });
  afterAll(async () => {
    await gatewayApp.close();
    await pool.end();
    await basePool.query(`DROP SCHEMA ${schema} CASCADE`);
    await basePool.end();
  });

  it("admits a real native Head and Worker through authenticated HTTP, a real Model Gateway process, and real PostgreSQL", async () => {
    const secret = `native-acceptance-${randomUUID()}`;
    const repositoryPath = `/tmp/maestro-native-acceptance-${randomUUID()}`;
    mkdirSync(repositoryPath, { recursive: true });
    execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: repositoryPath });
    mkdirSync(`${repositoryPath}/src`, { recursive: true });
    writeFileSync(`${repositoryPath}/src/allowed.txt`, "allowed worker evidence");
    execFileSync("git", ["-c", "user.name=acceptance", "-c", "user.email=acceptance@example.com", "add", "src/allowed.txt"], { cwd: repositoryPath });
    execFileSync("git", ["-c", "user.name=acceptance", "-c", "user.email=acceptance@example.com", "commit", "-m", "initial"], { cwd: repositoryPath });
    const immutableBaseRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryPath }).toString().trim();
    const { credentialId, operatorId } = await bootstrapLocalOperator(pool, { secret });
    const projectId = randomUUID();
    const goalId = randomUUID();
    const contractId = randomUUID();
    await grantProjectMembership(pool, operatorId, projectId);
    await grantProjectRole(pool, operatorId, projectId, "concertmaster");
    await grantProjectRole(pool, operatorId, projectId, "head-product");
    const substance = {
      desiredOutcome: "prove the real native path", userVisibleBehavior: ["evidence exists"], successCriteria: ["binding recorded"], liveEvidence: ["gateway response"],
      scope: ["one change"], nonGoals: ["unrelated work"], priorities: ["safety"], acceptableTradeoffs: ["no UI"], constraints: ["local"], knownEdgeCases: ["retry"],
      project: { projectId, repository: repositoryPath, immutableBaseRevision, dataBoundary: "repository only" },
      evidenceReferences: [], approvedPreviewReferences: [], expectedGroups: ["Product Group"], expectedDepartments: ["Product Department"],
      criticalActionExpectations: [], forbiddenEffects: ["remote push"], environmentAssumptions: ["PostgreSQL"], externalServiceAssumptions: [],
      budget: { ceiling: "100 USD", reportingExpectations: ["report"], stoppingConditions: ["stop"] },
    };
    const contract = await createDurableTaskContract(pool, contractId, substance);
    await recordExactTaskContractConfirmation(pool, contractId, contract.version, contract.contentHash, "ceo");
    await launchConfirmedTaskContract(pool, contractId);

    const config: MaestroConfig = {
      databaseUrl: scopedUrl, evidenceDir: "/tmp/maestro-evidence", worktreeRoot: "/tmp",
      host: "127.0.0.1", port: 0, actorId: "maestro-control-plane", leaseOwnerId: `native-acceptance-${randomUUID()}`,
      reconcilerLeaseDurationMs: 30_000,
      modelRoutingMode: "pin",
      modelGatewayUrl: gatewayUrl, modelGatewayToken: "gateway-acceptance-token", modelGatewayOperatorId: GATEWAY_OPERATOR_ID,
      nativeModelRef: "test/model-a", modelAccountRefs: { test: PROVIDER_ACCOUNT_REF },
    };
    // No `executionKernel` or `nativeAdmission` override: this exercises the
    // real production composition path in `createControlPlane`, which builds
    // the native kernel from `config.modelGatewayUrl`/`modelGatewayToken` and
    // wires it to the real Model Gateway HTTP process started above.
    const controlPlane = createControlPlane(config);
    await controlPlane.listen();
    const address = controlPlane.app.server.address();
    if (address === null || typeof address === "string") throw new Error("Expected TCP listener");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const auth = { authorization: `Bearer ${credentialId}.${secret}`, "content-type": "application/json" };
    const send = (path: string, method: string, body: unknown, command = randomUUID()) =>
      fetch(`${baseUrl}${path}`, { method, headers: { ...auth, "idempotency-key": command }, body: JSON.stringify(body) });
    try {
      expect((await send("/v1/goals", "POST", { projectId, contractId }, goalId)).status).toBe(201);
      for (const [expectedVersion, to] of [[1, "ready_for_confirmation"], [2, "launched"], [3, "active"]] as const) {
        expect((await send(`/v1/goals/${goalId}/transitions`, "POST", { projectId, expectedVersion, to })).status).toBe(200);
      }
      // Real native Head activation: this makes a real HTTP admit+turn call
      // to the Model Gateway process above and prompts the fake `test`
      // provider for the Department Head's opening context.
      const activation = { projectId, departmentId: "product", contractId, requestedContribution: "own product", urgency: "normal", contextScope: ["confirmed contract"], budgetEffect: "within envelope", reason: "prepare council" };
      const activated = await send(`/v1/goals/${goalId}/head-participations`, "POST", activation);
      expect(activated.status).toBe(200);
      const activatedBody = await activated.json() as { activeSessionRef: string };
      expect(activatedBody.activeSessionRef).toMatch(/^execution-/);

      const headBinding = await pool.query<{ selected_model_provider: string; selected_model_id: string; actual_model_provider: string; actual_model_id: string; account_ref: string }>(
        "SELECT selected_model_provider, selected_model_id, actual_model_provider, actual_model_id, account_ref FROM native_execution_bindings WHERE admission_kind = 'head'",
      );
      expect(headBinding.rows).toEqual([{ selected_model_provider: "test", selected_model_id: "model-a", actual_model_provider: "test", actual_model_id: "model-a", account_ref: PROVIDER_ACCOUNT_REF }]);

      const evidenceId = randomUUID();
      await pool.query(
        "INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type, retention) VALUES ($1, $2, $3, $4, $5, 'acceptance-test', $6, 0, 'test-result', 'text/plain', 'project_lifetime')",
        [evidenceId, randomUUID(), randomUUID(), projectId, goalId, "0".repeat(64)],
      );
      const councilResponse = await send(`/v1/goals/${goalId}/councils`, "POST", { projectId, contractId, briefDeadline: new Date(Date.now() + 60_000).toISOString(), evidence: { references: [evidenceId] } });
      expect(councilResponse.status).toBe(201);
      const council = await councilResponse.json() as { councilId: string };
      const brief = { interpretation: "safe", contribution: "review", nonGoals: [], assumptions: [], evidenceGaps: [], risks: [], dependencies: [], proposedValidation: [], expectedWorkers: [], expectedCost: "1", expectedTime: "1", objectionsToLikelyAlternatives: [] };
      expect((await send(`/v1/councils/${council.councilId}/briefs/product`, "POST", { projectId, brief })).status).toBe(204);
      expect((await send(`/v1/councils/${council.councilId}/reveal`, "POST", { projectId })).status).toBe(204);
      const packet = { outcome: "decided", executionDisposition: "executable", selectedDirection: "prove the real native path", rejectedAlternatives: [], departmentOwnership: [{ departmentId: "product", responsibility: "implement" }], workerPlan: [], completionCriteria: ["binding recorded"], failureCriteria: ["binding missing"], dissent: [], uncertainty: [], criticalActions: [], unresolvedConflicts: [], evidenceReferences: [] };
      expect((await send(`/v1/councils/${council.councilId}/decision`, "POST", { projectId, packet })).status).toBe(200);
      const plan = {
        contribution: "implement the acceptance change", nonGoals: [],
        items: [{ itemId: "exec-1", kind: "execution", objective: "prove native Worker admission", dependsOn: [], scoutQuestion: "", workerAssignment: "return a bounded result", evidenceReferences: [] }],
        requiredHandoffs: [], budgetCeiling: "50 USD", expectedTime: "1 hour", maxRetries: 1, maxWorkers: 1,
        gitRepository: repositoryPath, gitBranch: "goal/product", integrationPath: "src", risks: [], safePausePoints: [],
        escalationTriggers: [], evidenceReferences: [], validationCriteria: ["bound result returned"],
      };
      expect((await send(`/v1/councils/${council.councilId}/departments/product/plan`, "POST", { projectId, substance: plan })).status).toBe(201);
      const environmentId = randomUUID();
      const bundle = {
        role: "execution", profileRef: "profile/acceptance", goalBrief: "return a bounded result",
        taskDemand: { schemaVersion: 1, taskKinds: ["coding"], requirements: { reasoning: { level: 80, rationale: "The Head set this level from the Task Contract." }, coding: { level: 80, rationale: "The Head set this level from the Task Contract." }, verification: { level: 80, rationale: "The Head set this level from the Task Contract." }, "instruction-fidelity": { level: 80, rationale: "The Head set this level from the Task Contract." }, "tool-use": { level: 80, rationale: "The Head set this level from the Task Contract." }, "long-context": { level: 80, rationale: "The Head set this level from the Task Contract." }, knowledge: { level: 80, rationale: "The Head set this level from the Task Contract." }, "refusal-calibration": { level: 80, rationale: "The Head set this level from the Task Contract." } }, provenance: { taskContractRef: "task-contract:fixture", headDecisionRef: "head-decision:fixture" } }, approvedModels: ["test/model-a"],
        allowedSkills: ["testing"], allowedTools: ["ipython"], allowedPaths: ["src"], environment: [environmentId], authorityBoundary: ["local"],
        externalServiceBoundary: ["none"], dataBoundary: ["repository only"], costCeiling: "20 USD", timeCeiling: "30 minutes", retryCeiling: 1,
        workerCeiling: 0, deliverable: "bounded result", evidenceRequirements: ["test result"], validationCriteria: ["bound result returned"], terminationConditions: ["done"],
        repairHold: { approvalId: randomUUID(), window: "1 minute", repetitionScope: { kind: "bounded_count", count: 1 } },
      };
      expect((await send(`/v1/councils/${council.councilId}/departments/product/mission-bundles/exec-1`, "POST", { projectId, substance: bundle })).status).toBe(201);

      // Real native Worker admission: this admits a second root through the
      // same real Model Gateway process, drives a real provider turn, and
      // durably records the resulting binding evidence.
      const workerResponse = await send(`/v1/councils/${council.councilId}/departments/product/workers`, "POST", { projectId, planVersion: 1, itemId: "exec-1" });
      expect(workerResponse.status).toBe(201);
      const worker = await workerResponse.json() as { workerId: string };
      const observed = await send(`/v1/workers/${worker.workerId}/observe`, "POST", { projectId });
      expect(observed.status).toBe(200);
      const observedBody = await observed.json() as { status: string; answerText: string | null; observability: { toolEvents: { state: string; events?: ReadonlyArray<{ toolName?: string }> } } };
      expect(observedBody.status).toBe("awaiting_repair");
      expect(observedBody.observability.toolEvents.state).toBe("available");
      expect(observedBody.observability.toolEvents.events?.some((event) => event.toolName === "ipython")).toBe(true);
      expect(observedBody.answerText).toBe("worker ipython local effect complete");
      expect(seenToolSets.some((tools) => tools.length === 0)).toBe(true);
      expect(seenToolSets.some((tools) => tools.length === 1 && tools[0] === "ipython")).toBe(true);
      expect(seenToolSets.every((tools) => tools.every((tool) => tool === "ipython"))).toBe(true);
      const sessionJournal = await pool.query<{ event: string }>(
        "SELECT event FROM ipython_session_journal WHERE project_id = $1 AND goal_id = $2 ORDER BY occurred_at",
        [projectId, goalId],
      );
      expect(sessionJournal.rows.some((row) => row.event === "started")).toBe(true);
      expect(observedBody).toMatchObject({ observability: { stopState: "open" } });
      const observability = (observedBody as { observability: { capabilityJournal: Array<{ details: Record<string, unknown> }>; ipythonSessionJournal: unknown[] } }).observability;
      expect(observability.capabilityJournal.length).toBeGreaterThan(0);
      const capabilityJournalText = JSON.stringify(observability.capabilityJournal);
      expect(capabilityJournalText).toContain('"stage":"commit"');
      expect(capabilityJournalText).toContain('"appliedCount":1');
      expect(capabilityJournalText).not.toContain("must not write");
      expect(observability.ipythonSessionJournal.length).toBeGreaterThan(0);
      const workerBeforeRepair = await pool.query<{ execution_ref: string; invocation_ref: string }>("SELECT execution_ref, invocation_ref FROM workers WHERE worker_id = $1", [worker.workerId]);
      const repairResponse = await send(`/v1/workers/${worker.workerId}/messages`, "POST", { projectId, message: "tests failed; repair the defect before re-testing" });
      expect(repairResponse.status).toBe(200);
      const resumed = await repairResponse.json() as { status: string; executionRef: string; invocationRef: string };
      expect(resumed.status).toBe("running");
      expect(resumed.executionRef).toBe(workerBeforeRepair.rows[0]!.execution_ref);
      expect(resumed.invocationRef).toBe(workerBeforeRepair.rows[0]!.invocation_ref);
      const repaired = await send(`/v1/workers/${worker.workerId}/observe`, "POST", { projectId });
      expect(repaired.status).toBe(200);
      expect((await repaired.json() as { status: string }).status).toBe("succeeded");
      const workerAfterRepair = await pool.query<{ execution_ref: string; invocation_ref: string }>("SELECT execution_ref, invocation_ref FROM workers WHERE worker_id = $1", [worker.workerId]);
      expect(workerAfterRepair.rows).toEqual(workerBeforeRepair.rows);
      const workerBinding = await pool.query<{ selected_model_provider: string; selected_model_id: string; actual_model_provider: string; actual_model_id: string; account_ref: string }>(
        "SELECT selected_model_provider, selected_model_id, actual_model_provider, actual_model_id, account_ref FROM native_execution_bindings WHERE admission_kind = 'worker'",
      );
      expect(workerBinding.rows).toEqual([{ selected_model_provider: "test", selected_model_id: "model-a", actual_model_provider: "test", actual_model_id: "model-a", account_ref: PROVIDER_ACCOUNT_REF }]);
      const workerWorktree = await pool.query<{ repository_path: string; worktree_path: string; branch_name: string }>("SELECT repository_path, worktree_path, branch_name FROM worker_worktrees WHERE worker_id = $1", [worker.workerId]);
      expect(workerWorktree.rows).toHaveLength(1);
      expect(workerWorktree.rows[0]!.repository_path).toBe(repositoryPath);
      expect(execFileSync("git", ["-C", workerWorktree.rows[0]!.worktree_path, "rev-parse", "--is-inside-work-tree"]).toString().trim()).toBe("true");
      expect(execFileSync("git", ["-C", workerWorktree.rows[0]!.worktree_path, "rev-parse", "HEAD"]).toString().trim()).toBe(immutableBaseRevision);
      expect(existsSync(`${workerWorktree.rows[0]!.worktree_path}/src/approved.txt`)).toBe(true);
      expect(existsSync(`${workerWorktree.rows[0]!.worktree_path}/src/forbidden.txt`)).toBe(false);

      // Two real gateway admissions (Head + Worker); no credential or raw
      // provider secret ever appears in durable evidence or HTTP responses.
      const bindingsAsText = JSON.stringify([...headBinding.rows, ...workerBinding.rows]);
      expect(bindingsAsText).not.toContain("provider-secret-not-real");
      expect(bindingsAsText).not.toContain("gateway-acceptance-token");
    } finally {
      await controlPlane.close();
      const worktreeRows = await pool.query<{ repository_path: string; worktree_path: string }>("SELECT repository_path, worktree_path FROM worker_worktrees");
      for (const row of worktreeRows.rows) execFileSync("git", ["-C", row.repository_path, "worktree", "remove", "--force", "--", row.worktree_path]);
      rmSync(repositoryPath, { recursive: true, force: true });
    }
  });
});
