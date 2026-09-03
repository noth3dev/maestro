import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { applyAllMigrations } from "./test-migrations.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PERSONA_AXES, SANE_PERSONA_BASELINE, taskContractContentHash, type DecisionPacket, type DepartmentPlanSubstance, type IndependentBrief, type MissionBundleSubstance, type MissionPersonaOverlayInputs, type TaskContractSubstance } from "@maestro/domain";
import { bootstrapPermanentOrganization } from "./organization.js";
import { acquireGoalLease } from "./commands.js";
import { createHeadCouncil, recordCouncilDecisionPacket, revealCouncilBriefs, submitIndependentBrief } from "./council.js";
import { createDepartmentPlan } from "./department-plan.js";
import {
  createMissionBundle,
  issueMissionPersonaOverlay,
  listMissionBundlesForPlan,
  MissionBundleError,
  MissionBundleNotFoundError,
  MissionPersonaOverlayExpiredError,
  MissionPersonaOverlayNotFoundError,
  readActiveMissionPersonaOverlay,
  readMissionBundle,
  readMissionPersonaOverlay,
} from "./mission-bundle.js";

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

const planSubstance = (): DepartmentPlanSubstance => ({
  contribution: "own the product slice", nonGoals: [],
  items: [
    { itemId: "scout-1", kind: "scout", objective: "assess risk", dependsOn: [], scoutQuestion: "what changed?", workerAssignment: "", evidenceReferences: [] },
    { itemId: "exec-1", kind: "execution", objective: "implement fix", dependsOn: ["scout-1"], scoutQuestion: "", workerAssignment: "implement the fix", evidenceReferences: [] },
  ],
  requiredHandoffs: [], budgetCeiling: "10 USD", expectedTime: "1 day", maxRetries: 1, maxWorkers: 2,
  gitRepository: "repo", gitBranch: "phase2/product", integrationPath: "packages/product",
  risks: [], safePausePoints: [], escalationTriggers: [], evidenceReferences: [], validationCriteria: ["tests pass"],
});

const bundleSubstance = (overrides: Partial<MissionBundleSubstance> = {}): MissionBundleSubstance => ({
  role: "scout", profileRef: "profile-1", goalBrief: "assess risk before implementation",
  approvedModels: ["model-a"], allowedSkills: ["research"], allowedTools: ["read"], allowedPaths: ["packages/product"],
  environment: ["node24"], authorityBoundary: ["read-only"], externalServiceBoundary: ["none"], dataBoundary: ["repository files only"],
  costCeiling: "1 USD", timeCeiling: "1 hour", retryCeiling: 1, workerCeiling: 0,
  deliverable: "a risk report", evidenceRequirements: ["citations"], validationCriteria: ["report reviewed"],
  terminationConditions: ["deadline passed"],
  ...overrides,
});

async function setupPlan(pool: Pool, departments = ["product"]) {
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
  for (const departmentId of departments) await pool.query("INSERT INTO goal_head_participations (goal_id, department_id, head_role_id, contract_id, status, active_session_ref) VALUES ($1, $2, $3, $4, 'active', $5)", [goalId, departmentId, `head:${departmentId}`, contractId, `opaque:${departmentId}`]);
  const proof = await acquireGoalLease(pool, { goalId, ownerId: "test", leaseDurationMs: 60_000 });
  const council = await createHeadCouncil(pool, { goalId, contractId, briefDeadline: new Date(Date.now() + 60_000), evidence }, proof, context("secretary"));
  for (const departmentId of departments) await submitIndependentBrief(pool, council.councilId, departmentId, brief, proof, headContext(departmentId));
  await revealCouncilBriefs(pool, council.councilId, proof, context("reveal"));
  const packet: DecisionPacket = {
    outcome: "decided", executionDisposition: "executable", selectedDirection: "proceed",
    rejectedAlternatives: [], departmentOwnership: departments.map((departmentId) => ({ departmentId, responsibility: "own it" })),
    workerPlan: [], completionCriteria: ["done"], failureCriteria: ["fail"], dissent: [], uncertainty: [],
    criticalActions: [], unresolvedConflicts: [], evidenceReferences: [],
  };
  const resolved = await recordCouncilDecisionPacket(pool, council.councilId, packet, proof, context("decision"));
  const plan = await createDepartmentPlan(pool, { councilId: resolved.councilId, departmentId: "product", substance: planSubstance() }, proof, headContext("product"));
  return { goalId, contractId, projectId, proof, council: resolved, plan };
}

