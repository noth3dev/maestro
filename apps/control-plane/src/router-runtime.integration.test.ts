import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ProviderRegistry, type ModelProviderPort, type ProviderPlugin } from "@maestro/agent-runtime";
import { MODEL_CAPABILITY_AXES, type ModelMap } from "@maestro/domain";
import {
  acquireGoalLease,
  applyAllMigrations,
  bootstrapLocalOperator,
  createDepartmentPlan,
  createHeadCouncil,
  createMissionBundle,
  recordCouncilDecisionPacket,
  recordOperationalOverlay,
  revealCouncilBriefs,
  snapshotOperationalOverlayForGoalDurably,
  submitIndependentBrief,
  taskContractContentHash,
} from "@maestro/persistence";
import { grantProjectMembership, grantProjectRole } from "@maestro/persistence/testing";
import type {
  DecisionPacket,
  DepartmentPlanSubstance,
  IndependentBrief,
  MissionBundleSubstance,
  TaskContractSubstance,
} from "@maestro/domain";
import { InMemoryCredentialStore } from "../../model-gateway/src/index.js";
import { createModelGateway } from "../../model-gateway/src/index.js";
import { buildModelGatewayServer } from "../../model-gateway/src/index.js";
import { createControlPlane } from "./main.js";
import type { MaestroConfig } from "./config.js";
import { GATEWAY_OPERATOR_ID, PROVIDER_ACCOUNT_REF } from "./native-worker-acceptance.integration.test.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const MODEL_A = "test/model-a";
const MODEL_B = "test/model-b";

interface AdmittedRecord {
  readonly modelRef: string;
  readonly accountRef: string;
}

/** A real, two-model provider plugin (not an `ExecutionKernelPort` mock): the
 * Control Plane, native runtime, and Model Gateway HTTP boundary between it
 * and the caller are all real processes. `create()` binds to whichever exact
 * identity the routed admission selected, and the resulting `turn()` records
 * that identity so the test can assert what the Gateway actually admitted. */
function twoModelProviderPlugin(admitted: AdmittedRecord[]): ProviderPlugin {
  const identities = [
    { provider: "test", id: "model-a" },
    { provider: "test", id: "model-b" },
  ];
  const dataPolicy = { allowedDataClasses: ["public"] as const, retention: "none" as const, trainsOnCustomerData: false, regions: ["us"] };
  function portFor(identity: { provider: string; id: string }, accountRef: string): ModelProviderPort {
    return {
      identity,
      accountRef,
      capabilities: new Set(["text"]),
      async turn(request) {
        admitted.push({ modelRef: `${identity.provider}/${identity.id}`, accountRef });
        return {
          requestId: request.requestId,
          model: identity,
          text: "router runtime wiring turn complete",
          toolCalls: [],
          stopReason: "end_turn",
          usage: { state: "unknown" },
        };
      },
      async cancel() {
        return { state: "confirmed" as const };
      },
      async close() {},
    };
  }
  return {
    id: "test",
    authModes: ["api-key"],
    capabilities: new Set(["text"]),
    dataPolicy,
    listModels: () => identities.map((identity) => ({ identity, capabilities: new Set(["text"]), authModes: ["api-key"], dataPolicy })),
    async create(request) {
      const identity = identities.find((candidate) => candidate.provider === request.model.provider && candidate.id === request.model.id);
      if (identity === undefined) throw new Error("unexpected model identity requested from the test provider");
      return portFor(identity, request.account.accountRef);
    },
  };
}

function scoredCapability(score: number) {
  return {
    schemaVersion: 2 as const,
    axes: Object.fromEntries(
      MODEL_CAPABILITY_AXES.map((axis) => [
        axis,
        { status: "scored" as const, score, rationale: "router runtime wiring fixture", evidence: ["router-runtime-wiring-test"] },
      ]),
    ),
  };
}

function fixtureProviderFacts() {
  return {
    schemaVersion: 1 as const,
    contextCapacity: 128_000,
    pricing: { inputPerMillionTokens: 1, outputPerMillionTokens: 1 },
    authentication: { modes: ["api-key" as const] },
    dataPolicy: {
      allowedDataClasses: ["public" as const],
      retention: "transient" as const,
      trainingUse: "never" as const,
      regions: ["local"],
    },
    modalities: ["text" as const],
    toolCalls: { supported: true },
    provenance: { source: "router-runtime-wiring-test", observedAt: "2026-09-22" },
  };
}

