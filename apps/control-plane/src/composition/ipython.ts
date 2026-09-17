import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { Pool } from "pg";
import type { EnvironmentRecord } from "@maestro/domain";
import { reapIpPythonProcessGroup, type IpPythonSessionBinding, type IpPythonStageBoundary } from "@maestro/agent-runtime";
import { readEnvironment, type IpPythonSessionJournalEntry } from "@maestro/persistence";

export function ipPythonStageJournalEvent(outcome: IpPythonStageBoundary["outcome"]): "effect_result" | "interruption" | "failure" {
  if (outcome === "completed") return "effect_result";
  if (outcome === "stopped") return "interruption";
  return "failure";
}

export function ipPythonStageDetails(boundary: IpPythonStageBoundary): Record<string, unknown> {
  return {
    stage: boundary.stage,
    outcome: boundary.outcome,
    blockDigest: boundary.blockDigest,
    ...(boundary.approvedBlockDigest === undefined ? {} : { approvedBlockDigest: boundary.approvedBlockDigest }),
    intentCount: boundary.intentCount,
    appliedCount: boundary.appliedCount,
    skippedCount: boundary.skippedCount,
    ...(boundary.reason === undefined ? {} : { reason: boundary.reason }),
  };
}

export function ipPythonJournalDetails(binding: IpPythonSessionBinding, details: Record<string, unknown>): Record<string, unknown> {
  return {
    ...details,
    admissionCommandId: binding.admissionCommandId ?? binding.commandId,
    ...("workerId" in binding && typeof binding.workerId === "string" ? { workerId: binding.workerId } : {}),
  };
}

export async function inspectIpPythonProcessOutcome(entry: IpPythonSessionJournalEntry): Promise<"reaped" | "unknown"> {
  const details = entry.details;
  const processGroupId = details.process_group_id;
  const processSessionId = details.process_session_id;
  const processStartTime = details.process_start_time;
  if (
    entry.processPid === null ||
    typeof processGroupId !== "string" ||
    typeof processSessionId !== "string" ||
    typeof processStartTime !== "string"
  )
    return "unknown";
  // A leader PID disappearing is not enough: the original detached group may
  // still contain a shell/test descendant. The runtime helper verifies the
  // captured group/session/start identity, terminates the matching group, and
  // returns `reaped` only after no owned member remains.
  return reapIpPythonProcessGroup({ processPid: entry.processPid, processGroupId, processSessionId, processStartTime });
}

export interface WorkerIpPythonComposition {
  readonly workerId?: string;
  readonly workspaceRoot?: string;
  /** Repository and immutable base used only to provision a real worker worktree. */
  readonly repositoryPath?: string;
  readonly baseRevision?: string;
  readonly ownerId?: string;
  readonly fencingToken?: string;
  readonly allowedTools?: readonly string[];
  readonly authorityBoundary?: readonly string[];
  readonly allowedPaths?: readonly string[];
  readonly workspaceBindingValid?: boolean;
  readonly environmentBindingValid?: boolean;
  readonly environment?: EnvironmentRecord;
}

/**
 * Resolve only durable worker-owned inputs for an IPython host session. A
 * command identity that is not a worker admission receives no composition,
 * which keeps conversation/Head/Encore sessions from inheriting worker state.
 * Environment records are accepted only while they are ready, unexpired, and
 * bound to the same Goal/project/worker identity.
 */
