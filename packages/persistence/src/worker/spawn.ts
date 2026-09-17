import { WorkerRow, mapWorker, workerSelectSql, lockGoalLease } from "./shared.js";
import { createHash, randomUUID } from "node:crypto";
import {
  canonicalOutboundDataClasses,
  type ExecutionAdmission,
  type ExecutionKernelPort,
  type Worker,
  type WorkerStatus,
} from "@maestro/domain";
import type { Pool } from "pg";
import { StaleGoalLeaseError, isValidFencingToken, type GoalLeaseProof } from "../commands.js";
import { isAuthorizedHeadCouncilActor, readHeadCouncil, type CouncilActorContext } from "../council.js";
import { readMissionBundle } from "../mission-bundle.js";
import { deriveWorkerProfileForMission } from "../worker-profile-derivation.js";
import { readNativeExecutionBindingId, recordNativeExecutionBindingIfSupported } from "../native-execution-binding.js";
import { recordRoutingEvidence } from "../ensemble-router-artifacts.js";
import type { SpawnWorkerRequest } from "./types.js";
import { WorkerError, WorkerProviderOutcomeUnknownError } from "./types.js";
import { assertWorkerPathScope } from "./shared.js";
import { assertCurrentWorkerLease, missionTimeLimitMs, selectWorkerModel } from "./model.js";
import { promptWorkerUnderOwnerClaim } from "./claims.js";
import { observeWorker } from "./observe.js";
import { bindWorkerInvocation, cancelUnboundWorkerAfterBindingFailure, markUnboundWorkerUnknown, markWorkerTerminal } from "./terminal.js";

/**
 * Spawn one attempt of a worker for a Mission Bundle's assigned mission,
 * through the injected provider-neutral ExecutionKernelPort -- no provider
 * identifier or type crosses this boundary. Only the Department's currently
 * active, captured Head may spawn workers for it (roadmap/act-1-foundation/phase-02-hierarchical-execution.md: "Only a
 * Department Head may create ordinary workers"). Bounded by the bundle's
 * retryCeiling: attempt N+1 is refused once N+1 exceeds retryCeiling + 1
 * (the ceiling is additional retries beyond the first attempt).
 */