function buildTestModelMap(): ModelMap {
  return {
    schemaVersion: 1,
    entries: [
      {
        modelRef: MODEL_A,
        capability: scoredCapability(150),
        providerFacts: fixtureProviderFacts(),
        provenance: { owner: "human", sourceRefs: ["router-runtime-wiring-test"], reviewedAt: "2026-09-22" },
      },
      {
        modelRef: MODEL_B,
        capability: scoredCapability(140),
        providerFacts: fixtureProviderFacts(),
        provenance: { owner: "human", sourceRefs: ["router-runtime-wiring-test"], reviewedAt: "2026-09-22" },
      },
    ],
  };
}

function buildContractContent(projectId: string): TaskContractSubstance {
  return {
    desiredOutcome: "prove the router pool reaches admission",
    userVisibleBehavior: [],
    successCriteria: [],
    liveEvidence: [],
    scope: [],
    nonGoals: [],
    priorities: [],
    acceptableTradeoffs: [],
    constraints: [],
    knownEdgeCases: [],
    project: { projectId, repository: "repo", immutableBaseRevision: "base", dataBoundary: "local" },
    evidenceReferences: [],
    approvedPreviewReferences: [],
    expectedGroups: [],
    expectedDepartments: [],
    criticalActionExpectations: [],
    forbiddenEffects: [],
    environmentAssumptions: [],
    externalServiceAssumptions: [],
    budget: { ceiling: "1", reportingExpectations: [], stoppingConditions: [] },
  };
}

const brief: IndependentBrief = {
  interpretation: "safe outcome",
  contribution: "review",
  nonGoals: [],
  assumptions: [],
  evidenceGaps: [],
  risks: [],
  dependencies: [],
  proposedValidation: [],
  expectedWorkers: [],
  expectedCost: "1",
  expectedTime: "1",
  objectionsToLikelyAlternatives: [],
};
const context = (label: string) => ({ actorId: `actor:${label}`, sessionRef: `session:${label}`, commandId: randomUUID() });
const headContext = () => ({ actorId: "head:product", sessionRef: "opaque:product", commandId: randomUUID() });

const planSubstance = (): DepartmentPlanSubstance => ({
  contribution: "prove the routed pool reaches admission",
  nonGoals: [],
  items: [
    {
      itemId: "exec-1",
      kind: "execution",
      objective: "prove the first routed admission",
      dependsOn: [],
      scoutQuestion: "",
      workerAssignment: "return a bounded result",
      evidenceReferences: [],
    },
    {
      itemId: "exec-2",
      kind: "execution",
      objective: "prove the second routed admission",
      dependsOn: [],
      scoutQuestion: "",
      workerAssignment: "return a bounded result",
      evidenceReferences: [],
    },
  ],
  requiredHandoffs: [],
  budgetCeiling: "10 USD",
  expectedTime: "1 day",
  maxRetries: 1,
  maxWorkers: 2,
  gitRepository: "repo",
  gitBranch: "goal/product",
  integrationPath: "src",
  risks: [],
  safePausePoints: [],
  escalationTriggers: [],
  evidenceReferences: [],
  validationCriteria: ["bound result returned"],
});

function bundleSubstance(): MissionBundleSubstance {
  return {
    role: "execution",
    profileRef: "profile/router-runtime-wiring",
    goalBrief: "return a bounded result",
    taskDemand: {
      schemaVersion: 1,
      taskKinds: ["coding"],
      requirements: Object.fromEntries(
        MODEL_CAPABILITY_AXES.map((axis) => [axis, { level: 0, rationale: "router runtime wiring acceptance" }]),
      ) as never,
      provenance: { taskContractRef: "task-contract:router-runtime-wiring", headDecisionRef: "head-decision:router-runtime-wiring" },
    },
    approvedModels: [MODEL_A, MODEL_B],
    allowedSkills: ["testing"],
    allowedTools: [],
    allowedPaths: ["."],
    environment: [],
    authorityBoundary: ["local"],
    externalServiceBoundary: ["none"],
    dataBoundary: ["repository only"],
    costCeiling: "5 USD",
    timeCeiling: "10 minutes",
    retryCeiling: 0,
    workerCeiling: 0,
    deliverable: "bounded result",
    evidenceRequirements: ["provider response"],
    validationCriteria: ["bound result returned"],
    terminationConditions: ["done"],
    repairHold: { approvalId: randomUUID(), window: "1 minute", repetitionScope: { kind: "bounded_count", count: 1 } },
  } satisfies MissionBundleSubstance;
}

