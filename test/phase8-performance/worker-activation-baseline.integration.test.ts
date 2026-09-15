import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DecisionPacket, ExecutionKernelPort, IndependentBrief, MissionBundleSubstance, TaskContractSubstance } from "../../packages/domain/src/index.js";
import { taskContractContentHash } from "../../packages/domain/src/index.js";
import { acquireGoalLease } from "../../packages/persistence/src/commands.js";
import { createDepartmentPlan } from "../../packages/persistence/src/department-plan.js";
import { createHeadCouncil, recordCouncilDecisionPacket, revealCouncilBriefs, submitIndependentBrief } from "../../packages/persistence/src/council.js";
import { createMissionBundle } from "../../packages/persistence/src/mission-bundle.js";
import { bootstrapPermanentOrganization } from "../../packages/persistence/src/organization.js";
import { runMigrations } from "../../packages/persistence/src/migrate.js";
import { spawnWorker } from "../../packages/persistence/src/worker.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const departments = ["product", "design", "engineering", "security", "infrastructure", "research", "data-analysis", "quality", "safety-compliance", "operations"] as const;

function percentile(samples: readonly number[], quantile: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))]!;
}

const brief: IndependentBrief = { interpretation: "safe outcome", contribution: "review", nonGoals: [], assumptions: [], evidenceGaps: [], risks: [], dependencies: [], proposedValidation: [], expectedWorkers: [], expectedCost: "1", expectedTime: "1", objectionsToLikelyAlternatives: [] };

function contractContent(projectId: string): TaskContractSubstance {
  return {
    desiredOutcome: "deliver safely", userVisibleBehavior: [], successCriteria: [], liveEvidence: [], scope: [], nonGoals: [], priorities: [], acceptableTradeoffs: [], constraints: [], knownEdgeCases: [],
    project: { projectId, repository: "repo", immutableBaseRevision: "base", dataBoundary: "local" },
    evidenceReferences: [], approvedPreviewReferences: [], expectedGroups: [], expectedDepartments: [], criticalActionExpectations: [], forbiddenEffects: [], environmentAssumptions: [], externalServiceAssumptions: [],
    budget: { ceiling: "1", reportingExpectations: [], stoppingConditions: [] },
  };
}

function planSubstance(departmentId: string) {
  return {
    contribution: `own the ${departmentId} slice`, nonGoals: [],
    items: [{ itemId: "scout-1", kind: "scout" as const, objective: "assess risk", dependsOn: [], scoutQuestion: "what changed?", workerAssignment: "return a bounded result", evidenceReferences: [] }],
    requiredHandoffs: [], budgetCeiling: "10 USD", expectedTime: "1 day", maxRetries: 1, maxWorkers: 1,
    gitRepository: "repo", gitBranch: `phase8/${departmentId}`, integrationPath: "packages/product", risks: [], safePausePoints: [], escalationTriggers: [], evidenceReferences: [], validationCriteria: ["tests pass"],
  };
}

function bundleSubstance(departmentId: string): MissionBundleSubstance {
  return {
    role: "scout", profileRef: `profile-${departmentId}`, goalBrief: `assess ${departmentId} risk before implementation`,
    taskDemand: { schemaVersion: 1, taskKinds: ["research"], requirements: { reasoning: { level: 80, rationale: "The Head set this level from the Task Contract." }, coding: { level: 80, rationale: "The Head set this level from the Task Contract." }, verification: { level: 80, rationale: "The Head set this level from the Task Contract." }, "instruction-fidelity": { level: 80, rationale: "The Head set this level from the Task Contract." }, "tool-use": { level: 80, rationale: "The Head set this level from the Task Contract." }, "long-context": { level: 80, rationale: "The Head set this level from the Task Contract." }, knowledge: { level: 80, rationale: "The Head set this level from the Task Contract." }, "refusal-calibration": { level: 80, rationale: "The Head set this level from the Task Contract." } }, provenance: { taskContractRef: "task-contract:fixture", headDecisionRef: "head-decision:fixture" } },
    approvedModels: ["test/model-a"], allowedSkills: ["research"], allowedTools: ["read"], allowedPaths: ["packages/product"], environment: ["node24"], authorityBoundary: ["read-only"], externalServiceBoundary: ["none"], dataBoundary: ["repository files only"],
    costCeiling: "1 USD", timeCeiling: "1 hour", retryCeiling: 1, workerCeiling: 0, deliverable: "a risk report", evidenceRequirements: ["citations"], validationCriteria: ["report reviewed"], terminationConditions: ["deadline passed"],
  };
}

