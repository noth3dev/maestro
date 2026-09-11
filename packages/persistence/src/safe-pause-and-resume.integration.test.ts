import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyAllMigrations } from "./test-migrations.js";
import {
  acquireGoalLease,
  executeGoalCommand,
  CommandIdReuseError,
} from "./commands.js";
import {
  createCapabilityApproval,
  consumeCapabilityApproval,
  listPendingCapabilityEffects,
  resolveCapabilityEffect,
  type CapabilityApprovalInput,
} from "./capability-approval.js";
import { AuthorizedEffectExecutor } from "../../authority/src/authority.js";
import { PostgresAuthorityRepository, bootstrapAuthorityRecord, getGoalControl } from "./authority.js";
import { setCapabilitySession } from "./capability-approval.js";
import { listIpPythonSessionJournal, recordIpPythonSessionStarted } from "./ipython-session-journal.js";
import { recordOperationalOverlay, readGoalOperationalOverlaySnapshot, snapshotOperationalOverlayForGoalDurably } from "./ensemble-router-artifacts.js";
import type { OperationalOverlay } from "@maestro/domain";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

/**
 * Plan-5 S3 `safe-pause-and-resume` RED gates.
 *
 * Each `it` below documents, in its own assertions, whether the described
 * property already held before this slice (in which case the test simply
 * proves it and the corresponding roadmap finding says "no gap found") or
 * whether it required a production fix in this slice.
 */