export async function resolveWorkerIpPythonComposition(
  pool: Pick<Pool, "query">,
  input: { readonly commandId: string; readonly projectId: string; readonly goalId: string; readonly trustedWorktreeRoot?: string },
  now: Date = new Date(),
): Promise<WorkerIpPythonComposition> {
  if (input.commandId.trim() === "" || input.projectId.trim() === "" || input.goalId.trim() === "") return {};
  const worker = await pool.query<{
    worker_id: string;
    goal_id: string;
    project_id: string;
    owner_id: string | null;
    owner_fencing_token: string | null;
    substance: unknown;
    repository_path: string | null;
    base_revision: string | null;
  }>(
    `SELECT w.worker_id, hc.goal_id, g.project_id, w.owner_id, w.owner_fencing_token, mb.substance,
            tc.content->'project'->>'repository' AS repository_path,
            tc.content->'project'->>'immutableBaseRevision' AS base_revision
       FROM workers w
       JOIN head_councils hc ON hc.council_id = w.council_id
       JOIN goals g ON g.goal_id = hc.goal_id
       LEFT JOIN task_contracts tc ON tc.contract_id = g.task_contract_id
       JOIN mission_bundles mb
         ON mb.council_id = w.council_id
        AND mb.department_id = w.department_id
        AND mb.plan_version = w.plan_version
        AND mb.item_id = w.item_id
      WHERE w.spawn_command_id = $1`,
    [input.commandId],
  );
  const row = worker.rows[0];
  if (row === undefined || row.project_id !== input.projectId || row.goal_id !== input.goalId) return {};
  const substance =
    row.substance !== null && typeof row.substance === "object" && !Array.isArray(row.substance)
      ? (row.substance as { readonly allowedTools?: unknown; readonly allowedPaths?: unknown; readonly authorityBoundary?: unknown })
      : undefined;
  const allowedTools =
    Array.isArray(substance?.allowedTools) && substance.allowedTools.every((value) => typeof value === "string")
      ? (substance.allowedTools as string[])
      : undefined;
  const allowedPaths =
    Array.isArray(substance?.allowedPaths) && substance.allowedPaths.every((value) => typeof value === "string")
      ? (substance.allowedPaths as string[])
      : undefined;
  const authorityBoundary =
    Array.isArray(substance?.authorityBoundary) && substance.authorityBoundary.every((value) => typeof value === "string")
      ? (substance.authorityBoundary as string[])
      : undefined;
  const repositoryPath = typeof row.repository_path === "string" && row.repository_path.trim() !== "" ? row.repository_path : undefined;
  const baseRevision = typeof row.base_revision === "string" && /^[0-9a-f]{40}$/.test(row.base_revision) ? row.base_revision : undefined;
  const result: WorkerIpPythonComposition = {
    workerId: row.worker_id,
    ...(repositoryPath === undefined ? {} : { repositoryPath }),
    ...(baseRevision === undefined ? {} : { baseRevision }),
    ...(row.owner_id === null ? {} : { ownerId: row.owner_id }),
    ...(row.owner_fencing_token === null ? {} : { fencingToken: row.owner_fencing_token }),
    ...(allowedTools === undefined ? {} : { allowedTools }),
    ...(allowedPaths === undefined ? {} : { allowedPaths }),
    ...(authorityBoundary === undefined ? {} : { authorityBoundary }),
  };
  const worktree = await pool.query<{ repository_path?: string; worktree_path: string }>(
    "SELECT repository_path, worktree_path FROM worker_worktrees WHERE worker_id = $1",
    [row.worker_id],
  );
  const worktreePath = worktree.rows[0]?.worktree_path;
  const durableRepositoryPath =
    typeof worktree.rows[0]?.repository_path === "string" && worktree.rows[0]!.repository_path.trim() !== ""
      ? worktree.rows[0]!.repository_path
      : result.repositoryPath;
  if (typeof worktreePath === "string" && worktreePath.trim() !== "") {
    if (!isAbsolute(worktreePath)) return { ...result, workspaceBindingValid: false };
    if (input.trustedWorktreeRoot !== undefined) {
      try {
        const trustedRoot = realpathSync.native(input.trustedWorktreeRoot);
        const actualWorktree = realpathSync.native(worktreePath);
        const remainder = relative(trustedRoot, actualWorktree);
        if (remainder === "" || remainder === ".." || remainder.startsWith(`..${sep}`) || isAbsolute(remainder))
          return { ...result, workspaceBindingValid: false };
      } catch {
        return { ...result, workspaceBindingValid: false };
      }
    }
    return await attachWorkerEnvironment(
      pool,
      row,
      { ...result, workspaceRoot: worktreePath, ...(durableRepositoryPath === undefined ? {} : { repositoryPath: durableRepositoryPath }) },
      now,
    );
  }
  return attachWorkerEnvironment(
    pool,
    row,
    durableRepositoryPath === undefined ? result : { ...result, repositoryPath: durableRepositoryPath },
    now,
  );
}

async function attachWorkerEnvironment(
  pool: Pick<Pool, "query">,
  worker: { readonly worker_id: string; readonly goal_id: string; readonly project_id: string; readonly substance: unknown },
  composition: WorkerIpPythonComposition,
  now: Date,
): Promise<WorkerIpPythonComposition> {
  const substance =
    worker.substance !== null && typeof worker.substance === "object" && !Array.isArray(worker.substance)
      ? (worker.substance as { readonly environment?: unknown })
      : undefined;
  const declaredEnvironment = substance?.environment;
  if (declaredEnvironment === undefined) return composition;
  if (
    !Array.isArray(declaredEnvironment) ||
    declaredEnvironment.length > 1 ||
    declaredEnvironment.some((value) => typeof value !== "string" || value.trim() === "")
  )
    return { ...composition, environmentBindingValid: false };
  const environmentId = declaredEnvironment[0];
  if (environmentId === undefined) return composition;
  // A missing worktree is provisioned by the Control Plane before the durable
  // environment can be checked against its workspace. Re-resolve after that
  // authority-backed setup; never treat the pre-provisioning state as valid.
  if (composition.workspaceRoot === undefined) return composition;
  let environment: EnvironmentRecord | undefined;
  try {
    environment = await readEnvironment(pool, environmentId);
  } catch {
    return { ...composition, environmentBindingValid: false };
  }
  if (
    environment === undefined ||
    environment.state !== "ready" ||
    Date.parse(environment.expiresAt) <= now.getTime() ||
    environment.workerId !== composition.workerId ||
    environment.goalId !== worker.goal_id ||
    environment.projectId !== worker.project_id ||
    environment.boundaries.filesystem.length === 0 ||
    !environment.boundaries.filesystem.some((scope) => {
      const filesystemRoot = isAbsolute(scope) ? resolve(scope) : resolve(composition.workspaceRoot!, scope);
      const remainder = relative(filesystemRoot, resolve(composition.workspaceRoot!));
      return remainder === "" || (remainder !== ".." && !remainder.startsWith(`..${sep}`) && !isAbsolute(remainder));
    })
  )
    return { ...composition, environmentBindingValid: false };
  return { ...composition, environment };
}
