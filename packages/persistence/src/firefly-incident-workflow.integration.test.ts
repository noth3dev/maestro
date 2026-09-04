import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { applyAllMigrations } from "./test-migrations.js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { localGitPort } from "@maestro/git-adapter";
import {
  buildFireflyIncidentBrief,
  deriveFireflyIncidentFingerprint,
  routeFireflyIncidentDepartments,
  signFireflySignal,
  type DecisionPacket,
  type DepartmentPlanSubstance,
  type ExecutionKernelPort,
  type FireflySignal,
  type IndependentBrief,
  type MissionBundleSubstance,
  type TaskContractSubstance,
} from "@maestro/domain";
import { bootstrapPermanentOrganization } from "./organization.js";
import { acquireGoalLease, executeGoalCommand, StaleGoalLeaseError } from "./commands.js";
import { createDurableTaskContract, launchConfirmedTaskContract, recordExactTaskContractConfirmation } from "./task-contract.js";
import { createHeadCouncil, recordCouncilDecisionPacket, revealCouncilBriefs, submitIndependentBrief } from "./council.js";
import { createDepartmentPlan } from "./department-plan.js";
import { createMissionBundle } from "./mission-bundle.js";
import { observeWorker, spawnWorker } from "./worker.js";
import { acceptDepartmentWorkerOutput, certifyQuality } from "./certification.js";
import { recordGoalIntegrationRevision, recordDepartmentBranch, recordGoalIntegrationBranch, recordIntegrationCommit, recordWorkerWorktree } from "./git-integration.js";
import { recordEvidenceBundle, verifyStoredEvidenceBundle } from "./evidence-bundle.js";
import { generateSaneFinalReport } from "./sane-report.js";
import { recordFireflySignal } from "./firefly.js";
import {
  FireflyIncidentAuthorizationError,
  FireflyIncidentError,
  closeFireflyIncident,
  linkFireflyIncidentToGoal,
  listFireflyImprovementEvidence,
  listFireflyIncidents,
  requestFireflyImmediateSafePause,
} from "./firefly-incident.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const context = (label: string) => ({ actorId: `actor:${label}`, sessionRef: `session:${label}`, commandId: randomUUID() });
const headContext = (departmentId: string) => ({ actorId: `head:${departmentId}`, sessionRef: `opaque:${departmentId}`, commandId: randomUUID() });
const brief: IndependentBrief = { interpretation: "safe outcome", contribution: "review", nonGoals: [], assumptions: [], evidenceGaps: [], risks: [], dependencies: [], proposedValidation: [], expectedWorkers: [], expectedCost: "1", expectedTime: "1", objectionsToLikelyAlternatives: [] };

function fakeKernel(): ExecutionKernelPort {
  let counter = 0;
  const invocations = new Map<string, { execution: string }>();
  return {
    async spawn() { counter += 1; const execution = `exec-${counter}`; const invocation = `inv-${counter}`; invocations.set(invocation, { execution }); return { execution: execution as never, invocation: invocation as never }; },
    async prompt() {}, async sendMessage() {},
    async observe(execution) {
      const matches = [...invocations.entries()].filter(([, v]) => v.execution === (execution as unknown as string));
      return matches.map(([invocation]) => ({ invocation: invocation as never, name: "worker", status: "succeeded" as const, toolEvents: { state: "empty" as const, events: [] }, usage: { state: "available" as const, totalTokens: 10 }, answer: { state: "available" as const, text: "implemented" } }));
    },
    async cancel() { return { cancelled: true }; },
    async getModelIdentity() { return { provider: "fake", id: "fake" }; },
    async getToolEvents() { return { state: "empty", events: [] }; },
    async getUsage() { return { state: "available", totalTokens: 10 }; },
    async getInvocationStatus() { return "succeeded"; },
    async resume() { throw new Error("not supported"); },
    async reconnect() { throw new Error("not supported"); },
  };
}

function signal(overrides: Partial<FireflySignal> = {}): FireflySignal {
  const now = Date.now();
  const value: FireflySignal = {
    incidentFingerprint: "",
    firstObservedAt: new Date(now - 2000).toISOString(),
    lastObservedAt: new Date(now - 1000).toISOString(),
    severity: "critical",
    confidence: 0.5,
    affectedComponent: "control-plane",
    affectedVersion: "1.0.0",
    minimalReproductionEvidence: ["GET /health -> 503"],
    source: "health-probe",
    sourceFreshness: new Date(now - 1000).toISOString(),
    deduplicationRelationship: "new",
    fireflyHealthState: "healthy",
    ...overrides,
  };
  return { ...value, incidentFingerprint: deriveFireflyIncidentFingerprint(value) };
}