function fakeKernel(): ExecutionKernelPort {
  let counter = 0;
  return {
    spawn: async () => { counter += 1; return { execution: `worker-execution-${counter}` as never, invocation: `worker-invocation-${counter}` as never }; },
    prompt: async () => {}, observe: async () => [], sendMessage: async () => {}, cancel: async () => ({ cancelled: false }),
    getModelIdentity: async () => ({ provider: "test", id: "model-a" }),
    getExecutionBinding: async () => ({ model: { provider: "test", id: "model-a" }, accountRef: "worker-account", gatewayInstanceId: "worker-gateway", gatewayBindingId: "worker-binding", dataPolicyHash: "worker-policy" }),
    getToolEvents: async () => ({ state: "empty", events: [] }), getUsage: async () => ({ state: "unknown" }), getInvocationStatus: async () => "unknown",
    resume: async () => { throw new Error("not supported"); }, reconnect: async () => { throw new Error("not supported"); }, release: async () => {},
  };
}

const headContext = (departmentId: string) => ({ actorId: `head:${departmentId}`, sessionRef: `opaque:${departmentId}`, commandId: randomUUID() });

describeDatabase("Plan 8 §S5 Worker activation latency baseline", () => {
  const schema = `phase8_s5_worker_${randomUUID().replaceAll("-", "")}`;
  const basePool = new Pool({ connectionString: databaseUrl });
  const scopedUrl = databaseUrl === undefined ? "" : (() => { const url = new URL(databaseUrl); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })();
  const pool = new Pool({ connectionString: scopedUrl });

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA "${schema}"`);
    await runMigrations(pool);
    await bootstrapPermanentOrganization(pool);
  });
  afterAll(async () => {
    await pool.end();
    await basePool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await basePool.end();
  });

  it("records real PostgreSQL Worker admission and activation latency", async () => {
    const goalId = randomUUID();
    const projectId = randomUUID();
    const contractId = randomUUID();
    const evidenceReferences = [randomUUID(), randomUUID()];
    const content = contractContent(projectId);
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
    await pool.query("INSERT INTO task_contracts (contract_id, schema_version, version, content, content_hash, launch_state) VALUES ($1, 1, 1, $2::jsonb, $3, 'launched')", [contractId, JSON.stringify(content), taskContractContentHash(content)]);
    for (const evidenceId of evidenceReferences) {
      await pool.query("INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type, retention) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'test-result', 'text/plain', 'project_lifetime')", [evidenceId, randomUUID(), randomUUID(), projectId, goalId, "test", "0".repeat(64)]);
    }
    for (const departmentId of departments) {
      await pool.query("INSERT INTO goal_head_participations (goal_id, department_id, head_role_id, contract_id, status, active_session_ref) VALUES ($1, $2, $3, $4, 'active', $5)", [goalId, departmentId, `head:${departmentId}`, contractId, `opaque:${departmentId}`]);
    }
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "phase8-s5-worker-benchmark", leaseDurationMs: 120_000 });
    const council = await createHeadCouncil(pool, { goalId, contractId, briefDeadline: new Date(Date.now() + 60_000), evidence: { references: evidenceReferences } }, proof, { actorId: "secretary", sessionRef: "secretary-session", commandId: randomUUID() });
    for (const departmentId of departments) await submitIndependentBrief(pool, council.councilId, departmentId, brief, proof, headContext(departmentId));
    await revealCouncilBriefs(pool, council.councilId, proof, { actorId: "reveal", sessionRef: "reveal-session", commandId: randomUUID() });
    const packet: DecisionPacket = { outcome: "decided", executionDisposition: "executable", selectedDirection: "proceed", rejectedAlternatives: [], departmentOwnership: departments.map((departmentId) => ({ departmentId, responsibility: "own it" })), workerPlan: [], completionCriteria: ["done"], failureCriteria: ["fail"], dissent: [], uncertainty: [], criticalActions: [], unresolvedConflicts: [], evidenceReferences: evidenceReferences };
    const resolved = await recordCouncilDecisionPacket(pool, council.councilId, packet, proof, { actorId: "decision", sessionRef: "decision-session", commandId: randomUUID() });
    const plans = new Map<string, number>();
    for (const departmentId of departments) {
      const plan = await createDepartmentPlan(pool, { councilId: resolved.councilId, departmentId, substance: planSubstance(departmentId) }, proof, headContext(departmentId));
      await createMissionBundle(pool, { councilId: resolved.councilId, departmentId, itemId: "scout-1", substance: bundleSubstance(departmentId) }, proof, headContext(departmentId));
      plans.set(departmentId, plan.version);
    }

    const kernel = fakeKernel();
    const samples: number[] = [];
    for (const departmentId of departments) {
      const started = performance.now();
      const worker = await spawnWorker(pool, kernel, { councilId: resolved.councilId, departmentId, planVersion: plans.get(departmentId)!, itemId: "scout-1", commandId: randomUUID() }, proof, headContext(departmentId));
      samples.push(performance.now() - started);
      expect(worker.status).toBe("spawned");
    }

    const baseline = { metric: "worker-activation-latency", database: "postgresql", sampleCount: samples.length, activationMs: { p50: percentile(samples, 0.5), p95: percentile(samples, 0.95), max: Math.max(...samples) } };
    console.log(`PHASE8_PERFORMANCE_BASELINE ${JSON.stringify(baseline)}`);
    expect(samples).toHaveLength(10);
  });
});
