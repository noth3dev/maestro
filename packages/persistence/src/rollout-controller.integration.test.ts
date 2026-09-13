import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  improvementCandidateScenarioSuiteHash,
  type ImprovementCandidateInput,
  type ImprovementCandidate,
} from "@maestro/domain";
import { applyAllMigrations } from "./test-migrations.js";
import { acquireGoalLease } from "./commands.js";
import { grantProjectMembership, grantProjectRole } from "./project-membership.js";
import { recordImprovementDigest } from "./improvement-digest.js";
import {
  recordImprovementCandidate,
  transitionImprovementCandidate,
  type ImprovementCandidateAuthor,
} from "./improvement-candidate.js";
import {
  enableImprovementClass,
  startBoundedRollout,
  observeBoundedRollout,
  interruptBoundedRollout,
  reconcileInterruptedRollout,
  readBoundedRollout,
  type RolloutActor,
  type RolloutScope,
} from "./rollout-controller.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL ?? "postgresql://127.0.0.1/maestro_test";
const describeDatabase = process.env.MAESTRO_TEST_DATABASE_URL ? describe : describe.skip;
const operatorId = randomUUID();
const actor: RolloutActor = { operatorId, actorId: "concertmaster", sessionRef: "session:rollout", operatorRoleId: "concertmaster" };
const candidateAuthor: ImprovementCandidateAuthor = { authorId: "worker-engineering", sessionRef: "session:candidate", operatorId, operatorRoleId: "engineering" };

 describeDatabase("bounded rollout persistence", () => {
  const basePool = new Pool({ connectionString: databaseUrl });
  const schema = `rollout_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = (() => { const url = new URL(databaseUrl); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })();
  let pool: Pool;
  let projectId: string;
  let goalId: string;
  let digestId: string;
  let proof: Awaited<ReturnType<typeof acquireGoalLease>>;
  let candidate: ImprovementCandidate;

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: scopedUrl });
    await applyAllMigrations(pool);
  });
  beforeEach(async () => {
    projectId = randomUUID(); goalId = randomUUID();
    await pool.query("INSERT INTO local_operators (operator_id) VALUES ($1) ON CONFLICT DO NOTHING", [operatorId]);
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
    await grantProjectMembership(pool, operatorId, projectId);
    await grantProjectRole(pool, operatorId, projectId, "engineering");
    const digest = await recordImprovementDigest(pool, {
      schemaVersion: 1, projectId, goalId, episodeId: `rollout-${randomUUID()}`, trigger: "goal_completed",
      situation: "The bounded rollout has comparable evidence.", selectedDecision: "Use the measured predecessor.", rejectedAlternatives: ["Skip evidence."],
      observedResult: "Protected metrics were recorded.", metrics: [{ name: "correctness", value: 0.95, unit: "score" }], confidence: 0.9,
      sourceRefs: [{ kind: "goal", sourceId: goalId }],
    }, proof = await acquireGoalLease(pool, { goalId, ownerId: "rollout-worker", leaseDurationMs: 60_000 }), { actorId: candidateAuthor.authorId, sessionRef: candidateAuthor.sessionRef, operatorId });
    digestId = digest.digestId;
    const rollbackTargetId = randomUUID();
    await pool.query("INSERT INTO improvement_candidate_rollback_targets (target_candidate_id, target_version, project_id, goal_id, content_hash) VALUES ($1, 1, $2, $3, $4)", [rollbackTargetId, projectId, goalId, "a".repeat(64)]);
    const input: ImprovementCandidateInput = {
      schemaVersion: 1, projectId, goalId, kind: "persona_axis", target: { roleId: "head-engineering", taskClass: "implementation" },
      changes: [{ axis: "caution", currentValue: 0.7, proposedValue: 0.76 }], sourceEvidenceIds: [digestId],
      evidencePattern: "Comparable Goals recorded avoidable risk-review omissions.", predictedEffect: "The role will surface reversible-risk checks earlier.",
      expectedMetrics: [{ name: "correctness", unit: "score", direction: "increase", target: 1 }], protectedMetrics: [{ name: "correctness", unit: "score", minimum: 0.9 }],
      scenarioSuite: ["implementation-risk-review-v1"], scenarioSuiteHash: improvementCandidateScenarioSuiteHash(["implementation-risk-review-v1"]), confidence: 0.84,
      dataSufficiency: { episodeCount: 3, comparableGoalCount: 2 }, rollbackTarget: { candidateId: rollbackTargetId, version: 1, contentHash: "a".repeat(64) },
    };
    const initial = await recordImprovementCandidate(pool, input, proof, candidateAuthor, `candidate-${randomUUID()}`);
    const evaluated = await transitionImprovementCandidate(pool, initial.candidateId, "evaluated", proof, candidateAuthor, `evaluated-${randomUUID()}`);
    candidate = await transitionImprovementCandidate(pool, evaluated.candidateId, "judged", proof, candidateAuthor, `judged-${randomUUID()}`);
  });
  afterAll(async () => { await pool.end(); await basePool.query(`DROP SCHEMA ${schema} CASCADE`); await basePool.end(); });

  const scope: RolloutScope = { roleId: "head-engineering", taskClass: "implementation", maxGoalCount: 2, windowStart: "2026-09-14T00:00:00.000Z", windowEnd: "2026-09-15T00:00:00.000Z" };

  it("denies applying a judged candidate until its exact improvement class is enabled", async () => {
    await expect(startBoundedRollout(pool, candidate.candidateId, scope, proof, actor, `start-${randomUUID()}`)).rejects.toThrow(/enabled|class/i);
    await enableImprovementClass(pool, projectId, "persona_axis", proof, actor, `enable-${randomUUID()}`);
    await expect(startBoundedRollout(pool, candidate.candidateId, { ...scope, taskClass: "unrelated" }, proof, actor, `start-${randomUUID()}`)).rejects.toThrow(/scope|target|task/i);
    await expect(startBoundedRollout(pool, candidate.candidateId, scope, proof, actor, `start-${randomUUID()}`)).resolves.toMatchObject({ status: "active" });
  });

  it("keeps each enabled improvement class isolated and bounds the rollout scope", async () => {
    await enableImprovementClass(pool, projectId, "persona_axis", proof, actor, `enable-${randomUUID()}`);
    const rollout = await startBoundedRollout(pool, candidate.candidateId, scope, proof, actor, `start-${randomUUID()}`);
    await expect(observeBoundedRollout(pool, rollout.rolloutId, { goalId, observedAt: "2026-09-14T01:00:00.000Z", metrics: [{ name: "correctness", value: 0.95 }] }, proof, actor, `observe-${randomUUID()}`)).resolves.toMatchObject({ status: "active" });
    await expect(observeBoundedRollout(pool, rollout.rolloutId, { goalId, observedAt: "2026-09-14T01:00:00.000Z", goalCount: 3, metrics: [{ name: "correctness", value: 0.95 }] }, proof, actor, `observe-${randomUUID()}`)).rejects.toThrow(/bound|goal|scope/i);
    const routing = { ...candidate, kind: "routing_capability_axis" as const };
    await expect(enableImprovementClass(pool, projectId, "routing_capability_axis", proof, actor, `enable-routing-${randomUUID()}`)).resolves.toMatchObject({ improvementClass: "routing_capability_axis" });
    expect(routing.kind).not.toBe("persona_axis");
  });

  it("automatically rolls back a protected-metric regression without deleting evidence history", async () => {
    await enableImprovementClass(pool, projectId, "persona_axis", proof, actor, `enable-${randomUUID()}`);
    const rollout = await startBoundedRollout(pool, candidate.candidateId, scope, proof, actor, `start-${randomUUID()}`);
    const rolledBack = await observeBoundedRollout(pool, rollout.rolloutId, { goalId, observedAt: "2026-09-14T02:00:00.000Z", metrics: [{ name: "correctness", value: 0.84 }] }, proof, actor, `observe-${randomUUID()}`);
    expect(rolledBack).toMatchObject({ status: "rolled_back", activeCandidateId: candidate.rollbackTarget.candidateId, activeVersion: candidate.rollbackTarget.version, rollbackTarget: candidate.rollbackTarget });
    expect(rolledBack.evidenceIds).toContain(digestId);
    expect(rolledBack.history.some((event) => event.kind === "automatic_rollback")).toBe(true);
    await expect(readBoundedRollout(pool, rollout.rolloutId, { operatorId, proof })).resolves.toMatchObject({ status: "rolled_back", evidenceIds: [digestId] });
  });

  it("reconciles an interrupted rollout to the last certified state using its durable rollback target", async () => {
    await enableImprovementClass(pool, projectId, "persona_axis", proof, actor, `enable-${randomUUID()}`);
    const rollout = await startBoundedRollout(pool, candidate.candidateId, scope, proof, actor, `start-${randomUUID()}`);
    const interrupted = await interruptBoundedRollout(pool, rollout.rolloutId, proof, actor, `interrupt-${randomUUID()}`);
    expect(interrupted).toMatchObject({ status: "interrupted", activeCandidateId: candidate.candidateId, rollbackTarget: candidate.rollbackTarget });
    await expect(reconcileInterruptedRollout(pool, rollout.rolloutId, proof, actor, `reconcile-${randomUUID()}`)).resolves.toMatchObject({ status: "rolled_back", activeCandidateId: candidate.rollbackTarget.candidateId, activeVersion: candidate.rollbackTarget.version, rollbackTarget: candidate.rollbackTarget });
  });
});
