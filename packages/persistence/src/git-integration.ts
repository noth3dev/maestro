import { randomUUID } from "node:crypto";
import type {
  DepartmentBranch,
  GitPort,
  GoalIntegrationBranch,
  IntegrationCommit,
  WorkerWorktree,
} from "@maestro/domain";
import type { Pool, PoolClient } from "pg";
import { StaleGoalLeaseError, isValidFencingToken, type GoalLeaseProof } from "./commands.js";
import { assertGoalControlOpen, isAuthorizedHeadCouncilActor, readHeadCouncil, type CouncilActorContext } from "./council.js";
import { WorkerNotFoundError } from "./worker.js";

export class GitIntegrationError extends Error {}
export class GitIntegrationNotFoundError extends GitIntegrationError {}

async function lockGoalLease(client: PoolClient, proof: GoalLeaseProof): Promise<void> {
  const lease = await client.query("SELECT 1 FROM goal_leases WHERE goal_id = $1 AND owner_id = $2 AND fencing_token = $3::bigint AND expires_at > clock_timestamp() FOR UPDATE", [proof.goalId, proof.ownerId, proof.fencingToken]);
  if (lease.rowCount !== 1) throw new StaleGoalLeaseError(proof.goalId);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 18))", [proof.goalId]);
  await assertGoalControlOpen(client, proof.goalId);
}