export async function spawnWorker(
  pool: Pool,
  kernel: ExecutionKernelPort,
  request: SpawnWorkerRequest,
  proof: GoalLeaseProof,
  context: CouncilActorContext,
): Promise<Worker> {
  const client = await pool.connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    const council = await readHeadCouncil(pool, request.councilId);
    if (council.goalId !== proof.goalId || proof.goalId === "" || proof.ownerId === "" || !isValidFencingToken(proof.fencingToken))
      throw new StaleGoalLeaseError(proof.goalId);
    const ownerLeaseExpiresAt = await lockGoalLease(client, proof);
    const control = await client.query<{ control_epoch: string }>(
      "SELECT control_epoch FROM goal_controls WHERE project_id = $1 AND goal_id = $2 FOR UPDATE",
      [council.snapshot.projectId, council.goalId],
    );
    if (control.rowCount !== 1 || control.rows[0]!.control_epoch.trim() === "") throw new WorkerError("Goal control epoch is unavailable");
    const controlEpoch = control.rows[0]!.control_epoch;
    const captured = council.snapshot.participants.find(
      (participant) => (participant.departmentId ?? participant.participantId) === request.departmentId,
    );
    if (captured === undefined) throw new WorkerError("Department is not a captured Council participant");
    const authorized =
      captured.headRoleId !== undefined
        ? isAuthorizedHeadCouncilActor(context, captured)
        : context.actorId === captured.participantId && context.sessionRef === captured.sessionRef;
    if (!authorized) throw new WorkerError("Worker spawn actor is not bound to the captured Head identity and session");
    const active = await client.query(
      "SELECT 1 FROM goal_head_participations WHERE goal_id = $1 AND department_id = $2 AND status = 'active' AND active_session_ref = $3 FOR UPDATE",
      [council.goalId, request.departmentId, captured.sessionRef],
    );
    if (active.rowCount !== 1) throw new WorkerError("Captured Head session is no longer authorized to spawn workers");
    const bundle = await readMissionBundle(pool, request.councilId, request.departmentId, request.planVersion, request.itemId);
    const fixedModelRef = request.createAdmission === undefined ? selectWorkerModel(bundle, request.modelRef) : undefined;
    assertWorkerPathScope(bundle.substance.allowedPaths);
    const requestHash =
      request.commandId === undefined
        ? undefined
        : createHash("sha256")
            .update(
              JSON.stringify({
                councilId: request.councilId,
                departmentId: request.departmentId,
                planVersion: request.planVersion,
                itemId: request.itemId,
                bundleContentHash: bundle.contentHash,
                repositoryPath: request.repositoryPath ?? null,
                worktreePath: request.worktreePath ?? null,
              }),
            )
            .digest("hex");
    if (request.commandId !== undefined) {
      const priorCommand = await client.query<{ worker_id: string; spawn_request_hash: string | null }>(
        `SELECT worker_id, spawn_request_hash FROM workers WHERE spawn_command_id = $1 FOR UPDATE`,
        [request.commandId],
      );
      if (priorCommand.rowCount === 1) {
        const prior = priorCommand.rows[0]!;
        if (prior.spawn_request_hash?.trim() !== requestHash)
          throw new WorkerError("Worker command identity was reused with different content");
        const replay = await client.query<WorkerRow>(workerSelectSql() + " WHERE worker_id = $1", [prior.worker_id]);
        if (replay.rowCount !== 1) throw new WorkerError("Worker command replay could not be resolved");
        await client.query("COMMIT");
        open = false;
        return mapWorker(replay.rows[0]!);
      }
    }
    const priorAttempts = await client.query<{ attempt: number; status: WorkerStatus }>(
      "SELECT attempt, status FROM workers WHERE council_id = $1 AND department_id = $2 AND plan_version = $3 AND item_id = $4 ORDER BY attempt DESC FOR UPDATE",
      [request.councilId, request.departmentId, request.planVersion, request.itemId],
    );
    const activeAttempt = priorAttempts.rows.find((row) => row.status === "spawned" || row.status === "running");
    if (activeAttempt !== undefined)
      throw new WorkerError(`A worker is already active for this mission (attempt ${activeAttempt.attempt})`);
    const unknownAttempt = priorAttempts.rows.find((row) => row.status === "unknown");
    if (unknownAttempt !== undefined)
      throw new WorkerError(
        `Worker provider state is unknown for this mission (attempt ${unknownAttempt.attempt}); reconcile before retrying`,
      );
    const nextAttempt = (priorAttempts.rows[0]?.attempt ?? 0) + 1;
    if (nextAttempt > bundle.substance.retryCeiling + 1)
      throw new WorkerError(`Mission retry ceiling exceeded: ${bundle.substance.retryCeiling}`);
    // Reserve the worker identity before contacting the provider. A crash or
    // provider failure is therefore visible to replay/reconciliation instead
    // of being an unowned external session.
    const workerId = randomUUID();
    const pendingExecution = `pending:${workerId}`;
    await client.query<WorkerRow>(
      `INSERT INTO workers (worker_id, council_id, department_id, plan_version, item_id, bundle_content_hash, attempt, execution_ref, invocation_ref, owner_id, owner_fencing_token, owner_lease_expires_at, heartbeat_at, recovery_state, status, spawn_command_id, spawn_request_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::bigint, $12, transaction_timestamp(), 'none', 'spawned', $13, $14)
       RETURNING worker_id, council_id, department_id, plan_version, item_id, bundle_content_hash, attempt, execution_ref, invocation_ref, owner_id, owner_fencing_token, owner_lease_expires_at, heartbeat_at, recovery_state, cancellation_requested_at, cancellation_owner_id, cancellation_fencing_token, status, answer_text, usage_total_tokens`,
      [
        workerId,
        request.councilId,
        request.departmentId,
        request.planVersion,
        request.itemId,
        bundle.contentHash,
        nextAttempt,
        pendingExecution,
        pendingExecution,
        proof.ownerId,
        proof.fencingToken,
        ownerLeaseExpiresAt,
        request.commandId ?? null,
        requestHash ?? null,
      ],
    );
    await client.query("COMMIT");
    open = false;
    let spawned: import("@maestro/domain").SpawnedInvocation;
    let providerAttempted = false;
    try {
      const workerProfile = await deriveWorkerProfileForMission(pool, {
        workerId,
        councilId: request.councilId,
        departmentId: request.departmentId,
        planVersion: request.planVersion,
        itemId: request.itemId,
        profileRef: bundle.substance.profileRef,
        roleId: `head-${request.departmentId}`,
        taskClass: bundle.substance.role,
        allowDefaultMissionOverlay: true,
        defaultMissionOverlayExpiresAt: new Date(Date.now() + missionTimeLimitMs(bundle.substance.timeCeiling)).toISOString(),
      });
      const preparedCwd = request.prepareWorktree === undefined ? request.cwd : await request.prepareWorktree(workerId);
      const persistedProfile = await pool.query(
        `UPDATE workers SET worker_profile_derivation = $2::jsonb
          WHERE worker_id = $1 AND status = 'spawned' AND owner_id = $3 AND owner_fencing_token = $4::bigint`,
        [workerId, JSON.stringify(workerProfile), proof.ownerId, proof.fencingToken],
      );
      if (persistedProfile.rowCount !== 1) throw new StaleGoalLeaseError(proof.goalId);
      const admissionContext = {
        operatorId: context.actorId,
        projectId: council.snapshot.projectId,
        goalId: council.goalId,
        missionBundleId: bundle.contentHash,
        policyVersion: `${request.planVersion}:${bundle.contentHash}`,
        authorityPolicyVersion: request.planVersion,
        controlEpoch,
        budgetEffectCents: 0,
        fencingToken: proof.fencingToken,
      };
      const admissionGrant: Omit<import("@maestro/domain").CapabilityGrant, "modelPolicy"> = {
        grantId: `worker:${workerId}`,
        allowedTools: bundle.substance.allowedTools,
        allowedSkills: bundle.substance.allowedSkills,
        pathScope: bundle.substance.allowedPaths,
        outboundDataClasses: canonicalOutboundDataClasses(bundle.substance.dataBoundary),
        remaining: {
          modelTurns: 8,
          toolCalls: Math.max(1, bundle.substance.allowedTools.length * 8),
          childCalls: bundle.substance.workerCeiling,
          outputTokens: 8_192,
          wallTimeMs: missionTimeLimitMs(bundle.substance.timeCeiling),
          retryCount: bundle.substance.retryCeiling,
        },
      };
      const admissionDecision =
        request.createAdmission === undefined
          ? undefined
          : await request.createAdmission({
              workerId,
              routeRef: `worker:${workerId}:${nextAttempt}`,
              bundle,
              base: { context: admissionContext, grant: admissionGrant, idempotencyKey: request.commandId ?? `worker:${workerId}` },
            });
      const providerAdmission: ExecutionAdmission =
        admissionDecision?.admission ??
        (() => {
          if (fixedModelRef === undefined) throw new WorkerError("Worker admission did not produce a routed model");
          return {
            context: admissionContext,
            grant: { ...admissionGrant, modelPolicy: [fixedModelRef] },
            modelPolicy: [fixedModelRef],
            idempotencyKey: request.commandId ?? `worker:${workerId}`,
          };
        })();
      const routingEvidenceDraft = admissionDecision?.routingEvidence;
      const providerRequest = {
        name: `${bundle.substance.role}:${request.itemId}:${nextAttempt}`,
        prompt: bundle.substance.goalBrief,
        ...(preparedCwd === undefined ? {} : { cwd: preparedCwd }),
        // Keep the legacy capability projection for injected kernels while the
        // native fields carry the complete host-owned admission contract.
        capabilities: { allowedTools: bundle.substance.allowedTools, allowedSkills: bundle.substance.allowedSkills },
        workerProfile: {
          profile: workerProfile.profile,
          explanations: workerProfile.explanations,
          assignmentRef: workerProfile.assignmentRef,
        },
        ...providerAdmission,
      };
      // The provider call cannot be made atomically with PostgreSQL. Check the
      // live claim immediately before admission; any response is then bound
      // identity-only so a successor can retain the opaque refs after turnover.
      await assertCurrentWorkerLease(pool, workerId, proof);
      providerAttempted = true;
      spawned = await kernel.spawn(providerRequest);
      const nativeBindingRecorded = await recordNativeExecutionBindingIfSupported(pool, kernel, {
        execution: spawned.execution,
        invocation: spawned.invocation,
        workerId,
        goalId: council.goalId,
        projectId: council.snapshot.projectId,
        admissionKind: "worker",
        admission: providerAdmission,
      });
      if (routingEvidenceDraft !== undefined) {
        if (!nativeBindingRecorded) throw new WorkerError("Ensemble routing evidence requires a durable native execution binding");
        const binding = await readNativeExecutionBindingId(pool, spawned.execution);
        if (binding === null) throw new WorkerError("Ensemble routing evidence binding was not durable");
        await recordRoutingEvidence(pool, {
          ...routingEvidenceDraft,
          evidenceId: randomUUID(),
          admissionBindingRef: binding,
          createdAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      // A transport timeout does not prove that the provider created nothing.
      // Keep the durable reservation ambiguous and block automatic retries
      // until reconciliation can establish the provider outcome.
      if (!providerAttempted) {
        await markWorkerTerminal(pool, workerId, "failed", proof).catch(() => undefined);
        throw error;
      }
      const unknown = await markUnboundWorkerUnknown(pool, workerId, proof).catch(() => undefined);
      if (unknown !== undefined) return unknown;
      throw new WorkerProviderOutcomeUnknownError(error instanceof Error ? error.message : "Provider outcome is unknown");
    }
    let boundWorker: Worker;
    try {
      boundWorker = await bindWorkerInvocation(pool, workerId, spawned, proof);
    } catch (error) {
      // Compensation holds the same Goal/worker owner claim through the
      // provider cancel. A stale owner cannot cancel after takeover.
      const cancelled = await cancelUnboundWorkerAfterBindingFailure(pool, kernel, workerId, spawned.invocation, proof).catch(() => false);
      if (cancelled) throw error;
      throw new WorkerProviderOutcomeUnknownError(error instanceof Error ? error.message : "Provider binding outcome is unknown");
    }
    try {
      await promptWorkerUnderOwnerClaim(pool, kernel, workerId, spawned.execution, bundle.substance.goalBrief, proof);
    } catch {
      try {
        return await observeWorker(pool, kernel, workerId, proof, context);
      } catch {
        return boundWorker;
      }
    }
    return boundWorker;
  } catch (error) {
    if (open) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
