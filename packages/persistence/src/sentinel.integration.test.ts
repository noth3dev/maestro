import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { applyAllMigrations } from "./test-migrations.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { taskContractContentHash, type DecisionPacket, type DepartmentPlanSubstance, type ExecutionKernelPort, type IndependentBrief, type MissionBundleSubstance, type TaskContractSubstance } from "@maestro/domain";
import { bootstrapPermanentOrganization } from "./organization.js";
import { acquireGoalLease } from "./commands.js";
import { createHeadCouncil, recordCouncilDecisionPacket, revealCouncilBriefs, submitIndependentBrief } from "./council.js";
import { createDepartmentPlan, reviseDepartmentPlan } from "./department-plan.js";
import { createMissionBundle } from "./mission-bundle.js";
import { spawnWorker } from "./worker.js";
import { listSentinelFindings, resolveSentinelFinding, scanGoalForSentinelFindings, SentinelFindingNotFoundError } from "./sentinel.js";
import { SentinelAuthorizationError } from "./sentinel-challenge.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

function buildContractContent(projectId: string): TaskContractSubstance {
  return {
    desiredOutcome: "deliver safely",
    userVisibleBehavior: [], successCriteria: [], liveEvidence: [], scope: [], nonGoals: [], priorities: [], acceptableTradeoffs: [], constraints: [], knownEdgeCases: [],
    project: { projectId, repository: "repo", immutableBaseRevision: "base", dataBoundary: "local" },
    evidenceReferences: [], approvedPreviewReferences: [], expectedGroups: [], expectedDepartments: [], criticalActionExpectations: [], forbiddenEffects: [], environmentAssumptions: [], externalServiceAssumptions: [],
    budget: { ceiling: "1", reportingExpectations: [], stoppingConditions: [] },
  };
}
const brief: IndependentBrief = { interpretation: "safe outcome", contribution: "review", nonGoals: [], assumptions: [], evidenceGaps: [], risks: [], dependencies: [], proposedValidation: [], expectedWorkers: [], expectedCost: "1", expectedTime: "1", objectionsToLikelyAlternatives: [] };
const evidence = { references: [randomUUID(), randomUUID()] };
const context = (label: string) => ({ actorId: `actor:${label}`, sessionRef: `session:${label}`, commandId: randomUUID() });
const headContext = (departmentId: string) => ({ actorId: `head:${departmentId}`, sessionRef: `opaque:${departmentId}`, commandId: randomUUID() });
const sentinelContext = (label: string) => ({ actorId: "encore-sentinel", sessionRef: `sentinel-session:${label}`, commandId: randomUUID() });
const intruderContext = (label: string) => ({ actorId: `intruder:${label}`, sessionRef: `intruder-session:${label}`, commandId: randomUUID() });

const planSubstance = (itemId = "exec-1", contribution = "own the product slice"): DepartmentPlanSubstance => ({
  contribution, nonGoals: [],
  items: [{ itemId, kind: "execution", objective: "implement", dependsOn: [], scoutQuestion: "", workerAssignment: "implement", evidenceReferences: [] }],
  requiredHandoffs: [], budgetCeiling: "10 USD", expectedTime: "1 day", maxRetries: 1, maxWorkers: 1,
  gitRepository: "repo", gitBranch: "phase2/product", integrationPath: "packages/product",
  risks: [], safePausePoints: [], escalationTriggers: [], evidenceReferences: [], validationCriteria: ["tests pass"],
});
const bundleSubstance = (): MissionBundleSubstance => ({
  role: "execution", profileRef: "profile-1", goalBrief: "implement",
  approvedModels: ["model-a"], allowedSkills: ["implementation"], allowedTools: ["write"], allowedPaths: ["packages/product"],
  environment: ["node24"], authorityBoundary: ["write-scoped"], externalServiceBoundary: ["none"], dataBoundary: ["repository files only"],
  costCeiling: "5 USD", timeCeiling: "1 hour", retryCeiling: 1, workerCeiling: 0,
  deliverable: "a change", evidenceRequirements: ["diff"], validationCriteria: ["tests pass"],
  terminationConditions: ["deadline passed"],
});
function fakeKernel(): ExecutionKernelPort {
  let counter = 0;
  return {
    async spawn() { counter += 1; return { execution: `exec-${counter}` as never, invocation: `inv-${counter}` as never }; },
    async prompt() {}, async sendMessage() {}, async observe() { return []; },
    async cancel() { return { cancelled: true }; },
    async getModelIdentity() { return { provider: "fake", id: "fake" }; },
    async getToolEvents() { return { state: "empty", events: [] }; },
    async getUsage() { return { state: "available", totalTokens: 1 }; },
    async getInvocationStatus() { return "running"; },
    async resume() { throw new Error("not supported"); },
    async reconnect() { throw new Error("not supported"); },
  };
}