describeDatabase("real Control Plane + PostgreSQL + Model Gateway router pool acceptance", () => {
  const basePool = new Pool({ connectionString: databaseUrl });
  const schema = `router_runtime_wiring_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl =
    databaseUrl === undefined
      ? ""
      : (() => {
          const url = new URL(databaseUrl);
          url.searchParams.set("options", `-c search_path=${schema}`);
          return url.toString();
        })();
  let pool: Pool;
  let gatewayApp: Awaited<ReturnType<typeof buildModelGatewayServer>>;
  let gatewayUrl: string;
  const admitted: AdmittedRecord[] = [];
  let tempDir: string;
  let modelMapPath: string;
  let previousModelMapEnv: string | undefined;

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: scopedUrl });
    await applyAllMigrations(pool);
    const credentials = new InMemoryCredentialStore();
    await credentials.bind(
      { operatorId: GATEWAY_OPERATOR_ID, providerId: "test", authMode: "api-key", accountRef: PROVIDER_ACCOUNT_REF },
      "provider-secret-not-real",
    );
    const registry = new ProviderRegistry();
    registry.register(twoModelProviderPlugin(admitted));
    const gateway = createModelGateway({
      registry,
      credentials,
      operatorId: GATEWAY_OPERATOR_ID,
      instanceId: "router-runtime-wiring-gateway",
    });
    gatewayApp = buildModelGatewayServer({ gateway, token: "gateway-router-runtime-token", operatorId: GATEWAY_OPERATOR_ID });
    await gatewayApp.listen({ host: "127.0.0.1", port: 0 });
    const address = gatewayApp.server.address();
    if (address === null || typeof address === "string") throw new Error("Model Gateway did not bind TCP");
    gatewayUrl = `http://127.0.0.1:${address.port}`;
  });
  beforeEach(async () => {
    admitted.length = 0;
    await pool.query(
      "TRUNCATE goals, native_execution_bindings, ensemble_router_routing_evidence, ensemble_router_goal_overlay_snapshots, ensemble_router_operational_overlays, workers, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, council_round_contributions, council_rounds, independent_briefs, council_participants, head_councils, goal_head_participations, task_contract_confirmations, task_contract_decisions, task_contracts, evidence_records, goal_leases, outbox, goal_events, command_receipts, goal_controls, operator_settings, local_operator_credentials, local_operators, operator_project_memberships CASCADE",
    );
    tempDir = mkdtempSync(join(tmpdir(), "maestro-router-runtime-wiring-"));
    modelMapPath = join(tempDir, "model_map.json");
    writeFileSync(modelMapPath, JSON.stringify(buildTestModelMap()));
    previousModelMapEnv = process.env.MAESTRO_MODEL_MAP;
    process.env.MAESTRO_MODEL_MAP = modelMapPath;
  });
  afterEach(() => {
    if (previousModelMapEnv === undefined) delete process.env.MAESTRO_MODEL_MAP;
    else process.env.MAESTRO_MODEL_MAP = previousModelMapEnv;
    rmSync(tempDir, { recursive: true, force: true });
  });
  afterAll(async () => {
    await gatewayApp.close();
    await pool.end();
    await basePool.query(`DROP SCHEMA ${schema} CASCADE`);
    await basePool.end();
  });

  it("proves an authenticated router pool change reaches the real Ensemble Worker admission and evidence", async () => {
    const catalogPath = join(tempDir, "ensemble-candidates.json");
    writeFileSync(
      catalogPath,
      JSON.stringify({
        schemaVersion: 1,
        entries: [
          { candidateRef: "test-model-a", modelRef: MODEL_A, accountBinding: PROVIDER_ACCOUNT_REF },
          { candidateRef: "test-model-b", modelRef: MODEL_B, accountBinding: PROVIDER_ACCOUNT_REF },
        ],
      }),
    );

    const secret = `router-runtime-wiring-${randomUUID()}`;
    const { credentialId, operatorId } = await bootstrapLocalOperator(pool, { secret });
    const projectId = randomUUID();
    const goalId = randomUUID();
    const contractId = randomUUID();
    await grantProjectMembership(pool, operatorId, projectId);
    await grantProjectRole(pool, operatorId, projectId, "head-product");

    const contractContent = buildContractContent(projectId);
    await pool.query(
      "INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())",
      [goalId, projectId],
    );
    await pool.query(
      "INSERT INTO task_contracts (contract_id, schema_version, version, content, content_hash, launch_state) VALUES ($1, 1, 1, $2::jsonb, $3, 'launched')",
      [contractId, JSON.stringify(contractContent), taskContractContentHash(contractContent)],
    );
    const evidenceIds = [randomUUID(), randomUUID()];
    for (const evidenceId of evidenceIds) {
      await pool.query(
        "INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type, retention) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'test-result', 'text/plain', 'project_lifetime')",
        [evidenceId, randomUUID(), randomUUID(), projectId, goalId, "test", "0".repeat(64)],
      );
    }
    await pool.query(
      "INSERT INTO goal_head_participations (goal_id, department_id, head_role_id, contract_id, status, active_session_ref) VALUES ($1, 'product', 'head:product', $2, 'active', 'opaque:product')",
      [goalId, contractId],
    );
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "test", leaseDurationMs: 60_000 });
    const council = await createHeadCouncil(
      pool,
      { goalId, contractId, briefDeadline: new Date(Date.now() + 60_000), evidence: { references: evidenceIds } },
      proof,
      context("secretary"),
    );
    await submitIndependentBrief(pool, council.councilId, "product", brief, proof, headContext());
    await revealCouncilBriefs(pool, council.councilId, proof, context("reveal"));
    const packet: DecisionPacket = {
      outcome: "decided",
      executionDisposition: "executable",
      selectedDirection: "prove the router pool reaches admission",
      rejectedAlternatives: [],
      departmentOwnership: [{ departmentId: "product", responsibility: "implement" }],
      workerPlan: [],
      completionCriteria: ["bound result returned"],
      failureCriteria: ["bound result missing"],
      dissent: [],
      uncertainty: [],
      criticalActions: [],
      unresolvedConflicts: [],
      evidenceReferences: [],
    };
    const resolved = await recordCouncilDecisionPacket(pool, council.councilId, packet, proof, context("decision"));
    const plan = await createDepartmentPlan(
      pool,
      { councilId: resolved.councilId, departmentId: "product", substance: planSubstance() },
      proof,
      headContext(),
    );
    await createMissionBundle(
      pool,
      { councilId: resolved.councilId, departmentId: "product", itemId: "exec-1", substance: bundleSubstance() },
      proof,
      headContext(),
    );
    await createMissionBundle(
      pool,
      { councilId: resolved.councilId, departmentId: "product", itemId: "exec-2", substance: bundleSubstance() },
      proof,
      headContext(),
    );

    const overlay = {
      schemaVersion: 1 as const,
      installationRef: "router-runtime-wiring",
      projectRef: projectId,
      version: 1,
      observations: [
        {
          candidateRef: "test-model-a",
          measuredLatencyMs: 10,
          measuredCost: 1,
          failureRate: 0,
          timeoutRate: 0,
          providerErrorRate: 0,
          currentAvailability: true,
          accountBinding: PROVIDER_ACCOUNT_REF,
          observedAt: "2026-09-22T00:00:00.000Z",
        },
        {
          candidateRef: "test-model-b",
          measuredLatencyMs: 10,
          measuredCost: 1,
          failureRate: 0,
          timeoutRate: 0,
          providerErrorRate: 0,
          currentAvailability: true,
          accountBinding: PROVIDER_ACCOUNT_REF,
          observedAt: "2026-09-22T00:00:00.000Z",
        },
      ],
    };
    await recordOperationalOverlay(pool, overlay);
    await snapshotOperationalOverlayForGoalDurably(pool, overlay, goalId);

    const config: MaestroConfig = {
      databaseUrl: scopedUrl,
      evidenceDir: "/tmp/maestro-evidence",
      worktreeRoot: "/tmp",
      host: "127.0.0.1",
      port: 0,
      actorId: "maestro-control-plane",
      leaseOwnerId: `router-runtime-wiring-${randomUUID()}`,
      reconcilerLeaseDurationMs: 30_000,
      modelRoutingMode: "ensemble",
      ensembleCandidateCatalogPath: catalogPath,
      modelGatewayUrl: gatewayUrl,
      modelGatewayToken: "gateway-router-runtime-token",
      modelGatewayOperatorId: GATEWAY_OPERATOR_ID,
      modelAccountRefs: { test: PROVIDER_ACCOUNT_REF },
    };
    const controlPlane = createControlPlane(config);
    await controlPlane.listen();
    const address = controlPlane.app.server.address();
    if (address === null || typeof address === "string") throw new Error("Expected TCP listener");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const auth = { authorization: `Bearer ${credentialId}.${secret}`, "content-type": "application/json" };
    const send = (path: string, method: string, body: unknown, command = randomUUID()) =>
      fetch(`${baseUrl}${path}`, { method, headers: { ...auth, "idempotency-key": command }, body: JSON.stringify(body) });

    try {
      // 1) Restrict the operator pool to `test/model-a` and spawn the first
      // Worker attempt; the real Ensemble Router selection and real Model
      // Gateway admission must both resolve to exactly `test/model-a`.
      const poolA = await send("/v1/router/config", "PUT", { schemaVersion: 1, enabledModelRefs: [MODEL_A] });
      expect(poolA.status).toBe(200);
      expect(((await poolA.json()) as { poolModelRefs: string[] }).poolModelRefs).toEqual([MODEL_A]);

      const workerAResponse = await send(`/v1/councils/${council.councilId}/departments/product/workers`, "POST", {
        projectId,
        planVersion: plan.version,
        itemId: "exec-1",
      });
      expect(workerAResponse.status).toBe(201);
      const workerA = (await workerAResponse.json()) as { workerId: string };
      const observedA = await send(`/v1/workers/${workerA.workerId}/observe`, "POST", { projectId });
      expect(observedA.status).toBe(200);
      expect(((await observedA.json()) as { status: string }).status).toBe("succeeded");
      expect(admitted).toEqual([{ modelRef: MODEL_A, accountRef: PROVIDER_ACCOUNT_REF }]);

      const bindingA = await pool.query<{ selected_model_provider: string; selected_model_id: string; account_ref: string }>(
        "SELECT selected_model_provider, selected_model_id, account_ref FROM native_execution_bindings WHERE worker_id = $1",
        [workerA.workerId],
      );
      expect(bindingA.rows).toEqual([{ selected_model_provider: "test", selected_model_id: "model-a", account_ref: PROVIDER_ACCOUNT_REF }]);

      const evidenceA = await pool.query<{ selected_model_ref: string; rejections: unknown[] }>(
        "SELECT selected_model_ref, rejections FROM ensemble_router_routing_evidence WHERE goal_ref = $1 ORDER BY created_at DESC LIMIT 1",
        [goalId],
      );
      expect(evidenceA.rows).toHaveLength(1);
      expect(evidenceA.rows[0]!.selected_model_ref).toBe(MODEL_A);
      expect(evidenceA.rows[0]!.rejections).toContainEqual({
        candidateRef: "test-model-b",
        reason: "operator model pool excludes candidate",
      });

      // 2) Replace the pool with only `test/model-b` and spawn a second,
      // independent Worker attempt; the routed identity must flip exactly.
      const poolB = await send("/v1/router/config", "PUT", { schemaVersion: 1, enabledModelRefs: [MODEL_B] });
      expect(poolB.status).toBe(200);
      expect(((await poolB.json()) as { poolModelRefs: string[] }).poolModelRefs).toEqual([MODEL_B]);

      const workerBResponse = await send(`/v1/councils/${council.councilId}/departments/product/workers`, "POST", {
        projectId,
        planVersion: plan.version,
        itemId: "exec-2",
      });
      expect(workerBResponse.status).toBe(201);
      const workerB = (await workerBResponse.json()) as { workerId: string };
      const observedB = await send(`/v1/workers/${workerB.workerId}/observe`, "POST", { projectId });
      expect(observedB.status).toBe(200);
      expect(((await observedB.json()) as { status: string }).status).toBe("succeeded");
      expect(admitted).toEqual([
        { modelRef: MODEL_A, accountRef: PROVIDER_ACCOUNT_REF },
        { modelRef: MODEL_B, accountRef: PROVIDER_ACCOUNT_REF },
      ]);

      const bindingB = await pool.query<{ selected_model_provider: string; selected_model_id: string; account_ref: string }>(
        "SELECT selected_model_provider, selected_model_id, account_ref FROM native_execution_bindings WHERE worker_id = $1",
        [workerB.workerId],
      );
      expect(bindingB.rows).toEqual([{ selected_model_provider: "test", selected_model_id: "model-b", account_ref: PROVIDER_ACCOUNT_REF }]);

      // 3) An unknown human-map ref must be rejected before any state
      // mutation or worker/provider admission, with no fallback pool change.
      const bindingCountBefore = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM native_execution_bindings");
      const badPool = await send("/v1/router/config", "PUT", { schemaVersion: 1, enabledModelRefs: ["test/model-unknown"] });
      expect(badPool.status).toBe(400);
      const catalogAfterBadPool = await send("/v1/router/catalog?projectId=" + projectId, "GET", undefined);
      expect(catalogAfterBadPool.status).toBe(200);
      expect(((await catalogAfterBadPool.json()) as { poolModelRefs: string[] }).poolModelRefs).toEqual([MODEL_B]);
      const bindingCountAfter = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM native_execution_bindings");
      expect(bindingCountAfter.rows[0]!.count).toBe(bindingCountBefore.rows[0]!.count);
      expect(admitted).toHaveLength(2);
    } finally {
      await controlPlane.close().catch(() => {});
    }
  });
});
