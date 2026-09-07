import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  acquireGoalLease,
  enrollDevice,
  setLocalDevicePolicy,
  createDeviceGrant,
  reserveGoalBudget,
  recordImprovementDigest,
} from "@maestro/persistence";
import { grantProjectMembership } from "@maestro/persistence/testing";
import { applyAllMigrations } from "../../../packages/persistence/src/test-migrations.js";
import { createReadStateService } from "./read-state-service.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("Phase 5 readiness: concurrent Goals in one project stay isolated", () => {
  const schema = `concurrent_goals_${randomUUID().replaceAll("-", "")}`;
  const basePool = new Pool({ connectionString: databaseUrl });
  const scopedUrl = databaseUrl ? (() => { const url = new URL(databaseUrl); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })() : "";
  let pool: Pool;

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: scopedUrl });
    await applyAllMigrations(pool);
  });
  afterAll(async () => {
    await pool.end();
    await basePool.query(`DROP SCHEMA ${schema} CASCADE`);
    await basePool.end();
  });

  const operatorId = randomUUID();
  let projectId: string;
  let goalA: string;
  let goalB: string;

  beforeEach(async () => {
    projectId = randomUUID();
    goalA = randomUUID();
    goalB = randomUUID();
    await pool.query("INSERT INTO local_operators (operator_id) VALUES ($1) ON CONFLICT (operator_id) DO NOTHING", [operatorId]);
    await grantProjectMembership(pool, operatorId, projectId);
    for (const goalId of [goalA, goalB]) {
      await pool.query(
        "INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())",
        [goalId, projectId],
      );
    }
  });

  it("keeps budget envelopes exactly per Goal (roadmap/act-1-foundation/phase-05-concurrent-goals-portfolio.md Test #2: cross-Goal budget access denial)", async () => {
    const proofA = await acquireGoalLease(pool, { goalId: goalA, ownerId: "isolation-test", leaseDurationMs: 60_000 });
    const proofB = await acquireGoalLease(pool, { goalId: goalB, ownerId: "isolation-test", leaseDurationMs: 60_000 });
    await reserveGoalBudget(pool, goalA, 10_000, "Goal A envelope", proofA, { actorId: "ceo", sessionRef: "session:ceo:a" });
    await reserveGoalBudget(pool, goalB, 25_000, "Goal B envelope", proofB, { actorId: "ceo", sessionRef: "session:ceo:b" });

    const readState = createReadStateService(pool);
    const summaryA = await readState.getBudgetSummary(goalA, projectId);
    const summaryB = await readState.getBudgetSummary(goalB, projectId);

    expect(summaryA.budgetCents).toBe(10_000);
    expect(summaryB.budgetCents).toBe(25_000);
    expect(summaryA.budgetCents).not.toBe(summaryB.budgetCents);
  });

  it("keeps device grants exactly per Goal even for the same enrolled device (roadmap/act-1-foundation/phase-05-concurrent-goals-portfolio.md Test #6: no overlapping device grants)", async () => {
    const device = await enrollDevice(pool, { displayName: "shared laptop", deviceType: "computer", publicKey: `key-${randomUUID()}` }, { actorId: "ceo", sessionRef: "session:ceo:enroll", role: "ceo" });
    await setLocalDevicePolicy(pool, device.deviceId, { rules: [{ action: "project.file.read", targets: ["/tmp/project"] }], expiresAt: null }, { actorId: "ceo", sessionRef: "session:ceo:policy", role: "ceo" });
    const proofA = await acquireGoalLease(pool, { goalId: goalA, ownerId: "isolation-test", leaseDurationMs: 60_000 });
    const proofB = await acquireGoalLease(pool, { goalId: goalB, ownerId: "isolation-test", leaseDurationMs: 60_000 });
    const scope = { actionTypes: ["project.file.read"], projectPaths: ["/tmp/project"], applications: ["filesystem"], dataScope: ["/tmp/project"], networkScope: ["none"] };
    const grantA = await createDeviceGrant(pool, goalA, device.deviceId, scope, new Date(Date.now() + 60_000).toISOString(), proofA, { actorId: "ceo", sessionRef: "session:ceo:grant-a" });
    const grantB = await createDeviceGrant(pool, goalB, device.deviceId, scope, new Date(Date.now() + 60_000).toISOString(), proofB, { actorId: "ceo", sessionRef: "session:ceo:grant-b" });

    expect(grantA.grant.grantId).not.toBe(grantB.grant.grantId);
    expect(grantA.grant.goalId).toBe(goalA);
    expect(grantB.grant.goalId).toBe(goalB);
    expect(grantA.capabilityToken).not.toBe(grantB.capabilityToken);
  });

  it("keeps improvement digests exactly per Goal and rejects a reader without project membership (roadmap/act-1-foundation/phase-05-concurrent-goals-portfolio.md Test #2: cross-Goal evidence access denial)", async () => {
    const proofA = await acquireGoalLease(pool, { goalId: goalA, ownerId: "isolation-test", leaseDurationMs: 60_000 });
    const proofB = await acquireGoalLease(pool, { goalId: goalB, ownerId: "isolation-test", leaseDurationMs: 60_000 });
    const digestInput = (goalId: string) => ({
      schemaVersion: 1 as const, projectId, goalId, episodeId: "episode-1", trigger: "goal_completed" as const,
      situation: "The bounded task completed.", selectedDecision: "Keep the validation gate.", rejectedAlternatives: [],
      observedResult: "Certified.", metrics: [], confidence: 0.8, sourceRefs: [{ kind: "goal" as const, sourceId: goalId }],
    });
    await recordImprovementDigest(pool, digestInput(goalA), proofA, { actorId: "encore-curator", sessionRef: "session:encore:a" });
    await recordImprovementDigest(pool, digestInput(goalB), proofB, { actorId: "encore-curator", sessionRef: "session:encore:b" });

    const readState = createReadStateService(pool);
    const digestsA = await readState.listImprovementDigestsForGoal(goalA, projectId, operatorId);
    const digestsB = await readState.listImprovementDigestsForGoal(goalB, projectId, operatorId);

    expect(digestsA).toHaveLength(1);
    expect(digestsB).toHaveLength(1);
    expect(digestsA[0]!.goalId).toBe(goalA);
    expect(digestsB[0]!.goalId).toBe(goalB);
    expect(digestsA[0]!.digestId).not.toBe(digestsB[0]!.digestId);

    const outsiderOperator = randomUUID();
    await pool.query("INSERT INTO local_operators (operator_id) VALUES ($1)", [outsiderOperator]);
    await expect(readState.listImprovementDigestsForGoal(goalA, projectId, outsiderOperator)).rejects.toThrow("no active membership");
  });

  it("rejects a read for a Goal that does not belong to the stated project (project-boundary half of cross-Goal isolation)", async () => {
    const readState = createReadStateService(pool);
    const otherProjectId = randomUUID();
    await expect(readState.getBudgetSummary(goalA, otherProjectId)).rejects.toThrow();
    await expect(readState.listWorkersForGoal(goalA, otherProjectId)).rejects.toThrow();
    await expect(readState.getGitIntegrationState(goalA, otherProjectId)).rejects.toThrow();
  });
});