describeDatabase("Mission Bundles with PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  beforeAll(async () => {
    await pool.query("DROP TABLE IF EXISTS mission_persona_overlays, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, council_round_contributions, council_rounds, independent_briefs, council_participants, head_councils, head_activation_edges, head_activation_attempts, goal_head_participations, task_contract_confirmations, task_contract_decisions, task_contracts, role_persona_axes, permanent_roles, permanent_head_roles, departments, organization_groups, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls CASCADE");
    await applyAllMigrations(pool);
  });
  beforeEach(async () => { await pool.query("TRUNCATE mission_persona_overlays, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, head_councils, goal_head_participations, task_contracts, evidence_records, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls RESTART IDENTITY CASCADE"); await bootstrapPermanentOrganization(pool); });
  afterAll(async () => { await pool.end(); });

  it("issues a Mission Bundle bound to a real Plan item by the captured Head", async () => {
    const { council, plan, proof } = await setupPlan(pool);
    const bundle = await createMissionBundle(pool, { councilId: council.councilId, departmentId: "product", itemId: "scout-1", substance: bundleSubstance() }, proof, headContext("product"));
    expect(bundle.planVersion).toBe(plan.version);
    expect(bundle.itemId).toBe("scout-1");
    const loaded = await readMissionBundle(pool, council.councilId, "product", plan.version, "scout-1");
    expect(loaded).toEqual(bundle);
  });

  it("rejects a bundle whose role does not match the plan item kind", async () => {
    const { council, proof } = await setupPlan(pool);
    await expect(createMissionBundle(pool, { councilId: council.councilId, departmentId: "product", itemId: "exec-1", substance: bundleSubstance({ role: "scout" }) }, proof, headContext("product"))).rejects.toBeInstanceOf(MissionBundleError);
  });

  it("rejects a bundle for an unknown plan item", async () => {
    const { council, proof } = await setupPlan(pool);
    await expect(createMissionBundle(pool, { councilId: council.councilId, departmentId: "product", itemId: "missing", substance: bundleSubstance() }, proof, headContext("product"))).rejects.toBeInstanceOf(MissionBundleError);
  });

  it("rejects an unauthorized issuer", async () => {
    const { council, proof } = await setupPlan(pool);
    await expect(createMissionBundle(pool, { councilId: council.councilId, departmentId: "product", itemId: "scout-1", substance: bundleSubstance() }, proof, context("not-the-head"))).rejects.toBeInstanceOf(MissionBundleError);
  });

  it("makes duplicate-content bundle creation idempotent and rejects a differing duplicate", async () => {
    const { council, proof } = await setupPlan(pool);
    const first = await createMissionBundle(pool, { councilId: council.councilId, departmentId: "product", itemId: "scout-1", substance: bundleSubstance() }, proof, headContext("product"));
    const replay = await createMissionBundle(pool, { councilId: council.councilId, departmentId: "product", itemId: "scout-1", substance: bundleSubstance() }, proof, headContext("product"));
    expect(replay).toEqual(first);
    await expect(createMissionBundle(pool, { councilId: council.councilId, departmentId: "product", itemId: "scout-1", substance: bundleSubstance({ costCeiling: "999 USD" }) }, proof, headContext("product"))).rejects.toBeInstanceOf(MissionBundleError);
  });

  it("lists all bundles for a plan version and rejects direct mutation of an issued bundle", async () => {
    const { council, plan, proof } = await setupPlan(pool);
    await createMissionBundle(pool, { councilId: council.councilId, departmentId: "product", itemId: "scout-1", substance: bundleSubstance() }, proof, headContext("product"));
    const listed = await listMissionBundlesForPlan(pool, council.councilId, "product", plan.version);
    expect(listed.length).toBe(1);
    await expect(pool.query("UPDATE mission_bundles SET content_hash = $1 WHERE council_id = $2", ["0".repeat(64), council.councilId])).rejects.toThrow();
  });

  it("denies Mission Bundle writes once the Goal is paused", async () => {
    const { council, proof, projectId, goalId } = await setupPlan(pool);
    await pool.query("INSERT INTO goal_controls (project_id, goal_id, pause_requested_at, paused_at) VALUES ($1, $2, clock_timestamp(), clock_timestamp()) ON CONFLICT (project_id, goal_id) DO UPDATE SET pause_requested_at = clock_timestamp(), paused_at = clock_timestamp()", [projectId, goalId]);
    await expect(createMissionBundle(pool, { councilId: council.councilId, departmentId: "product", itemId: "scout-1", substance: bundleSubstance() }, proof, headContext("product"))).rejects.toThrow();
  });

  it("throws MissionBundleNotFoundError for a missing bundle", async () => {
    await expect(readMissionBundle(pool, randomUUID(), "product", 1, "scout-1")).rejects.toBeInstanceOf(MissionBundleNotFoundError);
  });
});

