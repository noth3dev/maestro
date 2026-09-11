import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { taskContractContentHash } from "@maestro/domain";
import {
  acquireGoalLease, applyAllMigrations, bootstrapPermanentOrganization, createDepartmentPlan, createHeadCouncil,
  createMissionBundle, observeWorker, readWorker, recordCouncilDecisionPacket, revealCouncilBriefs,
  spawnWorker, submitIndependentBrief,
} from "@maestro/persistence";
import { createDurableGoalService } from "./goal-service.js";
import { createMetronomeLoop } from "./metronome-loop.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("real Metronome continuous-observation loop with a real GoalService, real leases, and real PostgreSQL", () => {
  const basePool = new Pool({ connectionString: databaseUrl });
  const schema = `metronome_loop_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = databaseUrl === undefined ? "" : (() => { const url = new URL(databaseUrl); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })();
  let pool: Pool;

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: scopedUrl });
    await applyAllMigrations(pool);
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE metronome_findings, goal_leases, outbox, goal_events, command_receipts, goals CASCADE");
    await bootstrapPermanentOrganization(pool);
  });
  afterAll(async () => {
    await pool.end();
    await basePool.query(`DROP SCHEMA ${schema} CASCADE`);
    await basePool.end();
  });

  async function insertGoal(state: string): Promise<string> {
    const goalId = randomUUID();
    await pool.query(
      "INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, $3, 1, transaction_timestamp(), transaction_timestamp())",
      [goalId, randomUUID(), state],
    );
    return goalId;
  }

  it("scans every non-terminal Goal through a real Goal lease on one real pass, skips terminal Goals entirely, and durably finds nothing wrong with a routine Goal", async () => {
    const activeGoalId = await insertGoal("active");
    const pausedGoalId = await insertGoal("paused");
    const stoppedGoalId = await insertGoal("stopped");

    // No injected withGoalLease/scanGoal seam: this is the exact real
    // GoalService.withGoalLease production composition uses
    // (apps/control-plane/src/main.ts), acquiring a genuine PostgreSQL Goal
    // lease per Goal, and the loop's default real scanGoalForMetronomeFindings.
    const goalService = createDurableGoalService({ pool, leaseOwnerId: `metronome-loop-test-${randomUUID()}` });
    const ticks: { goalId: string; outcome: string }[] = [];
    const loop = createMetronomeLoop({
      pool, withGoalLease: goalService.withGoalLease!, intervalMs: 60_000,
      onTick: (result) => ticks.push({ goalId: result.goalId, outcome: result.outcome }),
    });

    await loop.runOnce();

    const scannedGoalIds = ticks.map((tick) => tick.goalId).sort();
    expect(scannedGoalIds).toEqual([activeGoalId, pausedGoalId].sort());
    expect(ticks.every((tick) => tick.outcome === "scanned")).toBe(true);
    expect(scannedGoalIds).not.toContain(stoppedGoalId);

    // Each real scan durably acquired and released its own Goal lease; a
    // second real pass immediately afterward must not be blocked by a lease
    // the first pass failed to release.
    ticks.length = 0;
    await loop.runOnce();
    expect(ticks.map((tick) => tick.goalId).sort()).toEqual([activeGoalId, pausedGoalId].sort());

    const findings = await pool.query("SELECT goal_id FROM metronome_findings");
    expect(findings.rows).toEqual([]);
  });
});

describeDatabase("real Metronome continuous-observation loop expiring awaiting-repair workers with a real GoalService, real leases, and real PostgreSQL", () => {
  const basePool = new Pool({ connectionString: databaseUrl });
  const schema = `metronome_loop_repair_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = databaseUrl === undefined ? "" : (() => { const url = new URL(databaseUrl); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })();
  let pool: Pool;

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: scopedUrl });
    await applyAllMigrations(pool);
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE metronome_findings, workers, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, head_councils, goal_head_participations, task_contracts, evidence_records, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls, capability_approvals, capability_repetition_budgets, capability_repetition_claims RESTART IDENTITY CASCADE");
    await bootstrapPermanentOrganization(pool);
  });
  afterAll(async () => {
    await pool.end();
    await basePool.query(`DROP SCHEMA ${schema} CASCADE`);
    await basePool.end();
  });

  function buildContractContent(projectId: string) {
    return {
      desiredOutcome: "deliver safely",
      userVisibleBehavior: [], successCriteria: [], liveEvidence: [], scope: [], nonGoals: [], priorities: [], acceptableTradeoffs: [], constraints: [], knownEdgeCases: [],
      project: { projectId, repository: "repo", immutableBaseRevision: "base", dataBoundary: "local" },
      evidenceReferences: [], approvedPreviewReferences: [], expectedGroups: [], expectedDepartments: [], criticalActionExpectations: [], forbiddenEffects: [], environmentAssumptions: [], externalServiceAssumptions: [],
      budget: { ceiling: "1", reportingExpectations: [], stoppingConditions: [] },
    };
  }
  const brief = { interpretation: "safe outcome", contribution: "review", nonGoals: [], assumptions: [], evidenceGaps: [], risks: [], dependencies: [], proposedValidation: [], expectedWorkers: [], expectedCost: "1", expectedTime: "1", objectionsToLikelyAlternatives: [] };
  const evidence = { references: [randomUUID(), randomUUID()] };
  const context = (label: string) => ({ actorId: `actor:${label}`, sessionRef: `session:${label}`, commandId: randomUUID() });
  const headContext = (departmentId: string) => ({ actorId: `head:${departmentId}`, sessionRef: `opaque:${departmentId}`, commandId: randomUUID() });
  const planSubstance = () => ({
    contribution: "own the product slice", nonGoals: [],
    items: [{ itemId: "scout-1", kind: "scout" as const, objective: "assess risk", dependsOn: [], scoutQuestion: "what changed?", workerAssignment: "", evidenceReferences: [] }],
    requiredHandoffs: [], budgetCeiling: "10 USD", expectedTime: "1 day", maxRetries: 1, maxWorkers: 1,
    gitRepository: "repo", gitBranch: "phase2/product", integrationPath: "packages/product",
    risks: [], safePausePoints: [], escalationTriggers: [], evidenceReferences: [], validationCriteria: ["tests pass"],
  });
  const bundleSubstance = () => ({
    role: "scout" as const, profileRef: "profile-1", goalBrief: "assess risk before implementation",
    taskDemand: { schemaVersion: 1 as const, taskKinds: ["research" as const], requirements: { reasoning: { level: 80, rationale: "r" }, coding: { level: 80, rationale: "r" }, verification: { level: 80, rationale: "r" }, "instruction-fidelity": { level: 80, rationale: "r" }, "tool-use": { level: 80, rationale: "r" }, "long-context": { level: 80, rationale: "r" }, knowledge: { level: 80, rationale: "r" }, "refusal-calibration": { level: 80, rationale: "r" } }, provenance: { taskContractRef: "task-contract:fixture", headDecisionRef: "head-decision:fixture" } },
    approvedModels: ["test/model-a"], allowedSkills: ["research"], allowedTools: ["read"], allowedPaths: ["packages/product"],
    environment: ["node24"], authorityBoundary: ["read-only"], externalServiceBoundary: ["none"], dataBoundary: ["repository files only"],
    costCeiling: "1 USD", timeCeiling: "1 hour", retryCeiling: 1, workerCeiling: 0,
    deliverable: "a risk report", evidenceRequirements: ["citations"], validationCriteria: ["report reviewed"],
    terminationConditions: ["deadline passed"],
    repairHold: { approvalId: randomUUID(), window: "1 minute", repetitionScope: { kind: "bounded_count" as const, count: 1 } },
  });

  function fakeKernel(finalStatus: "succeeded" | "running" = "succeeded") {
    let counter = 0;
    const invocations = new Map<string, { execution: string; name: string }>();
    return {
      releasedInvocations: [] as string[],
      async spawn(request: { name: string }) {
        counter += 1;
        const execution = `exec-${counter}`;
        const invocation = `inv-${counter}`;
        invocations.set(invocation, { execution, name: request.name });
        return { execution: execution as never, invocation: invocation as never };
      },
      async prompt() { /* no-op */ },
      async observe(execution: unknown) {
        const matches = [...invocations.entries()].filter(([, value]) => value.execution === (execution as unknown as string));
        return matches.map(([invocation, value]) => ({
          invocation: invocation as never, name: value.name, status: finalStatus,
          toolEvents: { state: "empty" as const, events: [] as const }, usage: { state: "available" as const, totalTokens: 42 },
          answer: finalStatus === "succeeded" ? { state: "available" as const, text: "done" } : { state: "unavailable" as const, reason: "snapshot-unavailable" as const },
        }));
      },
      async sendMessage() { /* no-op */ },
      async cancel() { return { cancelled: true }; },
      async getModelIdentity() { return { provider: "test", id: "model-a" }; },
      async getExecutionBinding() { return { model: { provider: "test", id: "model-a" }, accountRef: "test-account", gatewayInstanceId: "gateway-test", gatewayBindingId: "binding-test", dataPolicyHash: "policy-test" }; },
      async getToolEvents() { return { state: "empty" as const, events: [] as const }; },
      async getUsage() { return { state: "available" as const, totalTokens: 42 }; },
      async getInvocationStatus() { return finalStatus; },
      async release(invocation: unknown) { this.releasedInvocations.push(invocation as unknown as string); },
      async resume() { throw new Error("not supported by fake kernel"); },
      async reconnect() { throw new Error("not supported by fake kernel"); },
    };
  }

  it("automatically expires an unused repair hold through the real scheduled metronome loop pass, releasing the kernel session with no manual call", async () => {
    const goalId = randomUUID(), contractId = randomUUID(), projectId = randomUUID();
    const contractContent = buildContractContent(projectId);
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
    await pool.query("INSERT INTO task_contracts (contract_id, schema_version, version, content, content_hash, launch_state) VALUES ($1, 1, 1, $2::jsonb, $3, 'launched')", [contractId, JSON.stringify(contractContent), taskContractContentHash(contractContent as never)]);
    for (const evidenceId of evidence.references) {
      await pool.query(
        "INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type, retention) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'test-result', 'text/plain', 'project_lifetime')",
        [evidenceId, randomUUID(), randomUUID(), projectId, goalId, "test", "0".repeat(64)],
      );
    }
    await pool.query("INSERT INTO goal_head_participations (goal_id, department_id, head_role_id, contract_id, status, active_session_ref) VALUES ($1, 'product', 'head:product', $2, 'active', 'opaque:product')", [goalId, contractId]);
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "test", leaseDurationMs: 60_000 });
    const council = await createHeadCouncil(pool, { goalId, contractId, briefDeadline: new Date(Date.now() + 60_000), evidence }, proof, context("secretary"));
    await submitIndependentBrief(pool, council.councilId, "product", brief as never, proof, headContext("product"));
    await revealCouncilBriefs(pool, council.councilId, proof, context("reveal"));
    const resolved = await recordCouncilDecisionPacket(pool, council.councilId, {
      outcome: "decided", executionDisposition: "executable", selectedDirection: "proceed",
      rejectedAlternatives: [], departmentOwnership: [{ departmentId: "product", responsibility: "own it" }],
      workerPlan: [], completionCriteria: ["done"], failureCriteria: ["fail"], dissent: [], uncertainty: [],
      criticalActions: [], unresolvedConflicts: [], evidenceReferences: [],
    } as never, proof, context("decision"));
    const plan = await createDepartmentPlan(pool, { councilId: resolved.councilId, departmentId: "product", substance: planSubstance() as never }, proof, headContext("product"));
    await createMissionBundle(pool, { councilId: resolved.councilId, departmentId: "product", itemId: "scout-1", substance: bundleSubstance() as never }, proof, headContext("product"));

    const kernel = fakeKernel("succeeded");
    const worker = await spawnWorker(pool, kernel as never, { councilId: resolved.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, proof, headContext("product"));
    const held = await observeWorker(pool, kernel as never, worker.workerId, proof, headContext("product"));
    expect(held.status).toBe("awaiting_repair");
    expect(kernel.releasedInvocations).toEqual([]);

    // The repair-hold window has genuinely elapsed. No test calls the
    // lower-level expireAwaitingRepairWorker helper directly here -- only
    // the real scheduled metronome loop pass does.
    await pool.query("UPDATE workers SET repair_hold_expires_at = clock_timestamp() - interval '1 second' WHERE worker_id = $1", [worker.workerId]);
    await pool.query("UPDATE goal_leases SET expires_at = clock_timestamp() - interval '1 millisecond' WHERE goal_id = $1", [goalId]);

    const goalService = createDurableGoalService({ pool, leaseOwnerId: `metronome-loop-repair-test-${randomUUID()}` });
    const loop = createMetronomeLoop({ pool, kernel: kernel as never, withGoalLease: goalService.withGoalLease!, intervalMs: 60_000 });

    await loop.runOnce();

    const reconciledWorker = await readWorker(pool, worker.workerId);
    expect(reconciledWorker.status).toBe("succeeded");
    expect(kernel.releasedInvocations).toEqual([worker.invocationRef]);
  });
});
