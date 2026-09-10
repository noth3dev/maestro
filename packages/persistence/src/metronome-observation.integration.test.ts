import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { MODEL_CAPABILITY_AXES, calculatePressure, classifyPressureBand, taskDemandContentHash, type RoutingEvidence } from "@maestro/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyAllMigrations } from "./test-migrations.js";
import { bootstrapPermanentOrganization } from "./organization.js";
import { acquireGoalLease } from "./commands.js";
import { appendCapabilityJournal, consumeCapabilityApproval, createCapabilityApproval } from "./capability-approval.js";
import { observeCapabilityDecisions, observeGoalForMetronome } from "./metronome.js";
import { recordRoutingEvidence } from "./ensemble-router-artifacts.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("Metronome approval observation with PostgreSQL", () => {
  const basePool = new Pool({ connectionString: databaseUrl });
  const schema = `metronome_observation_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = databaseUrl === undefined ? "" : (() => { const url = new URL(databaseUrl); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })();
  let pool: Pool;

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: scopedUrl });
    await applyAllMigrations(pool);
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE capability_effect_resolutions, capability_decision_journal, capability_repetition_claims, capability_repetition_budgets, capability_approvals, metronome_challenge_findings, metronome_challenges, metronome_findings, ensemble_router_routing_evidence, evidence_records, goal_leases, goals, goal_controls CASCADE");
    await bootstrapPermanentOrganization(pool);
  });
  afterAll(async () => {
    await pool.end();
    await basePool.query(`DROP SCHEMA ${schema} CASCADE`);
    await basePool.end();
  });

  function validRoutingEvidence(goalId: string, projectId: string, evidenceId: string, codingScore: number): RoutingEvidence {
    const provenance = { taskContractRef: "contract:fixture", headDecisionRef: "decision:fixture" } as const;
    const taskDemand = {
      schemaVersion: 1 as const, taskKinds: ["coding" as const],
      requirements: Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, { level: 80, rationale: "Head requirement" }])) as Record<string, { level: number; rationale: string }>,
      provenance,
    };
    const workCharacter = { schemaVersion: 1 as const, risk: 40, reversibility: 120, verificationAttachment: 80, materialScale: 20, timePressure: 30, budgetHeadroom: 150, provenance };
    const pressureCalculation = calculatePressure(workCharacter, 100);
    const pressureProjection = classifyPressureBand(pressureCalculation.pressure);
    const routingEvidence: RoutingEvidence = {
      schemaVersion: 1, evidenceId, goalRef: goalId, projectRef: projectId, routeRef: `route:${evidenceId}`, mode: "pin",
      selectedModelRef: "provider/model", accountBinding: "account", candidateRefs: ["candidate"], selectedCandidateRef: "candidate", rejections: [],
      taskDemandHash: taskDemandContentHash(taskDemand), pressure: pressureCalculation.pressure, pressureBand: pressureProjection.band, decisionLayer: pressureProjection.decisionLayer,
      overlayVersion: 1, admissionBindingRef: "binding", rationale: "below requirement", createdAt: new Date().toISOString(), pressureCalculation,
      taskKindRecipeVersions: { coding: 1 }, taskDemand, workCharacter,
      modelProfile: {
        modelRef: "provider/model", capability: { schemaVersion: 2, axes: Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, { status: "scored", score: axis === "coding" ? codingScore : 180, rationale: "review", evidence: ["review:fixture"] }])) },
        providerFacts: { schemaVersion: 1, contextCapacity: 128000, pricing: { inputPerMillionTokens: 1, outputPerMillionTokens: 2 }, authentication: { modes: ["api-key"] }, dataPolicy: { allowedDataClasses: ["public"], retention: "transient", trainingUse: "never", regions: ["us"] }, modalities: ["text"], toolCalls: { supported: true }, provenance: { source: "fixture", observedAt: "2026-09-10" } },
        provenance: { owner: "human", sourceRefs: ["review:fixture"], reviewedAt: "2026-09-10" },
      },
      operationalOverlaySnapshot: { schemaVersion: 1, installationRef: "installation:fixture", projectRef: projectId, goalRef: goalId, overlayVersion: 1, observations: [{ candidateRef: "candidate", measuredLatencyMs: 10, measuredCost: 1, failureRate: 0, timeoutRate: 0, providerErrorRate: 0, currentAvailability: true, accountBinding: "account", observedAt: "2026-09-10T00:00:00Z" }] },
      approvalRef: null, approvalIdentity: null,
    };
    return routingEvidence;
  }

  async function insertValidRoutingEvidence(goalId: string, projectId: string, evidenceId: string, codingScore: number): Promise<void> {
    await recordRoutingEvidence(pool, validRoutingEvidence(goalId, projectId, evidenceId, codingScore));
  }

  async function insertGoal(): Promise<{ goalId: string; projectId: string }> {
    const goalId = randomUUID();
    const projectId = randomUUID();
    await pool.query(
      "INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())",
      [goalId, projectId],
    );
    return { goalId, projectId };
  }

  it("surfaces approval decisions, stopped work, effects, and failures without changing the approval ledger", async () => {
    const { goalId, projectId } = await insertGoal();
    const common = { capabilityKind: "ipython", projectId, goalId };
    const approvalId = randomUUID();
    await createCapabilityApproval(pool, {
      approvalId, ...common, commandId: "approval-command", action: "run", target: "target",
      policyVersion: 1, controlEpoch: "epoch-1", budgetEffectCents: 0, tier: "user", approverId: "user-1",
      decision: "approved", reason: "approved for test", consequence: "bounded", expiresAt: new Date(Date.now() + 60_000), repetitionScope: { kind: "one_execution" },
    });
    await consumeCapabilityApproval(pool, {
      approvalId, ...common, commandId: "effect-command", admissionCommandId: "admission-command", effectIndex: 0,
      action: "run", target: "target", policyVersion: 1, controlEpoch: "epoch-1", budgetEffectCents: 0,
    });
    await appendCapabilityJournal(pool, { ...common, approvalId, commandId: "command-2", event: "rejection", details: { reason: "not approved" } });
    await appendCapabilityJournal(pool, { ...common, approvalId, commandId: "command-3", event: "safer_alternative", details: { alternative: "review-only" } });
    await appendCapabilityJournal(pool, { ...common, approvalId, commandId: "command-4", event: "interruption", details: { stage: "stop", outcome: "stopped", intentCount: 2, appliedCount: 1, skippedCount: 1 } });
    await appendCapabilityJournal(pool, { ...common, approvalId, commandId: "command-6", event: "failure", details: { outcome: "stopped", appliedCount: 0, skippedCount: 1, reason: "interrupted" } });

    const before = await pool.query<{ approvals: string; journal: string; claims: string; resolutions: string }>(
      "SELECT (SELECT count(*) FROM capability_approvals) AS approvals, (SELECT count(*) FROM capability_decision_journal) AS journal, (SELECT count(*) FROM capability_repetition_claims) AS claims, (SELECT count(*) FROM capability_effect_resolutions) AS resolutions",
    );
    const observed = await observeCapabilityDecisions(pool, "ipython", projectId, goalId);
    const after = await pool.query<{ approvals: string; journal: string; claims: string; resolutions: string }>(
      "SELECT (SELECT count(*) FROM capability_approvals) AS approvals, (SELECT count(*) FROM capability_decision_journal) AS journal, (SELECT count(*) FROM capability_repetition_claims) AS claims, (SELECT count(*) FROM capability_effect_resolutions) AS resolutions",
    );

    expect(observed.decisions).toHaveLength(6);
    expect(observed.decisions.map((entry) => entry.event)).toEqual(expect.arrayContaining(["approval", "rejection", "safer_alternative", "interruption", "effect_result", "failure"]));
    expect(observed.pendingEffects).toEqual([{ commandId: "effect-command", effectIndex: 0, admissionCommandId: "admission-command" }]);
    expect(observed.decisions.find((entry) => entry.event === "interruption")?.details).toMatchObject({ outcome: "stopped", appliedCount: 1, skippedCount: 1 });
    expect(observed.decisions.find((entry) => entry.event === "failure")?.details).toMatchObject({ outcome: "stopped", appliedCount: 0, skippedCount: 1 });
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it("fails closed when a stored routing evidence payload is malformed", async () => {
    const { goalId, projectId } = await insertGoal();
    const routeId = randomUUID();
    await pool.query(
      `INSERT INTO ensemble_router_routing_evidence
        (evidence_id, goal_ref, project_ref, route_ref, mode, selected_model_ref, account_binding, candidate_refs, rejections, task_demand_hash, pressure, pressure_band, decision_layer, overlay_version, admission_binding_ref, rationale, evidence)
       VALUES ($1, $2, $3, $4, 'pin', 'provider/model', 'account', '["candidate"]'::jsonb, '[]'::jsonb, $5, 120, 'high', 'Encore Council', 1, 'binding', 'malformed', $6::jsonb)`,
      [routeId, goalId, projectId, `route:${routeId}`, "0".repeat(64), JSON.stringify({ evidenceId: routeId, selectedModelRef: "provider/model", taskDemand: { requirements: { coding: { level: 80 } } }, modelProfile: { capability: { axes: { coding: { status: "scored", score: 80 } } } } })],
    );
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "metronome-test", leaseDurationMs: 60_000 });
    await expect(observeGoalForMetronome(pool, goalId, proof, { actorId: "encore-metronome", sessionRef: "metronome-test", commandId: randomUUID() })).rejects.toThrow("Routing evidence is malformed");
    expect((await pool.query("SELECT count(*)::int AS count FROM metronome_findings WHERE goal_id = $1", [goalId])).rows[0].count).toBe(0);
  });

  it("fails closed when routing evidence payload identity disagrees with its durable row", async () => {
    const { goalId, projectId } = await insertGoal();
    const routeId = randomUUID();
    const evidence = validRoutingEvidence(goalId, projectId, routeId, 79);
    const tampered = { ...evidence, routeRef: `tampered:${routeId}` };
    await pool.query(
      `INSERT INTO ensemble_router_routing_evidence
        (evidence_id, goal_ref, project_ref, route_ref, mode, selected_model_ref, account_binding, candidate_refs, rejections, task_demand_hash, pressure, pressure_band, decision_layer, overlay_version, admission_binding_ref, rationale, evidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13, $14, $15, $16, $17::jsonb)`,
      [routeId, goalId, projectId, evidence.routeRef, evidence.mode, evidence.selectedModelRef, evidence.accountBinding, JSON.stringify(evidence.candidateRefs), JSON.stringify(evidence.rejections), evidence.taskDemandHash, evidence.pressure, evidence.pressureBand, evidence.decisionLayer, evidence.overlayVersion, evidence.admissionBindingRef, evidence.rationale, JSON.stringify(tampered)],
    );
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "metronome-test", leaseDurationMs: 60_000 });
    await expect(observeGoalForMetronome(pool, goalId, proof, { actorId: "encore-metronome", sessionRef: "metronome-test", commandId: randomUUID() })).rejects.toThrow("Routing evidence is malformed");
  });

  it("fails closed when routing evidence is bound to the Goal but a different project", async () => {
    const { goalId } = await insertGoal();
    const otherProjectId = randomUUID();
    const routeId = randomUUID();
    const evidence = validRoutingEvidence(goalId, otherProjectId, routeId, 180);
    await pool.query(
      `INSERT INTO ensemble_router_routing_evidence
        (evidence_id, goal_ref, project_ref, route_ref, mode, selected_model_ref, account_binding, candidate_refs, rejections, task_demand_hash, pressure, pressure_band, decision_layer, overlay_version, admission_binding_ref, rationale, evidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13, $14, $15, $16, $17::jsonb)`,
      [routeId, goalId, otherProjectId, evidence.routeRef, evidence.mode, evidence.selectedModelRef, evidence.accountBinding, JSON.stringify(evidence.candidateRefs), JSON.stringify(evidence.rejections), evidence.taskDemandHash, evidence.pressure, evidence.pressureBand, evidence.decisionLayer, evidence.overlayVersion, evidence.admissionBindingRef, evidence.rationale, JSON.stringify(evidence)],
    );
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "metronome-test", leaseDurationMs: 60_000 });
    await expect(observeGoalForMetronome(pool, goalId, proof, { actorId: "encore-metronome", sessionRef: "metronome-test", commandId: randomUUID() })).rejects.toThrow("routing evidence project scope");
  });

  it("raises a challenge for a durable below-requirement route but never creates an approval", async () => {
    const { goalId, projectId } = await insertGoal();
    const routeId = randomUUID();
    await insertValidRoutingEvidence(goalId, projectId, routeId, 79);
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "metronome-test", leaseDurationMs: 60_000 });
    const observation = await observeGoalForMetronome(pool, goalId, proof, { actorId: "encore-metronome", sessionRef: "metronome-test", commandId: randomUUID() });

    expect(observation.findings).toEqual([expect.objectContaining({ ruleId: "below_requirement_routing", evidenceIdentity: routeId })]);
    expect(observation.challenges).toEqual([expect.objectContaining({ status: "open", raisedBy: "encore-metronome", evidenceReferences: [routeId] })]);
    expect(observation.challenges[0]?.reason).toContain(routeId);
    expect((await pool.query("SELECT count(*)::int AS count FROM capability_approvals WHERE goal_id = $1", [goalId])).rows[0].count).toBe(0);
  });
});
