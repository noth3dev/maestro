import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { applyAllMigrations } from "./test-migrations.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuthorizedEffectExecutor, type ActionRequest, type AuthorityRepository } from "../../authority/src/authority.js";
import {
  PostgresAuthorityRepository,
  bootstrapAuthorityRecord,
  confirmPausedGoal,
  confirmStoppedGoal,
  emergencyStopGoal,
  getGoalControl,
  requestPauseGoal,
  requestStopGoal,
  resumeGoal,
  revokeAuthorityRecord,
} from "./authority.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("durable authorized effects with PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const repository = new PostgresAuthorityRepository(pool);
  const request = (): ActionRequest => ({
    commandId: randomUUID(), projectId: randomUUID(), goalId: randomUUID(), actorId: "operator-1",
    action: "project.file.edit", target: "/workspace/file", policyVersion: 1, budgetEffectCents: 0, controlEpoch: "1",
  });

  beforeAll(async () => { await applyAllMigrations(pool); });
  beforeEach(async () => { await pool.query("TRUNCATE authority_decisions, authority_records, goal_controls CASCADE"); });
  afterAll(async () => { await pool.end(); });

  it("records an allowed exact ordinary grant before one callback, then denies after final revocation", async () => {
    const current = request();
    const record = await bootstrapAuthorityRecord(pool, { ...current, recordId: randomUUID(), kind: "grant", commandId: null, expiresAt: new Date("2030-01-01T00:00:00Z") });
    const executor = new AuthorizedEffectExecutor(repository, () => new Date("2029-01-01T00:00:00Z"));
    let calls = 0;
    await expect(executor.execute(current, async () => {
      calls += 1;
      const audit = await pool.query("SELECT outcome, matched_record_id FROM authority_decisions");
      expect(audit.rows).toEqual([{ outcome: "allow", matched_record_id: record.recordId }]);
    })).resolves.toMatchObject({ effect: "allow", recordId: record.recordId });
    expect(calls).toBe(1);
    await expect(pool.query("SELECT outcome, matched_record_id FROM authority_decisions")).resolves.toMatchObject({ rows: [{ outcome: "allow", matched_record_id: record.recordId }] });
    await revokeAuthorityRecord(pool, record.recordId);
    await expect(executor.execute(current, async () => { calls += 1; })).resolves.toMatchObject({ effect: "deny", reason: "revoked_grant" });
    expect(calls).toBe(1);
  });

  it("allows a critical effect only for the exact approved command", async () => {
    const current = { ...request(), action: "git.remote.push", target: "origin/main" };
    await bootstrapAuthorityRecord(pool, { ...current, recordId: randomUUID(), kind: "approval", expiresAt: new Date("2030-01-01T00:00:00Z") });
    const executor = new AuthorizedEffectExecutor(repository, () => new Date("2029-01-01T00:00:00Z"));
    let calls = 0;
    await executor.execute(current, async () => { calls += 1; });
    await expect(executor.execute({ ...current, commandId: randomUUID() }, async () => { calls += 1; })).resolves.toMatchObject({ effect: "require_approval" });
    await expect(pool.query("SELECT count(*) FILTER (WHERE outcome = 'allow')::int AS allowed, count(*) FILTER (WHERE outcome = 'require_approval')::int AS pending FROM authority_decisions")).resolves.toMatchObject({ rows: [{ allowed: 1, pending: 1 }] });
    expect(calls).toBe(1);
  });

  it("fails closed without effects when durable record reads or decision writes fail", async () => {
    const current = request();
    await bootstrapAuthorityRecord(pool, { ...current, recordId: randomUUID(), kind: "grant", commandId: null, expiresAt: new Date("2030-01-01T00:00:00Z") });
    let calls = 0;
    const unreadable: AuthorityRepository = { load: async () => { throw new Error("read failed"); }, appendDecision: repository.appendDecision.bind(repository), recheckControl: repository.recheckControl.bind(repository) };
    await expect(new AuthorizedEffectExecutor(unreadable).execute(current, async () => { calls += 1; })).resolves.toMatchObject({ effect: "deny", reason: "authority_unavailable" });
    const unwritable: AuthorityRepository = { load: repository.load.bind(repository), appendDecision: async () => { throw new Error("write failed"); }, recheckControl: repository.recheckControl.bind(repository) };
    await expect(pool.query("SELECT outcome, reason FROM authority_decisions")).resolves.toMatchObject({ rows: [{ outcome: "deny", reason: "authority_unavailable" }] });
    await expect(new AuthorizedEffectExecutor(unwritable, () => new Date("2029-01-01T00:00:00Z")).execute(current, async () => { calls += 1; })).resolves.toMatchObject({ effect: "deny", reason: "authority_unavailable" });
    expect(calls).toBe(0);
  });

  it("emergency stop latches control, advances its epoch, revokes all Goal authority, and blocks the callback", async () => {
    const current = request();
    const otherActor = { ...current, actorId: "operator-2", commandId: randomUUID() };
    await bootstrapAuthorityRecord(pool, { ...current, kind: "grant", commandId: null, expiresAt: new Date("2030-01-01T00:00:00Z") });
    await bootstrapAuthorityRecord(pool, { ...otherActor, kind: "grant", commandId: null, expiresAt: new Date("2030-01-01T00:00:00Z") });
    await expect(emergencyStopGoal(pool, current.projectId, current.goalId)).resolves.toMatchObject({ controlEpoch: "2", emergencyStoppedAt: expect.any(Date) });
    await expect(getGoalControl(pool, current.projectId, current.goalId)).resolves.toMatchObject({ controlEpoch: "2", emergencyStoppedAt: expect.any(Date) });
    await expect(pool.query("SELECT count(*) FILTER (WHERE revoked_at IS NOT NULL)::int AS revoked FROM authority_records")).resolves.toMatchObject({ rows: [{ revoked: 2 }] });
    let calls = 0;
    await expect(new AuthorizedEffectExecutor(repository, () => new Date("2029-01-01T00:00:00Z")).execute(current, async () => { calls += 1; })).resolves.toMatchObject({ effect: "deny", reason: "emergency_stop" });
    expect(calls).toBe(0);
  });

  it("blocks the callback when the request carries an older control epoch", async () => {
    const current = request();
    await getGoalControl(pool, current.projectId, current.goalId);
    await bootstrapAuthorityRecord(pool, { ...current, kind: "grant", commandId: null, expiresAt: new Date("2030-01-01T00:00:00Z") });
    let calls = 0;
    await expect(new AuthorizedEffectExecutor(repository, () => new Date("2029-01-01T00:00:00Z")).execute({ ...current, controlEpoch: "0" }, async () => { calls += 1; })).resolves.toMatchObject({ effect: "deny", reason: "stale_control_epoch" });
    expect(calls).toBe(0);
  });


  it("requests pause, confirms it, blocks the callback while paused, and cannot be resumed without confirming pause first", async () => {
    const current = request();
    await bootstrapAuthorityRecord(pool, { ...current, kind: "grant", commandId: null, expiresAt: new Date("2030-01-01T00:00:00Z") });
    const executor = new AuthorizedEffectExecutor(repository, () => new Date("2029-01-01T00:00:00Z"));

    await expect(requestPauseGoal(pool, current.projectId, current.goalId)).resolves.toMatchObject({ controlEpoch: "2", pauseRequestedAt: expect.any(Date) });
    let calls = 0;
    await expect(executor.execute(current, async () => { calls += 1; })).resolves.toMatchObject({ effect: "deny", reason: "pause_requested" });
    expect(calls).toBe(0);
    // Requesting pause again while already pause-requested is a no-op: same epoch, no error.
    await expect(requestPauseGoal(pool, current.projectId, current.goalId)).resolves.toMatchObject({ controlEpoch: "2", pauseRequestedAt: expect.any(Date) });

    await expect(resumeGoal(pool, current.projectId, current.goalId)).rejects.toThrow(/paused/);

    await expect(confirmPausedGoal(pool, current.projectId, current.goalId)).resolves.toMatchObject({ controlEpoch: "3", pausedAt: expect.any(Date) });
    await expect(executor.execute({ ...current, controlEpoch: "3" }, async () => { calls += 1; })).resolves.toMatchObject({ effect: "deny", reason: "paused" });
    expect(calls).toBe(0);
  });

  it("resumes only from a fully paused Goal, advances the epoch, and allows a subsequent effect under the new epoch", async () => {
    const current = request();
    const record = await bootstrapAuthorityRecord(pool, { ...current, kind: "grant", commandId: null, expiresAt: new Date("2030-01-01T00:00:00Z") });
    const executor = new AuthorizedEffectExecutor(repository, () => new Date("2029-01-01T00:00:00Z"));

    await requestPauseGoal(pool, current.projectId, current.goalId);
    await confirmPausedGoal(pool, current.projectId, current.goalId);
    const resumed = await resumeGoal(pool, current.projectId, current.goalId);
    expect(resumed.controlEpoch).toBe("4");
    expect(resumed.pauseRequestedAt).toBeUndefined();
    expect(resumed.pausedAt).toBeUndefined();

    let calls = 0;
    await expect(executor.execute({ ...current, controlEpoch: "3" }, async () => { calls += 1; })).resolves.toMatchObject({ effect: "deny", reason: "stale_control_epoch" });
    await expect(executor.execute({ ...current, controlEpoch: "4" }, async () => { calls += 1; })).resolves.toMatchObject({ effect: "allow", recordId: record.recordId });
    expect(calls).toBe(1);
  });

  it("rejects confirming pause before it was requested, and rejects requesting pause again once already paused", async () => {
    const current = request();
    await getGoalControl(pool, current.projectId, current.goalId);
    await expect(confirmPausedGoal(pool, current.projectId, current.goalId)).rejects.toThrow(/pause_requested/);
    await requestPauseGoal(pool, current.projectId, current.goalId);
    await confirmPausedGoal(pool, current.projectId, current.goalId);
    await expect(requestPauseGoal(pool, current.projectId, current.goalId)).rejects.toThrow(/open/);
  });

  it("requests stop from an open or paused Goal, confirms it as a terminal state, revokes authority, and blocks resume", async () => {
    const current = request();
    await bootstrapAuthorityRecord(pool, { ...current, kind: "grant", commandId: null, expiresAt: new Date("2030-01-01T00:00:00Z") });
    const executor = new AuthorizedEffectExecutor(repository, () => new Date("2029-01-01T00:00:00Z"));

    await requestPauseGoal(pool, current.projectId, current.goalId);
    await confirmPausedGoal(pool, current.projectId, current.goalId);
    await expect(requestStopGoal(pool, current.projectId, current.goalId)).resolves.toMatchObject({ controlEpoch: "4", stoppingAt: expect.any(Date) });
    let calls = 0;
    await expect(executor.execute({ ...current, controlEpoch: "4" }, async () => { calls += 1; })).resolves.toMatchObject({ effect: "deny", reason: "stopping" });

    await expect(confirmStoppedGoal(pool, current.projectId, current.goalId)).resolves.toMatchObject({ controlEpoch: "5", stoppedAt: expect.any(Date) });
    await expect(pool.query("SELECT count(*) FILTER (WHERE revoked_at IS NOT NULL)::int AS revoked FROM authority_records")).resolves.toMatchObject({ rows: [{ revoked: 1 }] });
    await expect(executor.execute({ ...current, controlEpoch: "5" }, async () => { calls += 1; })).resolves.toMatchObject({ effect: "deny", reason: "stopped" });
    expect(calls).toBe(0);

    await expect(resumeGoal(pool, current.projectId, current.goalId)).rejects.toThrow(/paused/);
    await expect(requestStopGoal(pool, current.projectId, current.goalId)).rejects.toThrow(/stopped/);
    await expect(confirmStoppedGoal(pool, current.projectId, current.goalId)).rejects.toThrow(/stopping/);
  });

  it("rejects stop confirmation before it was requested and rejects requesting stop again once stopping", async () => {
    const current = request();
    await getGoalControl(pool, current.projectId, current.goalId);
    await expect(confirmStoppedGoal(pool, current.projectId, current.goalId)).rejects.toThrow(/stopping/);
    await requestStopGoal(pool, current.projectId, current.goalId);
    await expect(requestStopGoal(pool, current.projectId, current.goalId)).rejects.toThrow(/stopping/);
  });

  it("cannot resume, pause, or stop an emergency-stopped Goal", async () => {
    const current = request();
    await emergencyStopGoal(pool, current.projectId, current.goalId);
    await expect(resumeGoal(pool, current.projectId, current.goalId)).rejects.toThrow(/paused/);
    await expect(requestPauseGoal(pool, current.projectId, current.goalId)).rejects.toThrow(/open/);
    await expect(requestStopGoal(pool, current.projectId, current.goalId)).rejects.toThrow(/stopped/);
  });

});