/** Creates the Goal integration branch through the real Git port and records it once, durably. Idempotent for an exact repeat of the same repository/branch/base. */
export async function recordGoalIntegrationBranch(pool: Pool, git: GitPort, goalId: string, repositoryPath: string, branchName: string, baseRevision: string, proof: GoalLeaseProof): Promise<GoalIntegrationBranch> {
  if (goalId !== proof.goalId || proof.goalId === "" || proof.ownerId === "" || !isValidFencingToken(proof.fencingToken)) throw new StaleGoalLeaseError(proof.goalId);
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    await lockGoalLease(client, proof);
    const existing = await client.query<{ repository_path: string; branch_name: string; base_revision: string }>(
      "SELECT repository_path, branch_name, base_revision FROM goal_integration_branches WHERE goal_id = $1 FOR UPDATE", [goalId],
    );
    if ((existing.rowCount ?? 0) > 0) {
      const prior = existing.rows[0]!;
      if (prior.repository_path === repositoryPath && prior.branch_name === branchName && prior.base_revision === baseRevision) {
        await client.query("COMMIT"); open = false;
        return { goalId, repositoryPath, branchName, baseRevision };
      }
      throw new GitIntegrationError("A Goal integration branch already exists with different identity");
    }
    await git.createBranch(repositoryPath, branchName, baseRevision);
    await client.query(
      "INSERT INTO goal_integration_branches (goal_id, repository_path, branch_name, base_revision) VALUES ($1, $2, $3, $4)",
      [goalId, repositoryPath, branchName, baseRevision],
    );
    await client.query("COMMIT"); open = false;
    return { goalId, repositoryPath, branchName, baseRevision };
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

/** Creates one Department branch, off the Goal integration branch, for a writing Department. Only that Department's currently active, captured Head may create it. */
export async function recordDepartmentBranch(pool: Pool, git: GitPort, councilId: string, departmentId: string, proof: GoalLeaseProof, context: CouncilActorContext): Promise<DepartmentBranch> {
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    const council = await readHeadCouncil(pool, councilId);
    if (council.goalId !== proof.goalId || proof.goalId === "" || proof.ownerId === "" || !isValidFencingToken(proof.fencingToken)) throw new StaleGoalLeaseError(proof.goalId);
    await lockGoalLease(client, proof);
    const captured = council.snapshot.participants.find((participant) => (participant.departmentId ?? participant.participantId) === departmentId);
    if (captured === undefined) throw new GitIntegrationError("Department is not a captured Council participant");
    const authorized = captured.headRoleId !== undefined
      ? isAuthorizedHeadCouncilActor(context, captured)
      : context.actorId === captured.participantId && context.sessionRef === captured.sessionRef;
    if (!authorized) throw new GitIntegrationError("Actor is not bound to the captured Head identity and session");
    if (council.state !== "resolved" || council.decisionPacket === null || !council.decisionPacket.departmentOwnership.some((ownership) => ownership.departmentId === departmentId)) {
      throw new GitIntegrationError("The Council decision must be resolved and assign ownership to this Department before it may create a Department branch");
    }
    const goalBranch = await client.query<{ repository_path: string; branch_name: string }>("SELECT repository_path, branch_name FROM goal_integration_branches WHERE goal_id = $1 FOR KEY SHARE", [council.goalId]);
    if (goalBranch.rowCount !== 1) throw new GitIntegrationError("Goal integration branch must exist before a Department branch");
    const { repository_path: repositoryPath, branch_name: baseBranchName } = goalBranch.rows[0]!;
    const branchName = `department/${departmentId}`;
    const existing = await client.query<{ branch_name: string }>("SELECT branch_name FROM department_branches WHERE goal_id = $1 AND department_id = $2 FOR UPDATE", [council.goalId, departmentId]);
    if ((existing.rowCount ?? 0) > 0) {
      await client.query("COMMIT"); open = false;
      return { goalId: council.goalId, departmentId, repositoryPath, branchName: existing.rows[0]!.branch_name, baseBranchName };
    }
    await git.createBranch(repositoryPath, branchName, baseBranchName);
    await client.query(
      "INSERT INTO department_branches (goal_id, department_id, repository_path, branch_name, base_branch_name) VALUES ($1, $2, $3, $4, $5)",
      [council.goalId, departmentId, repositoryPath, branchName, baseBranchName],
    );
    await client.query("COMMIT"); open = false;
    return { goalId: council.goalId, departmentId, repositoryPath, branchName, baseBranchName };
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

/** Creates a uniquely owned worktree and branch for one Execution worker, off its Department branch. */
export async function recordWorkerWorktree(pool: Pool, git: GitPort, workerId: string, worktreePath: string, proof: GoalLeaseProof, context: CouncilActorContext): Promise<WorkerWorktree> {
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    const workerRow = await client.query<{ council_id: string; department_id: string }>("SELECT council_id, department_id FROM workers WHERE worker_id = $1 FOR UPDATE", [workerId]);
    if (workerRow.rowCount !== 1) throw new WorkerNotFoundError(`Worker not found: ${workerId}`);
    const { council_id: councilId, department_id: departmentId } = workerRow.rows[0]!;
    const council = await readHeadCouncil(pool, councilId);
    if (council.goalId !== proof.goalId || proof.goalId === "" || proof.ownerId === "" || !isValidFencingToken(proof.fencingToken)) throw new StaleGoalLeaseError(proof.goalId);
    await lockGoalLease(client, proof);
    const captured = council.snapshot.participants.find((participant) => (participant.departmentId ?? participant.participantId) === departmentId);
    if (captured === undefined) throw new GitIntegrationError("Department is not a captured Council participant");
    const authorized = captured.headRoleId !== undefined
      ? isAuthorizedHeadCouncilActor(context, captured)
      : context.actorId === captured.participantId && context.sessionRef === captured.sessionRef;
    if (!authorized) throw new GitIntegrationError("Actor is not bound to the captured Head identity and session");
    const deptBranch = await client.query<{ repository_path: string; branch_name: string }>("SELECT repository_path, branch_name FROM department_branches WHERE goal_id = $1 AND department_id = $2 FOR KEY SHARE", [council.goalId, departmentId]);
    if (deptBranch.rowCount !== 1) throw new GitIntegrationError("Department branch must exist before a worker worktree");
    const { repository_path: repositoryPath, branch_name: baseBranchName } = deptBranch.rows[0]!;
    const existing = await client.query<{ worktree_path: string; branch_name: string }>("SELECT worktree_path, branch_name FROM worker_worktrees WHERE worker_id = $1 FOR UPDATE", [workerId]);
    if ((existing.rowCount ?? 0) > 0) {
      await client.query("COMMIT"); open = false;
      const row = existing.rows[0]!;
      return { workerId, repositoryPath, worktreePath: row.worktree_path, branchName: row.branch_name, baseBranchName };
    }
    const branchName = `worker/${workerId}`;
    await git.createBranch(repositoryPath, branchName, baseBranchName);
    await git.createWorktree(repositoryPath, worktreePath, branchName);
    await client.query(
      "INSERT INTO worker_worktrees (worker_id, repository_path, worktree_path, branch_name, base_branch_name) VALUES ($1, $2, $3, $4, $5)",
      [workerId, repositoryPath, worktreePath, branchName, baseBranchName],
    );
    await client.query("COMMIT"); open = false;
    return { workerId, repositoryPath, worktreePath, branchName, baseBranchName };
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

/** Records one worker commit already made in its owned worktree. Mission-only changes are the worker's/Head's responsibility; this records the resulting evidence link, append-only. */
export async function recordIntegrationCommit(pool: Pool, workerId: string, commitSha: string, message: string, evidenceReferences: readonly string[]): Promise<IntegrationCommit> {
  if (!/^[0-9a-f]{40}$/.test(commitSha)) throw new GitIntegrationError("commitSha must be a real 40-hex Git object id");
  if (message.trim() === "") throw new GitIntegrationError("Integration commit message is required");
  const worktree = await pool.query("SELECT 1 FROM worker_worktrees WHERE worker_id = $1", [workerId]);
  if (worktree.rowCount !== 1) throw new GitIntegrationNotFoundError(`Worker has no recorded worktree: ${workerId}`);
  const existing = await pool.query<{ commit_sha: string; message: string; evidence_references: string[] }>(
    "SELECT commit_sha, message, evidence_references FROM integration_commits WHERE worker_id = $1 AND commit_sha = $2",
    [workerId, commitSha],
  );
  if ((existing.rowCount ?? 0) > 0) {
    const row = existing.rows[0]!;
    return { workerId, commitSha: row.commit_sha, message: row.message, evidenceReferences: row.evidence_references };
  }
  const inserted = await pool.query<{ commit_sha: string; message: string; evidence_references: string[] }>(
    `INSERT INTO integration_commits (commit_id, worker_id, commit_sha, message, evidence_references) VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING commit_sha, message, evidence_references`,
    [randomUUID(), workerId, commitSha, message.trim(), JSON.stringify(evidenceReferences)],
  );
  const row = inserted.rows[0]!;
  return { workerId, commitSha: row.commit_sha, message: row.message, evidenceReferences: row.evidence_references };
}
