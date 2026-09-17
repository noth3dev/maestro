import { resolve } from "node:path";
import type { Pool } from "pg";
import { AuthorizedEffectExecutor, classifyAction, type ActionRequest } from "@maestro/authority";
import { bootstrapAuthorityRecord, getGoalControl } from "@maestro/persistence";
import type { WorkerIpPythonComposition } from "./ipython.js";

const IPYTHON_LOCAL_ACTIONS = new Set([
  "project.file.read",
  "project.file.edit",
  "project.test.run",
  "project.shell.run",
  "project.environment.change",
  "git.local.branch.create",
  "git.local.branch.advance",
  "git.local.commit",
  "git.local.revision.read",
  "git.local.worktree.create",
  "git.local.worktree.remove",
]);

function workerAuthorityAllowsAction(composition: WorkerIpPythonComposition, action: string): boolean {
  if (composition.allowedTools?.includes("ipython") !== true) return false;
  const boundaries = new Set((composition.authorityBoundary ?? []).map((boundary) => boundary.trim().toLowerCase()));
  if (boundaries.has("read-only")) return action === "project.file.read" || action === "git.local.revision.read";
  return boundaries.has("local") || boundaries.has("write-scoped") || boundaries.has("read-write") || boundaries.has("repository");
}

/**
 * Mission Bundle local authority is projected into exact, one-effect grants.
 * The adapters have already canonicalized and path-checked the target before
 * this gateway is called; the grant is still exact and the normal durable
 * authority executor remains the only code that may invoke the effect.
 */
export async function isWorkerFencingCurrent(
  pool: Pool,
  composition: Pick<WorkerIpPythonComposition, "workerId" | "ownerId" | "fencingToken" | "repositoryPath">,
  projectId: string,
  goalId: string,
  controlEpoch: string,
): Promise<boolean> {
  if (composition.workerId === undefined || composition.ownerId === undefined || composition.fencingToken === undefined) return false;
  try {
    const [lease, control, worker] = await Promise.all([
      pool.query(
        "SELECT 1 FROM goal_leases WHERE goal_id = $1 AND owner_id = $2 AND fencing_token = $3::bigint AND expires_at > clock_timestamp()",
        [goalId, composition.ownerId, composition.fencingToken],
      ),
      getGoalControl(pool, projectId, goalId),
      pool.query(
        "SELECT 1 FROM workers WHERE worker_id = $1 AND owner_id = $2 AND owner_fencing_token = $3::bigint AND owner_lease_expires_at > clock_timestamp() AND status IN ('spawned', 'running')",
        [composition.workerId, composition.ownerId, composition.fencingToken],
      ),
    ]);
    return (
      lease.rowCount === 1 &&
      worker.rowCount === 1 &&
      control.controlEpoch === controlEpoch &&
      control.emergencyStoppedAt === undefined &&
      control.stoppingAt === undefined &&
      control.stoppedAt === undefined
    );
  } catch {
    return false;
  }
}

export function createWorkerIpPythonAuthority(
  base: AuthorizedEffectExecutor,
  pool: Pool,
  binding: {
    readonly operatorId: string;
    readonly projectId: string;
    readonly goalId: string;
    readonly commandId: string;
    readonly authorityPolicyVersion: number;
    readonly budgetEffectCents: number;
    readonly controlEpoch: string;
  },
  composition: WorkerIpPythonComposition,
): { execute(request: ActionRequest, effect: () => Promise<unknown>): Promise<import("@maestro/authority").AuthorityDecision> } {
  return {
    async execute(request, effect) {
      const environmentActor =
        composition.workerId !== undefined &&
        request.actorId === composition.workerId &&
        ["project.test.run", "project.shell.run", "project.environment.change"].includes(request.action);
      const boundaryAllowsRequest =
        request.projectId === binding.projectId &&
        request.goalId === binding.goalId &&
        (request.actorId === binding.operatorId || environmentActor) &&
        request.policyVersion === binding.authorityPolicyVersion &&
        request.budgetEffectCents === binding.budgetEffectCents &&
        request.controlEpoch === binding.controlEpoch &&
        IPYTHON_LOCAL_ACTIONS.has(request.action) &&
        workerAuthorityAllowsAction(composition, request.action) &&
        classifyAction(request.action) === "ordinary";
      if (!boundaryAllowsRequest) return base.deny(request, "worker_authority_boundary");
      if (!(await isWorkerFencingCurrent(pool, composition, binding.projectId, binding.goalId, binding.controlEpoch)))
        return base.deny(request, "worker_fence_stale");
      const expiry =
        composition.environment === undefined
          ? new Date(Date.now() + 5 * 60_000)
          : new Date(Math.min(Date.now() + 5 * 60_000, Date.parse(composition.environment.expiresAt)));
      if (expiry.getTime() <= Date.now()) return base.deny(request, "worker_environment_expired");
      await bootstrapAuthorityRecord(pool, {
        kind: "grant",
        commandId: null,
        projectId: request.projectId,
        goalId: request.goalId,
        actorId: request.actorId,
        action: request.action,
        target: request.target,
        policyVersion: request.policyVersion,
        budgetEffectCents: request.budgetEffectCents,
        expiresAt: expiry,
      });
      return base.execute(request, async () => {
        if (!(await isWorkerFencingCurrent(pool, composition, binding.projectId, binding.goalId, binding.controlEpoch)))
          throw new Error("worker_fence_stale");
        await effect();
      });
    },
  };
}