describeDatabase("Phase 4 work-sequence step 8: Firefly incident through Task Contract, Council, remediation, and closure", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  let repositoryPath: string;
  let baseRevision: string;
  const worktreePaths: string[] = [];

  beforeEach(() => {
    repositoryPath = mkdtempSync(join(tmpdir(), "maestro-incident-e2e-"));
    execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: repositoryPath });
    execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "initial"], { cwd: repositoryPath });
    baseRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryPath }).toString().trim();
  });
  afterEach(() => {
    for (const path of worktreePaths.splice(0)) rmSync(path, { recursive: true, force: true });
    rmSync(repositoryPath, { recursive: true, force: true });
  });

  beforeAll(async () => {
    await pool.query("DROP TABLE IF EXISTS firefly_watchdog_checks, firefly_incident_signals, firefly_incidents, firefly_signals, sane_final_reports, evidence_bundles, certification_conflict_resolutions, certification_waivers, conditional_certifications, quality_certifications, certification_conflict_resolution_members, department_acceptances, goal_integration_revision_commits, goal_integration_revisions, overwatch_council_syntheses, overwatch_council_judgments, overwatch_council_rounds, semantic_reviews, sentinel_challenge_findings, sentinel_challenges, sentinel_findings, budget_forecasts, budget_reservations, integration_commits, worker_worktrees, department_branches, goal_integration_branches, team_lead_grants, workers, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, council_round_contributions, council_rounds, independent_briefs, council_participants, head_councils, head_activation_edges, head_activation_attempts, goal_head_participations, task_contract_confirmations, task_contract_decisions, task_contracts, role_persona_axes, permanent_roles, permanent_head_roles, departments, organization_groups, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls, device_grants, device_command_results, devices, device_policies CASCADE");
    await applyAllMigrations(pool);
    await bootstrapPermanentOrganization(pool);
  });
  afterAll(async () => { await pool.end(); });

  let signalSequence = 0;
  async function seedIncident(overrides: Partial<FireflySignal> = {}) {
    signalSequence += 1;
    const envelope = signFireflySignal(signal(overrides), "firefly-e2e-secret", randomUUID(), signalSequence);
    const stored = await recordFireflySignal(pool, envelope, "firefly-e2e-secret");
    const [incident] = await listFireflyIncidents(pool, stored.incidentFingerprint);
    return { stored, incident: incident! };
  }

  it("runs one real Firefly-triggered incident from Brief through remediation to a resolved closure", async () => {
    const { stored, incident } = await seedIncident({ severity: "critical", confidence: 0.5 });
    const kind = "crash" as const;
    expect(routeFireflyIncidentDepartments(kind)).toEqual(["operations", "engineering"]);
    const incidentBrief = buildFireflyIncidentBrief(incident, stored.minimalReproductionEvidence, kind);
    expect(incidentBrief.boundedEvidence).toEqual(stored.minimalReproductionEvidence);
    expect(incidentBrief.routedDepartments).toEqual(["operations", "engineering"]);

    const projectId = randomUUID();
    const goalId = randomUUID();
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "control-plane", leaseDurationMs: 120_000 });
    await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "sane", type: "CreateGoal", expectedVersion: 0 }, proof);
    await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "sane", type: "TransitionGoal", expectedVersion: 1, to: "ready_for_confirmation" }, proof);
    await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "sane", type: "TransitionGoal", expectedVersion: 2, to: "launched" }, proof);
    await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "sane", type: "TransitionGoal", expectedVersion: 3, to: "active" }, proof);

    const linked = await linkFireflyIncidentToGoal(pool, incident.incidentId, goalId, proof, context("sane"));
    expect(linked.status).toBe("triaging");
    expect(linked.linkedGoalId).toBe(goalId);
    const relinked = await linkFireflyIncidentToGoal(pool, incident.incidentId, goalId, proof, context("sane"));
    expect(relinked).toEqual(linked);

    const contractId = randomUUID();
    const substance: TaskContractSubstance = {
      desiredOutcome: "remediate the seeded incident", userVisibleBehavior: ["health probe recovers"], successCriteria: ["health probe returns 200"], liveEvidence: ["Phase 4 incident test"],
      scope: ["fix the health endpoint"], nonGoals: ["unrelated refactors"], priorities: ["safety", "correctness"], acceptableTradeoffs: ["no UI"], constraints: ["local only"], knownEdgeCases: ["none"],
      project: { projectId, repository: repositoryPath, immutableBaseRevision: baseRevision, dataBoundary: "repository files only" },
      evidenceReferences: [], approvedPreviewReferences: [], expectedGroups: ["Engineering Group"], expectedDepartments: ["engineering", "quality"],
      criticalActionExpectations: [], forbiddenEffects: ["remote push"], environmentAssumptions: ["PostgreSQL"], externalServiceAssumptions: [],
      budget: { ceiling: "1000 USD", reportingExpectations: ["on launch"], stoppingConditions: ["ceiling reached"] },
    };
    const contract = await createDurableTaskContract(pool, contractId, substance);
    await recordExactTaskContractConfirmation(pool, contractId, contract.version, contract.contentHash, "ceo");
    await launchConfirmedTaskContract(pool, contractId);

    const evidenceIds = [randomUUID(), randomUUID()];
    for (const departmentId of ["engineering", "quality"]) {
      await pool.query("INSERT INTO goal_head_participations (goal_id, department_id, head_role_id, contract_id, status, active_session_ref) VALUES ($1, $2, $3, $4, 'active', $5)", [goalId, departmentId, `head:${departmentId}`, contractId, `opaque:${departmentId}`]);
    }
    for (const evidenceId of evidenceIds) {
      await pool.query(
        "INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type, retention) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'test-result', 'text/plain', 'project_lifetime')",
        [evidenceId, randomUUID(), randomUUID(), projectId, goalId, "test", "0".repeat(64)],
      );
    }
    const council = await createHeadCouncil(pool, { goalId, contractId, briefDeadline: new Date(Date.now() + 60_000), evidence: { references: evidenceIds } }, proof, context("secretary"));
    for (const departmentId of ["engineering", "quality"]) await submitIndependentBrief(pool, council.councilId, departmentId, brief, proof, headContext(departmentId));
    await revealCouncilBriefs(pool, council.councilId, proof, context("reveal"));
    const packet: DecisionPacket = {
      outcome: "decided", executionDisposition: "executable", selectedDirection: "fix the health endpoint",
      rejectedAlternatives: [], departmentOwnership: [{ departmentId: "engineering", responsibility: "fix it" }, { departmentId: "quality", responsibility: "independently certify" }],
      workerPlan: [], completionCriteria: ["tests pass"], failureCriteria: ["tests fail"], dissent: [], uncertainty: [],
      criticalActions: [], unresolvedConflicts: [], evidenceReferences: [],
    };
    const resolved = await recordCouncilDecisionPacket(pool, council.councilId, packet, proof, context("decision"));
    expect(resolved.state).toBe("resolved");

    const planSubstance: DepartmentPlanSubstance = {
      contribution: "fix the health endpoint", nonGoals: [],
      items: [{ itemId: "exec-1", kind: "execution", objective: "fix the endpoint", dependsOn: [], scoutQuestion: "", workerAssignment: "fix and commit the change", evidenceReferences: [] }],
      requiredHandoffs: [], budgetCeiling: "500 USD", expectedTime: "1 day", maxRetries: 1, maxWorkers: 1,
      gitRepository: repositoryPath, gitBranch: "incident/engineering", integrationPath: "packages/engineering",
      risks: [], safePausePoints: [], escalationTriggers: [], evidenceReferences: [], validationCriteria: ["tests pass"],
    };
    const plan = await createDepartmentPlan(pool, { councilId: resolved.councilId, departmentId: "engineering", substance: planSubstance }, proof, headContext("engineering"));

    const bundleSubstance: MissionBundleSubstance = {
      role: "execution", profileRef: "profile-1", goalBrief: "fix and commit the change",
      approvedModels: ["model-a"], allowedSkills: ["implementation"], allowedTools: ["write"], allowedPaths: ["packages/engineering"],
      environment: ["node24"], authorityBoundary: ["write-scoped"], externalServiceBoundary: ["none"], dataBoundary: ["repository files only"],
      costCeiling: "100 USD", timeCeiling: "1 day", retryCeiling: 1, workerCeiling: 0,
      deliverable: "an implemented, committed fix", evidenceRequirements: ["diff"], validationCriteria: ["tests pass"],
      terminationConditions: ["deadline passed"],
    };
    await createMissionBundle(pool, { councilId: resolved.councilId, departmentId: "engineering", itemId: "exec-1", substance: bundleSubstance }, proof, headContext("engineering"));

    const kernel = fakeKernel();
    const worker = await spawnWorker(pool, kernel, { councilId: resolved.councilId, departmentId: "engineering", planVersion: plan.version, itemId: "exec-1" }, proof, headContext("engineering"));
    const observedWorker = await observeWorker(pool, kernel, worker.workerId);
    expect(observedWorker.status).toBe("succeeded");

    await recordGoalIntegrationBranch(pool, localGitPort, goalId, repositoryPath, "goal/integration", baseRevision, proof);
    await recordDepartmentBranch(pool, localGitPort, resolved.councilId, "engineering", proof, headContext("engineering"));
    const worktreePath = join(repositoryPath, "..", `maestro-incident-worker-${randomUUID()}`);
    worktreePaths.push(worktreePath);
    await recordWorkerWorktree(pool, localGitPort, worker.workerId, worktreePath, proof, headContext("engineering"));
    const fs = await import("node:fs/promises");
    await fs.writeFile(join(worktreePath, "fix.txt"), "the incident remediation change");
    const commitResult = await localGitPort.commit(worktreePath, "mission: fix the health endpoint", "worker", "worker@example.com");
    await recordIntegrationCommit(pool, worker.workerId, commitResult.commitSha, "mission: fix the health endpoint", evidenceIds);

    await localGitPort.advanceBranch(repositoryPath, "goal/integration", baseRevision, commitResult.commitSha);
    await acceptDepartmentWorkerOutput(pool, worker.workerId, { reason: "Head reviewed the integrated fix" }, headContext("engineering"));
    await recordGoalIntegrationRevision(pool, localGitPort, goalId, proof);
    const quality = await certifyQuality(pool, worker.workerId, { verdict: "passed", findings: [], testEvidenceIds: evidenceIds }, "quality", proof, headContext("quality"));
    expect(quality.verdict).toBe("passed");

    const bundle = await recordEvidenceBundle(pool, goalId);
    await verifyStoredEvidenceBundle(pool, bundle.bundleId);

    await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "sane", type: "TransitionGoal", expectedVersion: 4, to: "certifying" }, proof);
    const report = await generateSaneFinalReport(pool, goalId);
    expect(report.success).toBe(true);

    const closed = await closeFireflyIncident(pool, incident.incidentId, "resolved", "Fixed the health endpoint and certified independently.", "none", context("sane"), proof);
    expect(closed.status).toBe("resolved");
    expect(closed.linkedGoalId).toBe(goalId);
    expect(closed.closedAt).not.toBeNull();

    await expect(pool.query("UPDATE firefly_incidents SET status = 'open' WHERE incident_id = $1", [incident.incidentId])).rejects.toThrow();

    const improvementEvidence = (await listFireflyImprovementEvidence(pool)).find((e) => e.incidentId === incident.incidentId);
    expect(improvementEvidence).toMatchObject({ outcome: "resolved", severity: "critical" });
    expect(improvementEvidence!.detectionToTriageMs).not.toBeNull();
    expect(improvementEvidence!.triageToCloseMs).not.toBeNull();
    expect(improvementEvidence!.detectionToTriageMs).toBeGreaterThanOrEqual(0);
    expect(improvementEvidence!.triageToCloseMs).toBeGreaterThanOrEqual(0);
  });

  it("requests an immediate safe pause for a high-confidence critical incident and blocks Council writes until it is lifted", async () => {
    const { incident } = await seedIncident({ severity: "critical", confidence: 0.95, affectedComponent: "pause-test-component" });
    const projectId = randomUUID();
    const goalId = randomUUID();
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "control-plane", leaseDurationMs: 120_000 });
    await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "sane", type: "CreateGoal", expectedVersion: 0 }, proof);
    await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "sane", type: "TransitionGoal", expectedVersion: 1, to: "ready_for_confirmation" }, proof);
    await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "sane", type: "TransitionGoal", expectedVersion: 2, to: "launched" }, proof);
    await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "sane", type: "TransitionGoal", expectedVersion: 3, to: "active" }, proof);
    await linkFireflyIncidentToGoal(pool, incident.incidentId, goalId, proof, context("sane"));

    const paused = await requestFireflyImmediateSafePause(pool, incident.incidentId, projectId, proof, context("firefly"));
    expect(paused.incidentId).toBe(incident.incidentId);
    const control = await pool.query<{ pause_requested_at: Date | null }>("SELECT pause_requested_at FROM goal_controls WHERE goal_id = $1", [goalId]);
    expect(control.rows[0]!.pause_requested_at).not.toBeNull();

    const contractId = randomUUID();
    const contract = await createDurableTaskContract(pool, contractId, {
      desiredOutcome: "x", userVisibleBehavior: [], successCriteria: [], liveEvidence: [], scope: [], nonGoals: [], priorities: [], acceptableTradeoffs: [], constraints: [], knownEdgeCases: [],
      project: { projectId, repository: repositoryPath, immutableBaseRevision: baseRevision, dataBoundary: "repository files only" },
      evidenceReferences: [], approvedPreviewReferences: [], expectedGroups: [], expectedDepartments: [], criticalActionExpectations: [], forbiddenEffects: [], environmentAssumptions: [], externalServiceAssumptions: [],
      budget: { ceiling: "1", reportingExpectations: [], stoppingConditions: [] },
    });
    await recordExactTaskContractConfirmation(pool, contractId, contract.version, contract.contentHash, "ceo");
    await launchConfirmedTaskContract(pool, contractId);
    await expect(createHeadCouncil(pool, { goalId, contractId, briefDeadline: new Date(Date.now() + 60_000), evidence: { references: [] } }, proof, context("secretary"))).rejects.toThrow();
  });

  it("rejects an immediate safe pause request with a stale or forged lease proof even when the goalId matches", async () => {
    const { incident } = await seedIncident({ severity: "critical", confidence: 0.95, affectedComponent: "forged-proof-component" });
    const projectId = randomUUID();
    const goalId = randomUUID();
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "control-plane", leaseDurationMs: 120_000 });
    await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "sane", type: "CreateGoal", expectedVersion: 0 }, proof);
    await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "sane", type: "TransitionGoal", expectedVersion: 1, to: "ready_for_confirmation" }, proof);
    await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "sane", type: "TransitionGoal", expectedVersion: 2, to: "launched" }, proof);
    await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "sane", type: "TransitionGoal", expectedVersion: 3, to: "active" }, proof);
    await linkFireflyIncidentToGoal(pool, incident.incidentId, goalId, proof, context("sane"));

    const forgedProof = { goalId, ownerId: "attacker", fencingToken: proof.fencingToken };
    await expect(requestFireflyImmediateSafePause(pool, incident.incidentId, projectId, forgedProof, context("firefly"))).rejects.toThrow();
    const control = await pool.query<{ pause_requested_at: Date | null }>("SELECT pause_requested_at FROM goal_controls WHERE goal_id = $1", [goalId]);
    expect(control.rows[0]?.pause_requested_at ?? null).toBeNull();

    await expect(requestFireflyImmediateSafePause(pool, incident.incidentId, projectId, proof, context("firefly"))).resolves.toMatchObject({ incidentId: incident.incidentId });
  });

  it("rejects linking an incident to a Goal with a stale/forged fencing token, zero durable mutation, and the real proof still works afterward (Phase 2 re-patch item 8)", async () => {
    const { incident } = await seedIncident({ severity: "warning", confidence: 0.3, affectedComponent: "fencing-link-component" });
    const projectId = randomUUID();
    const goalId = randomUUID();
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "control-plane", leaseDurationMs: 120_000 });
    await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "sane", type: "CreateGoal", expectedVersion: 0 }, proof);
    await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "sane", type: "TransitionGoal", expectedVersion: 1, to: "ready_for_confirmation" }, proof);
    await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "sane", type: "TransitionGoal", expectedVersion: 2, to: "launched" }, proof);
    await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "sane", type: "TransitionGoal", expectedVersion: 3, to: "active" }, proof);

    const forgedProof = { goalId, ownerId: proof.ownerId, fencingToken: String(BigInt(proof.fencingToken) + 1n) };
    await expect(linkFireflyIncidentToGoal(pool, incident.incidentId, goalId, forgedProof, context("sane"))).rejects.toBeInstanceOf(StaleGoalLeaseError);
    const unlinked = (await listFireflyIncidents(pool)).find((i) => i.incidentId === incident.incidentId);
    expect(unlinked?.linkedGoalId ?? null).toBeNull();
    expect(unlinked?.status).toBe("open");

    const linked = await linkFireflyIncidentToGoal(pool, incident.incidentId, goalId, proof, context("sane"));
    expect(linked.linkedGoalId).toBe(goalId);
    expect(linked.status).toBe("triaging");
  });

  it("rejects an immediate safe pause request below the high-confidence critical threshold", async () => {
    const { incident } = await seedIncident({ severity: "critical", confidence: 0.5, affectedComponent: "below-threshold-component" });
    const projectId = randomUUID();
    const goalId = randomUUID();
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "control-plane", leaseDurationMs: 120_000 });
    await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "sane", type: "CreateGoal", expectedVersion: 0 }, proof);
    await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "sane", type: "TransitionGoal", expectedVersion: 1, to: "ready_for_confirmation" }, proof);
    await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "sane", type: "TransitionGoal", expectedVersion: 2, to: "launched" }, proof);
    await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "sane", type: "TransitionGoal", expectedVersion: 3, to: "active" }, proof);
    await linkFireflyIncidentToGoal(pool, incident.incidentId, goalId, proof, context("sane"));
    await expect(requestFireflyImmediateSafePause(pool, incident.incidentId, projectId, proof, context("firefly"))).rejects.toBeInstanceOf(FireflyIncidentAuthorizationError);
  });

  it("rejects a resolved close without proof of the linked Goal's current lease", async () => {
    const { incident } = await seedIncident({ severity: "warning", confidence: 0.3, affectedComponent: "unauthorized-close-component" });
    const goalId = randomUUID();
    const projectId = randomUUID();
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "control-plane", leaseDurationMs: 60_000 });
    await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "sane", type: "CreateGoal", expectedVersion: 0 }, proof);
    await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "sane", type: "TransitionGoal", expectedVersion: 1, to: "ready_for_confirmation" }, proof);
    await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "sane", type: "TransitionGoal", expectedVersion: 2, to: "launched" }, proof);
    await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "sane", type: "TransitionGoal", expectedVersion: 3, to: "active" }, proof);
    await linkFireflyIncidentToGoal(pool, incident.incidentId, goalId, proof, context("sane"));

    await expect(closeFireflyIncident(pool, incident.incidentId, "resolved", "done", "none", context("attacker"))).rejects.toThrow();
    const otherGoalProof = await acquireGoalLease(pool, { goalId: randomUUID(), ownerId: "control-plane", leaseDurationMs: 60_000 });
    await expect(closeFireflyIncident(pool, incident.incidentId, "resolved", "done", "none", context("attacker"), otherGoalProof)).rejects.toThrow();
    await expect(closeFireflyIncident(pool, incident.incidentId, "resolved", "done", "none", context("sane"), proof)).resolves.toMatchObject({ status: "resolved" });
  });

  it("closes a false positive without a linked Goal, and rejects a resolved close without one", async () => {
    const { incident } = await seedIncident({ severity: "warning", confidence: 0.3, affectedComponent: "false-positive-component" });
    const closed = await closeFireflyIncident(pool, incident.incidentId, "false_positive", "The named version is unaffected.", "none", context("security"));
    expect(closed.status).toBe("false_positive");
    expect(closed.linkedGoalId).toBeNull();
    const improvementEvidence = (await listFireflyImprovementEvidence(pool)).find((e) => e.incidentId === incident.incidentId);
    expect(improvementEvidence).toMatchObject({ outcome: "false_positive" });
    expect(improvementEvidence!.detectionToTriageMs).toBeNull();
    expect(improvementEvidence!.triageToCloseMs).toBeNull();

    const { incident: second } = await seedIncident({ severity: "warning", confidence: 0.3, affectedComponent: "unlinked-resolve-attempt-component" });
    await expect(closeFireflyIncident(pool, second.incidentId, "resolved", "done", "none", context("security"))).rejects.toBeInstanceOf(FireflyIncidentError);
  });
});
