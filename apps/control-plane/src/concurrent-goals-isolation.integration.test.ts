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
  listIpPythonSessionJournalForGoal,
  recordIpPythonSessionStarted,
  createCapabilityApproval,
  consumeCapabilityApproval,
  getCapabilitySession,
  setCapabilitySession,
  recordOperationalOverlay,
  readGoalOperationalOverlaySnapshot,
  snapshotOperationalOverlayForGoalDurably,
  listDeviceGrantsForGoal,
} from "@maestro/persistence";
import type { OperationalOverlay } from "@maestro/domain";
import { grantProjectMembership } from "@maestro/persistence/testing";
import { applyAllMigrations } from "../../../packages/persistence/src/test-migrations.js";
import { createReadStateService } from "./read-state-service.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("Phase 5 readiness: concurrent Goals in one project stay isolated", () => {
  const schema = `concurrent_goals_${randomUUID().replaceAll("-", "")}`;
  const basePool = new Pool({ connectionString: databaseUrl });
  const scopedUrl = databaseUrl
    ? (() => {
        const url = new URL(databaseUrl);
        url.searchParams.set("options", `-c search_path=${schema}`);
        return url.toString();
      })()
    : "";
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
  let otherProjectId: string;
  let goalA: string;
  let goalB: string;
  let goalC: string;

  beforeEach(async () => {
    projectId = randomUUID();
    otherProjectId = randomUUID();
    goalA = randomUUID();
    goalB = randomUUID();
    goalC = randomUUID();
    await pool.query("INSERT INTO local_operators (operator_id) VALUES ($1) ON CONFLICT (operator_id) DO NOTHING", [operatorId]);
    await grantProjectMembership(pool, operatorId, projectId);
    await grantProjectMembership(pool, operatorId, otherProjectId);
    for (const [goalId, goalProjectId] of [
      [goalA, projectId],
      [goalB, projectId],
      [goalC, otherProjectId],
    ] as const) {
      await pool.query(
        "INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())",
        [goalId, goalProjectId],
      );
    }
  });

  it("keeps Goal discovery and persistent IPython sessions isolated within and across projects", async () => {
    const readState = createReadStateService(pool);
    const projectGoals = await readState.listGoals(projectId);
    const otherProjectGoals = await readState.listGoals(otherProjectId);
    expect(projectGoals.map((goal) => goal.goalId).sort()).toEqual([goalA, goalB].sort());
    expect(otherProjectGoals.map((goal) => goal.goalId)).toEqual([goalC]);

    await recordIpPythonSessionStarted(pool, {
      sessionId: `session:${goalA}`,
      processRef: `process:${goalA}`,
      projectId,
      goalId: goalA,
      actorId: operatorId,
      processPid: 2001,
      parentPid: 2000,
      details: { owner: goalA },
    });
    await recordIpPythonSessionStarted(pool, {
      sessionId: `session:${goalB}`,
      processRef: `process:${goalB}`,
      projectId,
      goalId: goalB,
      actorId: operatorId,
      processPid: 2002,
      parentPid: 2000,
      details: { owner: goalB },
    });
    await recordIpPythonSessionStarted(pool, {
      sessionId: `session:${goalC}`,
      processRef: `process:${goalC}`,
      projectId: otherProjectId,
      goalId: goalC,
      actorId: operatorId,
      processPid: 2003,
      parentPid: 2000,
      details: { owner: goalC },
    });

    await expect(listIpPythonSessionJournalForGoal(pool, projectId, goalA)).resolves.toEqual([
      expect.objectContaining({ goalId: goalA, projectId, processRef: `process:${goalA}` }),
    ]);
    await expect(listIpPythonSessionJournalForGoal(pool, projectId, goalB)).resolves.toEqual([
      expect.objectContaining({ goalId: goalB, projectId, processRef: `process:${goalB}` }),
    ]);
    await expect(listIpPythonSessionJournalForGoal(pool, otherProjectId, goalC)).resolves.toEqual([
      expect.objectContaining({ goalId: goalC, projectId: otherProjectId, processRef: `process:${goalC}` }),
    ]);
    await expect(listIpPythonSessionJournalForGoal(pool, otherProjectId, goalA)).resolves.toEqual([]);
  });

  it("keeps approval ledgers, full-access sessions, and routing snapshots Goal-scoped", async () => {
    const sessionId = randomUUID();
    await setCapabilitySession(pool, {
      sessionId,
      capabilityKind: "ipython",
      projectId,
      goalId: goalA,
      fullAccessMode: "skip_intermediate_approvals",
      selectedBy: operatorId,
    });
    expect(await getCapabilitySession(pool, "ipython", projectId, goalA)).toMatchObject({
      goalId: goalA,
      fullAccessMode: "skip_intermediate_approvals",
    });
    expect(await getCapabilitySession(pool, "ipython", projectId, goalB)).toBeUndefined();
    expect(await getCapabilitySession(pool, "ipython", otherProjectId, goalC)).toBeUndefined();

    const approvalId = randomUUID();
    const commandId = randomUUID();
    await createCapabilityApproval(pool, {
      approvalId,
      capabilityKind: "ipython",
      projectId,
      goalId: goalA,
      commandId,
      action: "project.file.edit",
      target: "/workspace/a.txt",
      policyVersion: 1,
      controlEpoch: "1",
      budgetEffectCents: 10,
      tier: "Department Head",
      approverId: "head-1",
      decision: "approved",
      reason: "The action is required for the approved Goal outcome.",
      consequence: "The bounded effect stays within the recorded Goal scope.",
      expiresAt: new Date("2030-01-01T00:00:00Z"),
      repetitionScope: { kind: "bounded_count", count: 1 },
    });
    await expect(
      consumeCapabilityApproval(pool, {
        approvalId,
        capabilityKind: "ipython",
        projectId,
        goalId: goalB,
        commandId: randomUUID(),
        action: "project.file.edit",
        target: "/workspace/a.txt",
        policyVersion: 1,
        controlEpoch: "1",
        budgetEffectCents: 10,
      }),
    ).rejects.toThrow("Goal-scoped");

    const overlay: OperationalOverlay = {
      schemaVersion: 1,
      installationRef: `installation-${randomUUID()}`,
      projectRef: projectId,
      version: 1,
      observations: [
        {
          candidateRef: "candidate-1",
          measuredLatencyMs: 10,
          measuredCost: 0.01,
          failureRate: 0,
          timeoutRate: 0,
          providerErrorRate: 0,
          currentAvailability: true,
          accountBinding: "account-1",
          observedAt: "2026-09-10T00:00:00Z",
        },
      ],
    };
    await recordOperationalOverlay(pool, overlay);
    const snapshotA = await snapshotOperationalOverlayForGoalDurably(pool, overlay, goalA);
    const snapshotB = await snapshotOperationalOverlayForGoalDurably(pool, overlay, goalB);
    expect(snapshotA).toMatchObject({ goalRef: goalA, overlayVersion: 1 });
    expect(snapshotB).toMatchObject({ goalRef: goalB, overlayVersion: 1 });
    expect(snapshotA).not.toEqual(snapshotB);
    expect(await readGoalOperationalOverlaySnapshot(pool, goalA)).toEqual(snapshotA);
    expect(await readGoalOperationalOverlaySnapshot(pool, goalB)).toEqual(snapshotB);
    await expect(readGoalOperationalOverlaySnapshot(pool, goalC)).resolves.toBeNull();
  });

  it("keeps certification and Git records bound to the producing Goal", async () => {
    // Certification writes require the full worker/acceptance/revision lineage;
    // the authoritative certification integration suite proves that lineage and
    // Goal identity. This read-state gate proves a different Goal cannot see it
    // through a mismatched project binding, even when its own result is empty.
    const readState = createReadStateService(pool);
    expect(await readState.listCertifications(goalA, projectId)).toEqual([]);
    expect(await readState.listCertifications(goalB, projectId)).toEqual([]);
    await expect(readState.listCertifications(goalA, otherProjectId)).rejects.toThrow();

    await pool.query(
      "INSERT INTO goal_integration_branches (goal_id, repository_path, branch_name, base_revision) VALUES ($1, $2, $3, $4), ($5, $2, $6, $4)",
      [goalA, "/workspace/project", `goal/${goalA}`, "a".repeat(40), goalB, `goal/${goalB}`],
    );
    await expect(readState.getGitIntegrationState(goalA, projectId)).resolves.toMatchObject({
      goalId: goalA,
      branch: { branchName: `goal/${goalA}` },
    });
    await expect(readState.getGitIntegrationState(goalB, projectId)).resolves.toMatchObject({
      goalId: goalB,
      branch: { branchName: `goal/${goalB}` },
    });
    await expect(readState.getGitIntegrationState(goalA, otherProjectId)).rejects.toThrow();
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
    const device = await enrollDevice(
      pool,
      { displayName: "shared laptop", deviceType: "computer", publicKey: `key-${randomUUID()}` },
      { actorId: "ceo", sessionRef: "session:ceo:enroll", role: "ceo" },
    );
    await setLocalDevicePolicy(
      pool,
      device.deviceId,
      { rules: [{ action: "project.file.read", targets: ["/tmp/project"] }], expiresAt: null },
      { actorId: "ceo", sessionRef: "session:ceo:policy", role: "ceo" },
    );
    const proofA = await acquireGoalLease(pool, { goalId: goalA, ownerId: "isolation-test", leaseDurationMs: 60_000 });
    const proofB = await acquireGoalLease(pool, { goalId: goalB, ownerId: "isolation-test", leaseDurationMs: 60_000 });
    const scope = {
      actionTypes: ["project.file.read"],
      projectPaths: ["/tmp/project"],
      applications: ["filesystem"],
      dataScope: ["/tmp/project"],
      networkScope: ["none"],
    };
    const grantA = await createDeviceGrant(pool, goalA, device.deviceId, scope, new Date(Date.now() + 60_000).toISOString(), proofA, {
      actorId: "ceo",
      sessionRef: "session:ceo:grant-a",
    });
    const grantB = await createDeviceGrant(pool, goalB, device.deviceId, scope, new Date(Date.now() + 60_000).toISOString(), proofB, {
      actorId: "ceo",
      sessionRef: "session:ceo:grant-b",
    });

    expect(grantA.grant.grantId).not.toBe(grantB.grant.grantId);
    expect(grantA.grant.goalId).toBe(goalA);
    expect(grantB.grant.goalId).toBe(goalB);
    expect(grantA.capabilityToken).not.toBe(grantB.capabilityToken);
    expect((await listDeviceGrantsForGoal(pool, goalA)).map((grant) => grant.grantId)).toContain(grantA.grant.grantId);
    expect((await listDeviceGrantsForGoal(pool, goalB)).map((grant) => grant.grantId)).toContain(grantB.grant.grantId);
    expect((await listDeviceGrantsForGoal(pool, goalA)).map((grant) => grant.grantId)).not.toContain(grantB.grant.grantId);
  });

  it("keeps improvement digests exactly per Goal and rejects a reader without project membership (roadmap/act-1-foundation/phase-05-concurrent-goals-portfolio.md Test #2: cross-Goal evidence access denial)", async () => {
    const proofA = await acquireGoalLease(pool, { goalId: goalA, ownerId: "isolation-test", leaseDurationMs: 60_000 });
    const proofB = await acquireGoalLease(pool, { goalId: goalB, ownerId: "isolation-test", leaseDurationMs: 60_000 });
    const digestInput = (goalId: string) => ({
      schemaVersion: 1 as const,
      projectId,
      goalId,
      episodeId: "episode-1",
      trigger: "goal_completed" as const,
      situation: "The bounded task completed.",
      selectedDecision: "Keep the validation gate.",
      rejectedAlternatives: [],
      observedResult: "Certified.",
      metrics: [],
      confidence: 0.8,
      sourceRefs: [{ kind: "goal" as const, sourceId: goalId }],
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