describeDatabase("safe pause and resume (Plan 5 S3)", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  beforeAll(async () => { await applyAllMigrations(pool); });

  beforeEach(async () => {
    await pool.query(
      "TRUNCATE goal_leases, outbox, goal_events, goals, goal_controls, command_receipts, " +
      "capability_effect_resolutions, capability_decision_journal, capability_repetition_claims, " +
      "capability_repetition_budgets, capability_sessions, capability_approvals, authority_records " +
      "RESTART IDENTITY CASCADE",
    );
  });

  afterAll(async () => { await pool.end(); });

  async function activeGoal() {
    const projectId = randomUUID();
    const goalId = randomUUID();
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "control-plane", leaseDurationMs: 60_000 });
    const command = async (to: import("@maestro/domain").GoalState, expectedVersion: number) =>
      executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "operator", type: "TransitionGoal", expectedVersion, to }, proof);
    await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "operator", type: "CreateGoal", expectedVersion: 0 }, proof);
    await command("ready_for_confirmation", 1);
    await command("launched", 2);
    await command("active", 3);
    return { projectId, goalId, proof, command };
  }

  const approvalInput = (projectId: string, goalId: string, commandId: string, overrides: Partial<CapabilityApprovalInput> = {}): CapabilityApprovalInput => ({
    approvalId: randomUUID(),
    capabilityKind: "ipython",
    projectId,
    goalId,
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
    consequence: "The bounded effect may change the project state within the recorded scope.",
    expiresAt: new Date("2030-01-01T00:00:00Z"),
    repetitionScope: { kind: "bounded_count", count: 2 },
    ...overrides,
  });

  // --- 1 & 5: a Goal pauses only at a safe point, never mid-effect, and the
  // in-flight IPython effect's durable journal state is preserved untouched. ---
  it("refuses to complete a pause while an IPython effect is still pending durable resolution", async () => {
    const { projectId, goalId, command } = await activeGoal();
    const sessionId = randomUUID();
    await setCapabilitySession(pool, { sessionId, capabilityKind: "ipython", projectId, goalId, fullAccessMode: "skip_intermediate_approvals", selectedBy: "operator" });
    await recordIpPythonSessionStarted(pool, { sessionId, processRef: randomUUID(), projectId, goalId, processPid: 42, details: { state: "active", pausePolicy: "safe_point" } });
    const sessionBefore = await listIpPythonSessionJournal(pool, sessionId);
    expect(sessionBefore).toHaveLength(1);
    const commandId = randomUUID();
    const created = await createCapabilityApproval(pool, approvalInput(projectId, goalId, commandId));
    // Consuming the approval durably records a 'pending_unknown' effect_result
    // journal entry -- the exact in-flight-effect shape a pause must never
    // step over.
    await consumeCapabilityApproval(pool, {
      approvalId: created.approvalId, capabilityKind: "ipython", projectId, goalId, commandId,
      action: "project.file.edit", target: "/workspace/a.txt", policyVersion: 1, controlEpoch: "1", budgetEffectCents: 10,
    });
    const pendingBefore = await listPendingCapabilityEffects(pool, "ipython", projectId, goalId);
    expect(pendingBefore).toHaveLength(1);

    await command("pausing", 4);
    // The safe point is the absence of pending effect journal entries. While
    // one is outstanding, "paused" must not be reachable.
    await expect(command("paused", 5)).resolves.toMatchObject({ outcome: "rejected", code: "invalid_transition" });

    // The pending effect's durable state must be completely untouched by the
    // refused pause attempt -- no partial effect, no silent resolution.
    const pendingAfterRefusal = await listPendingCapabilityEffects(pool, "ipython", projectId, goalId);
    expect(pendingAfterRefusal).toEqual(pendingBefore);

    // Once the effect is resolved with real terminal evidence, the safe
    // point exists and the pause can complete.
    const claim = await pool.query<{ claim_id: string }>(
      "SELECT claim_id FROM capability_repetition_claims WHERE capability_kind = 'ipython' AND goal_id = $1 AND command_id = $2", [goalId, commandId],
    );
    await resolveCapabilityEffect(pool, {
      claimId: claim.rows[0]!.claim_id, approvalId: created.approvalId, capabilityKind: "ipython",
      projectId, goalId, commandId, effectIndex: 0, outcome: "confirmed", resolvedBy: "worker:test", reason: "Terminal effect evidence observed.",
    });
    expect(await listPendingCapabilityEffects(pool, "ipython", projectId, goalId)).toHaveLength(0);
    await expect(command("paused", 5)).resolves.toMatchObject({ state: "paused" });
    // The active session lifecycle remains durably journaled across the pause;
    // the refused mid-effect pause never invents a partial terminal outcome.
    await expect(listIpPythonSessionJournal(pool, sessionId)).resolves.toEqual(sessionBefore);
  });

  // --- 2: pause fences the current execution; the old fencing token cannot
  // write afterwards (C3). The mechanism is the shared control_epoch fence
  // already exercised by every "denies X writes once the Goal is paused"
  // suite (council/device-grant/department-plan/mission-bundle); this test
  // proves the same fence directly at the authority.recheckControl level,
  // which every capability write path calls before executing an effect. ---
  it("denies an authority recheck captured before pause once the Goal is paused (control_epoch fence)", async () => {
    const { projectId, goalId, command } = await activeGoal();
    const repository = new PostgresAuthorityRepository(pool);
    const control = await getGoalControl(pool, projectId, goalId);
    const staleControlEpoch = control.controlEpoch;
    const effectRequest = () => ({
      commandId: randomUUID(), projectId, goalId, actorId: "worker",
      action: "project.file.edit", target: "/workspace/a.txt", policyVersion: 1, budgetEffectCents: 0,
      controlEpoch: staleControlEpoch,
    });
    await bootstrapAuthorityRecord(pool, { ...effectRequest(), recordId: randomUUID(), kind: "grant", commandId: null, expiresAt: new Date("2030-01-01T00:00:00Z") });
    const executor = new AuthorizedEffectExecutor(repository, () => new Date("2029-01-01T00:00:00Z"));
    let effectWrites = 0;
    await expect(executor.execute(effectRequest(), async () => { effectWrites += 1; })).resolves.toMatchObject({ effect: "allow" });
    expect(effectWrites).toBe(1);
    const requestAt = (controlEpoch: string) => ({
      commandId: randomUUID(), projectId, goalId, actorId: "worker",
      action: "project.file.edit", target: "/workspace/a.txt", policyVersion: 1, budgetEffectCents: 0,
      controlEpoch,
    });
    await expect(repository.recheckControl(requestAt(staleControlEpoch))).resolves.toMatchObject({ effect: "allow" });

    await command("pausing", 4);
    await command("paused", 5);

    // The write path captured the pre-pause control_epoch; re-checking with
    // that exact stale epoch must now be denied -- the "paused" latch itself
    // dominates, exactly as every other Phase 2/3 write path already proves.
    const stillPending = await pool.query<{ control_epoch: string }>("SELECT control_epoch FROM goal_controls WHERE project_id = $1 AND goal_id = $2", [projectId, goalId]);
    expect(stillPending.rows[0]!.control_epoch).not.toBe(staleControlEpoch);
    await expect(repository.recheckControl(requestAt(staleControlEpoch))).resolves.toMatchObject({ effect: "deny", reason: "goal_not_executable" });
    // Exercise the real authorized-effect gateway: the stale pre-pause token
    // must prevent the callback/write, not merely return a denial from a
    // standalone control probe.
    await expect(executor.execute(effectRequest(), async () => { effectWrites += 1; })).resolves.toMatchObject({ effect: "deny", reason: "goal_not_executable" });
    expect(effectWrites).toBe(1);
    // Even the current epoch cannot write while paused; the fence is the
    // lifecycle state itself, not merely the epoch counter.
    await expect(repository.recheckControl(requestAt(stillPending.rows[0]!.control_epoch))).resolves.toMatchObject({ effect: "deny", reason: "goal_not_executable" });
  });

  // --- 3: resume produces no duplicate work -- durable evidence counts, not
  // process state, prove nothing already-proven is repeated. ---
  it("preserves durable effect-resolution evidence across a full pause/resume cycle with no duplicate work", async () => {
    const { projectId, goalId, command } = await activeGoal();
    const commandId = randomUUID();
    const created = await createCapabilityApproval(pool, approvalInput(projectId, goalId, commandId));
    await consumeCapabilityApproval(pool, {
      approvalId: created.approvalId, capabilityKind: "ipython", projectId, goalId, commandId,
      action: "project.file.edit", target: "/workspace/a.txt", policyVersion: 1, controlEpoch: "1", budgetEffectCents: 10,
    });
    const claim = await pool.query<{ claim_id: string }>(
      "SELECT claim_id FROM capability_repetition_claims WHERE capability_kind = 'ipython' AND goal_id = $1 AND command_id = $2", [goalId, commandId],
    );
    await resolveCapabilityEffect(pool, {
      claimId: claim.rows[0]!.claim_id, approvalId: created.approvalId, capabilityKind: "ipython",
      projectId, goalId, commandId, effectIndex: 0, outcome: "confirmed", resolvedBy: "worker:test", reason: "Terminal effect evidence observed.",
    });
    const resolutionCountBefore = (await pool.query<{ count: string }>("SELECT count(*) FROM capability_effect_resolutions WHERE goal_id = $1", [goalId])).rows[0]!.count;

    await command("pausing", 4);
    await command("paused", 5);
    await command("resuming", 6);
    await command("active", 7);

    // Durable evidence count is unchanged: the proven effect was never
    // re-claimed, re-consumed, or re-resolved by resume.
    const resolutionCountAfter = (await pool.query<{ count: string }>("SELECT count(*) FROM capability_effect_resolutions WHERE goal_id = $1", [goalId])).rows[0]!.count;
    expect(resolutionCountAfter).toBe(resolutionCountBefore);
    expect(await listPendingCapabilityEffects(pool, "ipython", projectId, goalId)).toHaveLength(0);

    // Attempting to consume the exact same command/effect identity again is
    // recognized as the already-proven claim, not a fresh unit of work.
    const replay = await consumeCapabilityApproval(pool, {
      approvalId: created.approvalId, capabilityKind: "ipython", projectId, goalId, commandId,
      action: "project.file.edit", target: "/workspace/a.txt", policyVersion: 1, controlEpoch: "1", budgetEffectCents: 10,
    });
    expect(replay.consumed).toBe(false);
    expect((await pool.query<{ count: string }>("SELECT count(*) FROM capability_effect_resolutions WHERE goal_id = $1", [goalId])).rows[0]!.count).toBe(resolutionCountBefore);
  });

  // --- 4: resume does not reuse the prior routing/approval state; it
  // re-derives from the Goal's own current control_epoch snapshot. The
  // approval ledger (plan-2 S2) already scopes every approval to the exact
  // control_epoch it was issued under, so a pre-pause approval cannot
  // authorize a post-resume effect -- this proves that isolation half
  // specifically across a pause/resume cycle. ---
  it("cannot reuse a pre-pause capability approval after resume advances the control_epoch", async () => {
    const { projectId, goalId, command } = await activeGoal();
    const overlay: OperationalOverlay = {
      schemaVersion: 1,
      installationRef: `installation-${randomUUID()}`,
      projectRef: projectId,
      version: 1,
      observations: [{ candidateRef: "candidate-1", measuredLatencyMs: 10, measuredCost: 1, failureRate: 0, timeoutRate: 0, providerErrorRate: 0, currentAvailability: true, accountBinding: "account-1", observedAt: "2026-09-08T12:00:00Z" }],
    };
    await recordOperationalOverlay(pool, overlay);
    const goalSnapshot = await snapshotOperationalOverlayForGoalDurably(pool, overlay, goalId);
    const preComandId = randomUUID();
    const preApproval = await createCapabilityApproval(pool, approvalInput(projectId, goalId, preComandId, { controlEpoch: "1" }));

    await command("pausing", 4);
    await command("paused", 5);
    await command("resuming", 6);
    await command("active", 7);

    const controlEpochAfterResume = (await pool.query<{ control_epoch: string }>("SELECT control_epoch FROM goal_controls WHERE project_id = $1 AND goal_id = $2", [projectId, goalId])).rows[0]!.control_epoch;
    expect(controlEpochAfterResume).not.toBe("1");
    // Resume must use the immutable Goal-owned snapshot, not a mutable latest
    // operational overlay. A newer overlay cannot replace the pre-pause input.
    const latestOverlay: OperationalOverlay = { ...overlay, version: 2, observations: [{ ...overlay.observations[0]!, measuredLatencyMs: 999 }] };
    await recordOperationalOverlay(pool, latestOverlay);
    await expect(readGoalOperationalOverlaySnapshot(pool, goalId)).resolves.toEqual(goalSnapshot);

    // The approval issued before pause was scoped to control_epoch "1"; it
    // cannot silently authorize work under the post-resume epoch.
    const postCommandId = randomUUID();
    await expect(consumeCapabilityApproval(pool, {
      approvalId: preApproval.approvalId, capabilityKind: "ipython", projectId, goalId, commandId: postCommandId,
      action: "project.file.edit", target: "/workspace/a.txt", policyVersion: 1, controlEpoch: controlEpochAfterResume, budgetEffectCents: 10,
    })).rejects.toThrow();
  });

  // --- 6: pause and resume are idempotent under repeated invocation with the
  // same command identity. ---
  it("is idempotent under repeated pause and resume commands with the same command identity", async () => {
    const { projectId, goalId, proof } = await activeGoal();
    const pauseCommandId = randomUUID();
    const pauseCommand = { commandId: pauseCommandId, projectId, goalId, actorId: "operator", type: "TransitionGoal" as const, expectedVersion: 4, to: "pausing" as const };
    const first = await executeGoalCommand(pool, pauseCommand, proof);
    const second = await executeGoalCommand(pool, pauseCommand, proof);
    expect(second).toEqual(first);
    await expect(executeGoalCommand(pool, { ...pauseCommand, to: "active" as const }, proof)).rejects.toBeInstanceOf(CommandIdReuseError);

    await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "operator", type: "TransitionGoal", expectedVersion: 5, to: "paused" }, proof);

    const resumeCommandId = randomUUID();
    const resumeCommand = { commandId: resumeCommandId, projectId, goalId, actorId: "operator", type: "TransitionGoal" as const, expectedVersion: 6, to: "resuming" as const };
    const firstResume = await executeGoalCommand(pool, resumeCommand, proof);
    const secondResume = await executeGoalCommand(pool, resumeCommand, proof);
    expect(secondResume).toEqual(firstResume);
  });
});