describeDatabase("Sentinel deterministic findings with PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  async function setupPlan(itemId = "exec-1") {
    const goalId = randomUUID(), contractId = randomUUID(), projectId = randomUUID();
    const contractContent = buildContractContent(projectId);
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
    await pool.query("INSERT INTO task_contracts (contract_id, schema_version, version, content, content_hash, launch_state) VALUES ($1, 1, 1, $2::jsonb, $3, 'launched')", [contractId, JSON.stringify(contractContent), taskContractContentHash(contractContent)]);
    for (const evidenceId of evidence.references) {
      await pool.query(
        "INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type, retention) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'test-result', 'text/plain', 'project_lifetime')",
        [evidenceId, randomUUID(), randomUUID(), projectId, goalId, "test", "0".repeat(64)],
      );
    }
    await pool.query("INSERT INTO goal_head_participations (goal_id, department_id, head_role_id, contract_id, status, active_session_ref) VALUES ($1, 'product', 'head:product', $2, 'active', 'opaque:product')", [goalId, contractId]);
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "test", leaseDurationMs: 60_000 });
    const council = await createHeadCouncil(pool, { goalId, contractId, briefDeadline: new Date(Date.now() + 60_000), evidence }, proof, context("secretary"));
    await submitIndependentBrief(pool, council.councilId, "product", brief, proof, headContext("product"));
    await revealCouncilBriefs(pool, council.councilId, proof, context("reveal"));
    const packet: DecisionPacket = {
      outcome: "decided", executionDisposition: "executable", selectedDirection: "proceed",
      rejectedAlternatives: [], departmentOwnership: [{ departmentId: "product", responsibility: "own it" }],
      workerPlan: [], completionCriteria: ["done"], failureCriteria: ["fail"], dissent: [], uncertainty: [],
      criticalActions: [], unresolvedConflicts: [], evidenceReferences: [],
    };
    const resolved = await recordCouncilDecisionPacket(pool, council.councilId, packet, proof, context("decision"));
    const plan = await createDepartmentPlan(pool, { councilId: resolved.councilId, departmentId: "product", substance: planSubstance(itemId) }, proof, headContext("product"));
    await createMissionBundle(pool, { councilId: resolved.councilId, departmentId: "product", itemId, substance: bundleSubstance() }, proof, headContext("product"));
    const kernel = fakeKernel();
    const worker = await spawnWorker(pool, kernel, { councilId: resolved.councilId, departmentId: "product", planVersion: plan.version, itemId }, proof, headContext("product"));
    return { goalId, proof, council: resolved, plan, worker };
  }

  beforeAll(async () => {
    await pool.query("DROP TABLE IF EXISTS sentinel_findings, workers, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, council_round_contributions, council_rounds, independent_briefs, council_participants, head_councils, head_activation_edges, head_activation_attempts, goal_head_participations, task_contract_confirmations, task_contract_decisions, task_contracts, role_persona_axes, permanent_roles, permanent_head_roles, departments, organization_groups, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls CASCADE");
    await applyAllMigrations(pool);
  });
  beforeEach(async () => { await pool.query("TRUNCATE sentinel_findings, workers, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, head_councils, goal_head_participations, task_contracts, evidence_records, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls RESTART IDENTITY CASCADE"); await bootstrapPermanentOrganization(pool); });
  afterAll(async () => { await pool.end(); });

  it("rejects a finding scan without durable Sentinel authorization", async () => {
    const { goalId } = await setupPlan();
    await expect(scanGoalForSentinelFindings(pool, goalId)).rejects.toBeInstanceOf(SentinelAuthorizationError);
  });

  it("stays silent on a valid Goal with no violations", async () => {
    const { goalId, proof } = await setupPlan();
    const findings = await scanGoalForSentinelFindings(pool, goalId, proof, { actorId: "encore-sentinel", sessionRef: "sentinel-session:valid", commandId: randomUUID() });
    expect(findings).toHaveLength(0);
  });

  it("flags a worker as stale once its Department Plan is revised to a new version", async () => {
    const { goalId, plan, proof, council } = await setupPlan();
    await reviseDepartmentPlan(pool, council.councilId, "product", plan.version, planSubstance("exec-1", "own the product slice, revised"), "evidence changed", proof, headContext("product"));
    const findings = await scanGoalForSentinelFindings(pool, goalId, proof, sentinelContext("stale-worker"));
    expect(findings.some((finding) => finding.ruleId === "stale_worker_superseded_plan")).toBe(true);
    const rescan = await scanGoalForSentinelFindings(pool, goalId, proof, sentinelContext("stale-worker-rescan"));
    expect(rescan).toHaveLength(0);
    const listed = await listSentinelFindings(pool, goalId);
    expect(listed.length).toBeGreaterThan(0);
  });

  it("flags a worker as stale once its item is superseded by a plan revision that changes the item set", async () => {
    const { goalId, plan, proof, council, worker } = await setupPlan("exec-1");
    await reviseDepartmentPlan(pool, council.councilId, "product", plan.version, planSubstance("exec-2"), "scope changed", proof, headContext("product"));
    const findings = await scanGoalForSentinelFindings(pool, goalId, proof, sentinelContext("superseded-item"));
    const staleFindings = findings.filter((finding) => finding.ruleId === "stale_worker_superseded_plan");
    expect(staleFindings.some((finding) => finding.evidenceIdentity === worker.workerId)).toBe(true);
  });

  it("resolves a finding exactly once and rejects re-flagging it as new after resolution reappears identically", async () => {
    const { goalId, plan, proof, council } = await setupPlan();
    await reviseDepartmentPlan(pool, council.councilId, "product", plan.version, planSubstance("exec-1", "own the product slice, revised again"), "evidence changed", proof, headContext("product"));
    const [finding] = await scanGoalForSentinelFindings(pool, goalId, proof, sentinelContext("resolve"));
    expect(finding).toBeDefined();
    const resolved = await resolveSentinelFinding(pool, finding!.findingId, "worker will be replaced next cycle", proof, headContext("product"));
    expect(resolved.resolved).toBe(true);
    const resolvedAgain = await resolveSentinelFinding(pool, finding!.findingId, "duplicate call", proof, headContext("product"));
    expect(resolvedAgain).toEqual(resolved);
    const unresolvedOnly = await listSentinelFindings(pool, goalId);
    expect(unresolvedOnly.find((item) => item.findingId === finding!.findingId)).toBeUndefined();
    const withResolved = await listSentinelFindings(pool, goalId, true);
    expect(withResolved.find((item) => item.findingId === finding!.findingId)).toBeDefined();
    await expect(pool.query("UPDATE sentinel_findings SET details = '{}'::jsonb WHERE finding_id = $1", [finding!.findingId])).rejects.toThrow();
  });

  it("rejects an arbitrary actor from resolving a finding", async () => {
    const { goalId, plan, proof, council } = await setupPlan();
    await reviseDepartmentPlan(pool, council.councilId, "product", plan.version, planSubstance("exec-1", "revised for authorization"), "evidence changed", proof, headContext("product"));
    const [finding] = await scanGoalForSentinelFindings(pool, goalId, proof, sentinelContext("authorization"));
    expect(finding).toBeDefined();
    await expect(resolveSentinelFinding(pool, finding!.findingId, "intruder resolution", proof, intruderContext("finding"))).rejects.toThrow();
    const stillOpen = await listSentinelFindings(pool, goalId);
    expect(stillOpen.some((item) => item.findingId === finding!.findingId)).toBe(true);
  });

  it("throws SentinelFindingNotFoundError for a missing finding", async () => {
    await expect(resolveSentinelFinding(
      pool,
      randomUUID(),
      "reason",
      { goalId: randomUUID(), ownerId: "test", fencingToken: "1" },
      { actorId: "head:product", sessionRef: "opaque:product", commandId: randomUUID() },
    )).rejects.toBeInstanceOf(SentinelFindingNotFoundError);
  });
});