function overlayInputs(overrides: Partial<MissionPersonaOverlayInputs> = {}): MissionPersonaOverlayInputs {
  return {
    departmentStyle: SANE_PERSONA_BASELINE,
    headChoice: SANE_PERSONA_BASELINE,
    taskAmbiguity: 0.5, risk: 0.5, collaborationDemand: 0.5, evidenceBurden: 0.5,
    ...overrides,
  };
}

describeDatabase("Mission Persona Overlays with PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  async function setupBundle() {
    const { council, plan, proof } = await setupPlan(pool);
    const bundle = await createMissionBundle(pool, { councilId: council.councilId, departmentId: "product", itemId: "scout-1", substance: bundleSubstance() }, proof, headContext("product"));
    return { council, plan, proof, bundle };
  }

  beforeAll(async () => {
    await pool.query("DROP TABLE IF EXISTS mission_persona_overlays, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, council_round_contributions, council_rounds, independent_briefs, council_participants, head_councils, head_activation_edges, head_activation_attempts, goal_head_participations, task_contract_confirmations, task_contract_decisions, task_contracts, role_persona_axes, permanent_roles, permanent_head_roles, departments, organization_groups, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls CASCADE");
    await applyAllMigrations(pool);
  });
  beforeEach(async () => { await pool.query("TRUNCATE mission_persona_overlays, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, head_councils, goal_head_participations, task_contracts, evidence_records, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls RESTART IDENTITY CASCADE"); await bootstrapPermanentOrganization(pool); });
  afterAll(async () => { await pool.end(); });

  it("issues a durable persona overlay whose axis values stay within [0,1]", async () => {
    const { council, plan, bundle } = await setupBundle();
    const overlay = await issueMissionPersonaOverlay(pool, {
      councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1",
      inputs: overlayInputs(), missionLifetimeMs: 60_000,
    });
    for (const axis of PERSONA_AXES) {
      expect(overlay.persona[axis]).toBeGreaterThanOrEqual(0);
      expect(overlay.persona[axis]).toBeLessThanOrEqual(1);
    }
    const loaded = await readMissionPersonaOverlay(pool, council.councilId, "product", plan.version, "scout-1");
    expect(loaded).toEqual(overlay);
    expect(bundle.itemId).toBe("scout-1");
  });

  it("makes identical-content overlay issuance idempotent and rejects a differing duplicate", async () => {
    const { council, plan } = await setupBundle();
    const first = await issueMissionPersonaOverlay(pool, {
      councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1",
      inputs: overlayInputs(), missionLifetimeMs: 60_000,
    });
    const replay = await issueMissionPersonaOverlay(pool, {
      councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1",
      inputs: overlayInputs(), missionLifetimeMs: 60_000,
    });
    expect(replay).toEqual(first);
    await expect(issueMissionPersonaOverlay(pool, {
      councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1",
      inputs: overlayInputs({ risk: 0.9 }), missionLifetimeMs: 60_000,
    })).rejects.toBeInstanceOf(MissionBundleError);
  });

  it("rejects issuance for a bundle that does not exist", async () => {
    await expect(issueMissionPersonaOverlay(pool, {
      councilId: randomUUID(), departmentId: "product", planVersion: 1, itemId: "scout-1",
      inputs: overlayInputs(), missionLifetimeMs: 60_000,
    })).rejects.toBeInstanceOf(MissionBundleNotFoundError);
  });

  it("rejects direct mutation of an issued overlay -- append-only", async () => {
    const { council, plan } = await setupBundle();
    await issueMissionPersonaOverlay(pool, {
      councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1",
      inputs: overlayInputs(), missionLifetimeMs: 60_000,
    });
    await expect(pool.query(
      "UPDATE mission_persona_overlays SET expires_at = expires_at + interval '1 hour' WHERE council_id = $1",
      [council.councilId],
    )).rejects.toThrow();
  });

  it("throws MissionPersonaOverlayNotFoundError when no overlay has been issued", async () => {
    const { council, plan } = await setupBundle();
    await expect(readMissionPersonaOverlay(pool, council.councilId, "product", plan.version, "scout-1")).rejects.toBeInstanceOf(MissionPersonaOverlayNotFoundError);
  });

  it("requires a positive whole-millisecond mission lifetime", async () => {
    const { council, plan, bundle } = await setupBundle();
    for (const missionLifetimeMs of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(issueMissionPersonaOverlay(pool, {
        councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: bundle.itemId,
        inputs: overlayInputs(), missionLifetimeMs,
      })).rejects.toBeInstanceOf(MissionBundleError);
    }
  });

  it("does not replay an expired overlay through a duplicate issuance", async () => {
    const { council, plan, bundle } = await setupBundle();
    const issued = await issueMissionPersonaOverlay(pool, {
      councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: bundle.itemId,
      inputs: overlayInputs(), missionLifetimeMs: 1_000,
    });
    vi.setSystemTime(new Date(Date.parse(issued.expiresAt) + 1));
    try {
      await expect(issueMissionPersonaOverlay(pool, {
        councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: bundle.itemId,
        inputs: overlayInputs(), missionLifetimeMs: 1_000,
      })).rejects.toBeInstanceOf(MissionPersonaOverlayExpiredError);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects an out-of-range persisted persona axis at the database boundary", async () => {
    const { council, plan, bundle } = await setupBundle();
    const invalidPersona = { ...SANE_PERSONA_BASELINE, caution: 1.1 };
    await expect(pool.query(
      `INSERT INTO mission_persona_overlays
         (council_id, department_id, plan_version, item_id, persona, expires_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, clock_timestamp() + interval '1 hour')`,
      [council.councilId, "product", plan.version, bundle.itemId, JSON.stringify(invalidPersona)],
    )).rejects.toThrow();
  });

  it("expires correctly once the mission's explicit lifetime bound has passed", async () => {
    const { council, plan } = await setupBundle();
    const issued = await issueMissionPersonaOverlay(pool, {
      councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1",
      inputs: overlayInputs(), missionLifetimeMs: 1_000,
    });
    const stillActive = await readActiveMissionPersonaOverlay(
      pool, council.councilId, "product", plan.version, "scout-1",
      new Date(Date.parse(issued.expiresAt) - 1),
    );
    const afterMissionEnds = new Date(Date.parse(issued.expiresAt) + 1);
    await expect(readActiveMissionPersonaOverlay(pool, council.councilId, "product", plan.version, "scout-1", afterMissionEnds)).rejects.toBeInstanceOf(MissionPersonaOverlayExpiredError);
    await expect(readMissionPersonaOverlay(pool, council.councilId, "product", plan.version, "scout-1", afterMissionEnds)).rejects.toBeInstanceOf(MissionPersonaOverlayExpiredError);
    // The durable row itself is retained for audit, but no public read returns
    // it after the mission lifetime has ended.
    const raw = await pool.query<{ persona: unknown }>(
      "SELECT persona FROM mission_persona_overlays WHERE council_id = $1 AND department_id = $2 AND plan_version = $3 AND item_id = $4",
      [council.councilId, "product", plan.version, "scout-1"],
    );
    expect(raw.rows[0]!.persona).toEqual(stillActive.persona);
  });
});
