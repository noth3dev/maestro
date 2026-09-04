import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { applyAllMigrations } from "./test-migrations.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CommandIdReuseError,
  LeaseUnavailableError,
  acquireGoalLease,
  executeGoalCommand,
  renewGoalLease,
} from "./commands.js";
import { listGoalEvents } from "./events.js";
import { createDurableTaskContract, launchConfirmedTaskContract, recordExactTaskContractConfirmation } from "./task-contract.js";
import type { TaskContractSubstance } from "@maestro/domain";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("Goal lease fencing with PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  async function lease(goalId: string, ownerId: string, leaseDurationMs = 60_000) {
    return acquireGoalLease(pool, { goalId, ownerId, leaseDurationMs });
  }

  async function counts() {
    const result = await pool.query(`SELECT
      (SELECT count(*)::int FROM command_receipts) receipts,
      (SELECT count(*)::int FROM goal_events) events,
      (SELECT count(*)::int FROM goals) goals,
      (SELECT count(*)::int FROM outbox) outbox`);
    return result.rows[0];
  }

  beforeAll(async () => { await applyAllMigrations(pool); });

  beforeEach(async () => {
    await pool.query("TRUNCATE goal_leases, outbox, goal_events, goals, command_receipts, task_contract_confirmations, task_contract_decisions, task_contracts RESTART IDENTITY CASCADE");
  });

  afterAll(async () => { await pool.end(); });

  it("replays project-scoped events strictly after an exact global cursor", async () => {
    const projectId = randomUUID();
    const otherProjectId = randomUUID();
    const firstGoal = randomUUID();
    const secondGoal = randomUUID();
    for (const [goalId, id, project] of [[firstGoal, randomUUID(), projectId], [secondGoal, randomUUID(), projectId], [randomUUID(), randomUUID(), otherProjectId]] as const) {
      const proof = await lease(goalId, "reader");
      await executeGoalCommand(pool, { commandId: id, projectId: project, goalId, actorId: "reader", type: "CreateGoal", expectedVersion: 0 }, proof);
    }
    await pool.query("SELECT setval(pg_get_serial_sequence('goal_events', 'global_position'), 9007199254740992, true)");
    const proof = await lease(randomUUID(), "reader");
    const largeGoal = proof.goalId;
    await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId: largeGoal, actorId: "reader", type: "CreateGoal", expectedVersion: 0 }, proof);
    const all = await listGoalEvents(pool, { projectId, after: "0" });
    expect(all).toHaveLength(3);
    expect(all.map((event) => event.cursor)).toEqual([...all.map((event) => event.cursor)].sort((a, b) => a.length - b.length || a.localeCompare(b)));
    expect(all.at(-1)?.cursor).toBe("9007199254740993");
    expect((await listGoalEvents(pool, { projectId, after: all[0]!.cursor })).map((event) => event.cursor)).toEqual(all.slice(1).map((event) => event.cursor));
    expect(all.every((event) => event.projectId === projectId)).toBe(true);
  });

  it("acquires an exact bigint fencing token", async () => {
    const goalId = randomUUID();
    await expect(lease(goalId, "concertmaster")).resolves.toEqual({ goalId, ownerId: "concertmaster", fencingToken: "1" });
  });

  it("allows only one concurrent acquisition before expiry", async () => {
    const goalId = randomUUID();
    const attempts = await Promise.allSettled([lease(goalId, "concertmaster"), lease(goalId, "other")]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === "rejected");
    expect(rejected).toMatchObject({ reason: expect.any(LeaseUnavailableError) });
  });

  it("gives an expired lease successor a higher exact bigint token", async () => {
    const goalId = randomUUID();
    const first = await lease(goalId, "concertmaster");
    await pool.query("UPDATE goal_leases SET fencing_token = 9007199254740992, expires_at = transaction_timestamp() - interval '1 millisecond' WHERE goal_id = $1", [goalId]);
    await expect(lease(goalId, "other")).resolves.toEqual({
      goalId, ownerId: "other", fencingToken: "9007199254740993",
    });
    expect(first.fencingToken).toBe("1");
  });

  it("renews only a current matching proof and retains its token", async () => {
    const proof = await lease(randomUUID(), "concertmaster", 1_000);
    await expect(renewGoalLease(pool, proof, 60_000)).resolves.toEqual(proof);
  });

  it("rejects expired or forged renewal proofs", async () => {
    const proof = await lease(randomUUID(), "concertmaster");
    await expect(renewGoalLease(pool, { ...proof, fencingToken: "999" }, 60_000))
      .rejects.toMatchObject({ code: "stale_lease" });
    await pool.query("UPDATE goal_leases SET expires_at = transaction_timestamp() - interval '1 millisecond' WHERE goal_id = $1", [proof.goalId]);
    await expect(renewGoalLease(pool, proof, 60_000)).rejects.toMatchObject({ code: "stale_lease" });
  });

  it("validates the lease proof before receipt lookup and preserves idempotency for a current proof", async () => {
    const command = {
      commandId: randomUUID(), projectId: randomUUID(), goalId: randomUUID(),
      actorId: "concertmaster", type: "CreateGoal", expectedVersion: 0,
    } as const;
    const proof = await lease(command.goalId, command.actorId);
    const first = await executeGoalCommand(pool, command, proof);
    await expect(executeGoalCommand(pool, command, proof)).resolves.toEqual(first);
    await expect(executeGoalCommand(pool, { ...command, projectId: randomUUID() }, proof)).rejects.toBeInstanceOf(CommandIdReuseError);

    await pool.query("UPDATE goal_leases SET expires_at = transaction_timestamp() - interval '1 millisecond' WHERE goal_id = $1", [command.goalId]);
    await expect(executeGoalCommand(pool, command, proof)).rejects.toMatchObject({ code: "stale_lease" });
  });

  it("rolls back a pre-commit injected failure and retries CreateGoal exactly once", async () => {
    const command = {
      commandId: randomUUID(), projectId: randomUUID(), goalId: randomUUID(),
      actorId: "concertmaster", type: "CreateGoal", expectedVersion: 0,
    } as const;
    const proof = await lease(command.goalId, command.actorId);
    const injectedFailure = new Error("test pre-commit failure");

    await expect(executeGoalCommand(pool, command, proof, {
      beforeCommit: () => { throw injectedFailure; },
    })).rejects.toBe(injectedFailure);
    expect(await counts()).toEqual({ receipts: 0, events: 0, goals: 0, outbox: 0 });

    const first = await executeGoalCommand(pool, command, proof);
    expect(first).toMatchObject({ outcome: "succeeded", goalId: command.goalId, version: 1, state: "draft" });
    await expect(executeGoalCommand(pool, command, proof)).resolves.toEqual(first);
    expect(await counts()).toEqual({ receipts: 1, events: 1, goals: 1, outbox: 1 });
  });

  it("atomically creates receipt, event, projection, and outbox with a current proof", async () => {
    const command = {
      commandId: randomUUID(), projectId: randomUUID(), goalId: randomUUID(),
      actorId: "concertmaster", type: "CreateGoal", expectedVersion: 0,
    } as const;
    const proof = await lease(command.goalId, command.actorId);

    await expect(executeGoalCommand(pool, command, proof)).resolves.toMatchObject({
      outcome: "succeeded", goalId: command.goalId, version: 1, state: "draft",
    });
    expect(await counts()).toEqual({ receipts: 1, events: 1, goals: 1, outbox: 1 });
  });

  it("allows an operator-audited command under a current control-plane lease", async () => {
    const command = {
      commandId: randomUUID(), projectId: randomUUID(), goalId: randomUUID(),
      actorId: "operator-B", type: "CreateGoal", expectedVersion: 0,
    } as const;
    const proof = await lease(command.goalId, "instance-A");

    await expect(executeGoalCommand(pool, command, proof)).resolves.toMatchObject({
      outcome: "succeeded", goalId: command.goalId, state: "draft",
    });
    expect(await counts()).toEqual({ receipts: 1, events: 1, goals: 1, outbox: 1 });
  });

  it("rejects a wrong Goal, token, or expired proof before command mutation", async () => {
    const command = {
      commandId: randomUUID(), projectId: randomUUID(), goalId: randomUUID(),
      actorId: "operator-B", type: "CreateGoal", expectedVersion: 0,
    } as const;
    const proof = await lease(command.goalId, "instance-A");
    const before = await counts();

    await expect(executeGoalCommand(pool, command, { ...proof, goalId: randomUUID() }))
      .rejects.toMatchObject({ code: "stale_lease" });
    await expect(executeGoalCommand(pool, command, { ...proof, fencingToken: "999" }))
      .rejects.toMatchObject({ code: "stale_lease" });
    await pool.query(
      "UPDATE goal_leases SET expires_at = transaction_timestamp() - interval '1 millisecond' WHERE goal_id = $1",
      [proof.goalId],
    );
    await expect(executeGoalCommand(pool, command, proof)).rejects.toMatchObject({ code: "stale_lease" });
    expect(await counts()).toEqual(before);
  });

  it("creates a Goal only from a launched project-matching Task Contract", async () => {
    const projectId = randomUUID();
    const contractId = randomUUID();
    const contractSubstance: TaskContractSubstance = {
      desiredOutcome: "Ship", userVisibleBehavior: ["Works"], successCriteria: ["Passes"], liveEvidence: ["Live"], scope: ["Feature"], nonGoals: ["Other"], priorities: ["Safety"], acceptableTradeoffs: ["Time"], constraints: ["Local"], knownEdgeCases: ["Retry"],
      project: { projectId, repository: "/repo", immutableBaseRevision: "abc", dataBoundary: "repo" }, evidenceReferences: ["spec"], approvedPreviewReferences: [], expectedGroups: ["Product"], expectedDepartments: ["Product"], criticalActionExpectations: ["Approval"], forbiddenEffects: ["Deploy"], environmentAssumptions: ["DB"], externalServiceAssumptions: ["None"], budget: { ceiling: "10", reportingExpectations: ["Report"], stoppingConditions: ["Stop"] },
    };
    const contract = await createDurableTaskContract(pool, contractId, contractSubstance);
    const goalId = randomUUID();
    const proof = await lease(goalId, "concertmaster");
    const command = { commandId: randomUUID(), projectId, goalId, actorId: "concertmaster", type: "CreateGoal" as const, expectedVersion: 0, contractId };
    await expect(executeGoalCommand(pool, command, proof)).resolves.toMatchObject({ outcome: "rejected", code: "task_contract_not_launched" });
    expect((await pool.query("SELECT count(*)::int AS count FROM goals WHERE goal_id = $1", [goalId])).rows[0]!.count).toBe(0);

    await recordExactTaskContractConfirmation(pool, contract.contractId, contract.version, contract.contentHash, "ceo");
    await launchConfirmedTaskContract(pool, contract.contractId);
    const created = await executeGoalCommand(pool, { ...command, commandId: randomUUID() }, proof);
    expect(created).toMatchObject({ outcome: "succeeded", goalId, state: "draft" });
    expect((await pool.query("SELECT task_contract_id FROM goals WHERE goal_id = $1", [goalId])).rows[0]!.task_contract_id).toBe(contractId);

    const mismatchGoalId = randomUUID();
    const mismatchProof = await lease(mismatchGoalId, "concertmaster");
    await expect(executeGoalCommand(pool, { ...command, commandId: randomUUID(), goalId: mismatchGoalId, projectId: randomUUID() }, mismatchProof)).resolves.toMatchObject({ outcome: "rejected", code: "task_contract_project_mismatch" });
  });

  it("allows only one command at an expected Goal version", async () => {
    const projectId = randomUUID();
    const goalId = randomUUID();
    const proof = await lease(goalId, "concertmaster");
    await executeGoalCommand(pool, {
      commandId: randomUUID(), projectId, goalId, actorId: "concertmaster", type: "CreateGoal", expectedVersion: 0,
    }, proof);
    const base = { projectId, goalId, actorId: "concertmaster", type: "TransitionGoal", expectedVersion: 1 } as const;
    const [a, b] = await Promise.all([
      executeGoalCommand(pool, { ...base, commandId: randomUUID(), to: "ready_for_confirmation" }, proof),
      executeGoalCommand(pool, { ...base, commandId: randomUUID(), to: "recovering" }, proof),
    ]);
    expect([a.outcome, b.outcome].sort()).toEqual(["succeeded", "version_conflict"]);
    expect(await counts()).toEqual({ receipts: 3, events: 2, goals: 1, outbox: 2 });
  });

  it("denies an old token from the same owner without changing persistent command state", async () => {
    const command = {
      commandId: randomUUID(), projectId: randomUUID(), goalId: randomUUID(),
      actorId: "concertmaster", type: "CreateGoal", expectedVersion: 0,
    } as const;
    const oldProof = await lease(command.goalId, command.actorId);
    await pool.query("UPDATE goal_leases SET expires_at = transaction_timestamp() - interval '1 millisecond' WHERE goal_id = $1", [command.goalId]);
    const currentProof = await lease(command.goalId, command.actorId);
    expect(currentProof.fencingToken).toBe("2");

    const before = await counts();
    await expect(executeGoalCommand(pool, command, oldProof)).rejects.toMatchObject({ code: "stale_lease" });
    expect(await counts()).toEqual(before);
    await expect(executeGoalCommand(pool, command, currentProof)).resolves.toMatchObject({ outcome: "succeeded" });
  });

  it("rejects a forged proof without changing receipt, event, projection, or outbox", async () => {
    const command = {
      commandId: randomUUID(), projectId: randomUUID(), goalId: randomUUID(),
      actorId: "concertmaster", type: "CreateGoal", expectedVersion: 0,
    } as const;
    const proof = await lease(command.goalId, command.actorId);
    const before = await counts();
    await expect(executeGoalCommand(pool, command, { ...proof, fencingToken: "999" }))
      .rejects.toMatchObject({ code: "stale_lease" });
    expect(await counts()).toEqual(before);
  });


  it("couples generic lifecycle transitions to durable Goal control latches and makes emergency stop terminal", async () => {
    const projectId = randomUUID();
    const goalId = randomUUID();
    const proof = await lease(goalId, "control-plane");
    const command = async (to: import("@maestro/domain").GoalState, expectedVersion: number) =>
      executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "operator", type: "TransitionGoal", expectedVersion, to }, proof);

    await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "operator", type: "CreateGoal", expectedVersion: 0 }, proof);
    await command("ready_for_confirmation", 1);
    await command("launched", 2);
    await command("active", 3);

    const pauseCommand = { commandId: randomUUID(), projectId, goalId, actorId: "operator", type: "TransitionGoal" as const, expectedVersion: 4, to: "pausing" as const };
    const pausedRequest = await executeGoalCommand(pool, pauseCommand, proof);
    await expect(executeGoalCommand(pool, pauseCommand, proof)).resolves.toEqual(pausedRequest);
    expect(pausedRequest).toMatchObject({ state: "pausing", version: 5 });
    await expect(pool.query<{ control_epoch: string; pause_requested_at: Date | null; paused_at: Date | null }>(
      "SELECT control_epoch, pause_requested_at, paused_at FROM goal_controls WHERE project_id = $1 AND goal_id = $2", [projectId, goalId],
    )).resolves.toMatchObject({ rows: [{ control_epoch: "2", pause_requested_at: expect.any(Date), paused_at: null }] });
    await expect(command("paused", 5)).resolves.toMatchObject({ state: "paused", version: 6 });
    await expect(command("resuming", 6)).resolves.toMatchObject({ state: "resuming", version: 7 });
    await expect(pool.query<{ control_epoch: string; pause_requested_at: Date | null; paused_at: Date | null }>(
      "SELECT control_epoch, pause_requested_at, paused_at FROM goal_controls WHERE project_id = $1 AND goal_id = $2", [projectId, goalId],
    )).resolves.toMatchObject({ rows: [{ control_epoch: "4", pause_requested_at: null, paused_at: null }] });
    await expect(command("active", 7)).resolves.toMatchObject({ state: "active", version: 8 });
    await expect(command("stopping", 8)).resolves.toMatchObject({ state: "stopping", version: 9 });
    await expect(command("stopped", 9)).resolves.toMatchObject({ state: "stopped", version: 10 });
    await expect(pool.query<{ stopping_at: Date | null; stopped_at: Date | null }>(
      "SELECT stopping_at, stopped_at FROM goal_controls WHERE project_id = $1 AND goal_id = $2", [projectId, goalId],
    )).resolves.toMatchObject({ rows: [{ stopping_at: expect.any(Date), stopped_at: expect.any(Date) }] });

    const emergencyGoalId = randomUUID();
    const emergencyProof = await lease(emergencyGoalId, "control-plane");
    const emergencyCommand = { commandId: randomUUID(), projectId, goalId: emergencyGoalId, actorId: "operator", type: "EmergencyStopGoal" as const, expectedVersion: 1 };
    await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId: emergencyGoalId, actorId: "operator", type: "CreateGoal", expectedVersion: 0 }, emergencyProof);
    const emergency = await executeGoalCommand(pool, emergencyCommand, emergencyProof);
    await expect(executeGoalCommand(pool, emergencyCommand, emergencyProof)).resolves.toEqual(emergency);
    expect(emergency).toMatchObject({ outcome: "succeeded", state: "stopped", version: 2 });
    await expect(pool.query<{ state: string; control_epoch: string; emergency_stopped_at: Date | null; stopped_at: Date | null }>(
      "SELECT g.state, c.control_epoch, c.emergency_stopped_at, c.stopped_at FROM goals g JOIN goal_controls c USING (project_id, goal_id) WHERE g.project_id = $1 AND g.goal_id = $2", [projectId, emergencyGoalId],
    )).resolves.toMatchObject({ rows: [{ state: "stopped", control_epoch: "2", emergency_stopped_at: expect.any(Date), stopped_at: expect.any(Date) }] });
  });

});