/**
 * Worktree provisioning is Control Plane infrastructure, not a worker
 * capability. It is still authority-backed and limited to the exact local Git
 * operations needed to materialize the worker's durable workspace. The
 * resulting Git worktree is then verified before its append-only row is stored.
 */
export function createWorkerWorktreeProvisioningAuthority(
  base: AuthorizedEffectExecutor,
  pool: Pool,
  binding: {
    readonly workspaceRoot: string;
    readonly operatorId: string;
    readonly projectId: string;
    readonly goalId: string;
    readonly commandId: string;
    readonly authorityPolicyVersion: number;
    readonly budgetEffectCents: number;
    readonly controlEpoch: string;
  },
  composition: Pick<WorkerIpPythonComposition, "workerId" | "ownerId" | "fencingToken" | "repositoryPath">,
): { execute(request: ActionRequest, effect: () => Promise<unknown>): Promise<import("@maestro/authority").AuthorityDecision> } {
  const provisioningActions = new Set([
    "git.local.branch.create",
    "git.local.branch.remove",
    "git.local.worktree.create",
    "git.local.worktree.remove",
    "git.local.revision.read",
    "filesystem.directory.create",
  ]);
  return {
    async execute(request, effect) {
      const allowed =
        request.projectId === binding.projectId &&
        request.goalId === binding.goalId &&
        request.actorId === binding.operatorId &&
        request.policyVersion === binding.authorityPolicyVersion &&
        request.budgetEffectCents === binding.budgetEffectCents &&
        request.controlEpoch === binding.controlEpoch &&
        provisioningActions.has(request.action) &&
        classifyAction(request.action) === "ordinary";
      if (!allowed) return base.deny(request, "worker_worktree_provisioning_boundary");
      const compensatingCleanup = request.action === "git.local.worktree.remove" || request.action === "git.local.branch.remove";
      if (compensatingCleanup) {
        let targetParts: unknown;
        try {
          targetParts = JSON.parse(request.target);
        } catch {
          return base.deny(request, "worker_cleanup_target_invalid");
        }
        if (!Array.isArray(targetParts) || targetParts[0] !== composition.repositoryPath || typeof composition.workerId !== "string")
          return base.deny(request, "worker_cleanup_target_mismatch");
        const expectedBranch = `worker/${composition.workerId}`;
        if (
          (request.action === "git.local.branch.remove" && targetParts.length !== 2) ||
          (request.action === "git.local.worktree.remove" && targetParts.length !== 2)
        )
          return base.deny(request, "worker_cleanup_target_mismatch");
        if (request.action === "git.local.branch.remove" && targetParts[1] !== expectedBranch)
          return base.deny(request, "worker_cleanup_target_mismatch");
        if (
          request.action === "git.local.worktree.remove" &&
          targetParts[1] !== resolve(binding.workspaceRoot ?? "", "workers", composition.workerId)
        )
          return base.deny(request, "worker_cleanup_target_mismatch");
      }
      // Cleanup is allowed after lease turnover only for the exact worker-derived
      // branch/worktree already created by this provisioning attempt. It cannot
      // create, advance, commit, or read anything and remains durably journaled.
      if (
        !compensatingCleanup &&
        !(await isWorkerFencingCurrent(pool, composition, binding.projectId, binding.goalId, binding.controlEpoch))
      )
        return base.deny(request, "worker_fence_stale");
      await bootstrapAuthorityRecord(pool, {
        kind: "grant",
        commandId: null,
        projectId: request.projectId,
        goalId: request.goalId,
        actorId: request.actorId,
        action: request.action,
        target: request.target,
        policyVersion: request.policyVersion,
        budgetEffectCents: request.budgetEffectCents,
        expiresAt: new Date(Date.now() + 5 * 60_000),
      });
      return base.execute(request, async () => {
        if (
          !compensatingCleanup &&
          !(await isWorkerFencingCurrent(pool, composition, binding.projectId, binding.goalId, binding.controlEpoch))
        )
          throw new Error("worker_fence_stale");
        await effect();
      });
    },
  };
}
