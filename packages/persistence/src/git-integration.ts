import { randomUUID } from "node:crypto";
import type {
  DepartmentBranch,
  GitPort,
  GoalIntegrationBranch,
  GoalIntegrationRevision,
  IntegrationCommit,
  WorkerWorktree,
} from "@maestro/domain";
import type { Pool, PoolClient } from "pg";
import { assertWorkspacePath } from "@maestro/git-adapter";
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
  const canonicalRepositoryPath = assertWorkspacePath(repositoryPath, "repositoryPath");
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
      if (prior.repository_path === canonicalRepositoryPath && prior.branch_name === branchName && prior.base_revision === baseRevision) {
        await client.query("COMMIT"); open = false;
        return { goalId, repositoryPath: canonicalRepositoryPath, branchName, baseRevision };
      }
      throw new GitIntegrationError("A Goal integration branch already exists with different identity");
    }
    await git.createBranch(canonicalRepositoryPath, branchName, baseRevision);
    await client.query(
      "INSERT INTO goal_integration_branches (goal_id, repository_path, branch_name, base_revision) VALUES ($1, $2, $3, $4)",
      [goalId, canonicalRepositoryPath, branchName, baseRevision],
    );
    await client.query("COMMIT"); open = false;
    return { goalId, repositoryPath: canonicalRepositoryPath, branchName, baseRevision };
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

/**
 * Freezes the current Goal integration branch head as the revision that later
 * certifications must use. The SHA is read from Git, never accepted from the
 * caller. Every accepted worker commit is recorded as a member of the frozen
 * revision so a Goal with multiple Departments remains replayable.
 */
export async function recordGoalIntegrationRevision(pool: Pool, git: GitPort, goalId: string, proof: GoalLeaseProof): Promise<GoalIntegrationRevision> {
  if (goalId !== proof.goalId || goalId === "" || proof.ownerId === "" || !isValidFencingToken(proof.fencingToken)) throw new StaleGoalLeaseError(proof.goalId);
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    await lockGoalLease(client, proof);
    const branch = await client.query<{ repository_path: string; branch_name: string; base_revision: string }>(
      "SELECT repository_path, branch_name, base_revision FROM goal_integration_branches WHERE goal_id = $1 FOR SHARE", [goalId],
    );
    if (branch.rowCount !== 1) throw new GitIntegrationError("Goal integration branch must exist before freezing a revision");
    const branchIdentity = branch.rows[0]!;
    const canonicalRepositoryPath = assertWorkspacePath(branchIdentity.repository_path, "repositoryPath");
    const commitSha = (await git.headRevision(canonicalRepositoryPath, branchIdentity.branch_name)).trim();
    if (!/^[0-9a-f]{40}$/.test(commitSha)) throw new GitIntegrationError("Git returned an invalid Goal integration revision SHA");
    if (commitSha === branchIdentity.base_revision) throw new GitIntegrationError("Goal integration branch has no integrated commit to freeze");
    const accepted = await client.query<{ worker_id: string; commit_sha: string }>(
      `SELECT acceptance.worker_id, acceptance.commit_sha
         FROM department_acceptances acceptance
         JOIN workers worker ON worker.worker_id = acceptance.worker_id
         JOIN department_plans plan
           ON plan.council_id = worker.council_id
          AND plan.department_id = worker.department_id
        WHERE plan.goal_id = $1
        ORDER BY acceptance.created_at, acceptance.acceptance_id`, [goalId],
    );
    if (accepted.rowCount === 0) throw new GitIntegrationError("A Goal integration revision requires at least one accepted worker commit");
    const inserted = await client.query<{
      revision_id: string; revision_number: string; goal_id: string; repository_path: string;
      branch_name: string; base_revision: string; commit_sha: string;
    }>(
      `INSERT INTO goal_integration_revisions
         (revision_id, goal_id, repository_path, branch_name, commit_sha, base_revision)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (goal_id, commit_sha) DO NOTHING
       RETURNING revision_id, revision_number, goal_id, repository_path, branch_name, base_revision, commit_sha`,
      [randomUUID(), goalId, canonicalRepositoryPath, branchIdentity.branch_name, commitSha, branchIdentity.base_revision],
    );
    const revisionResult = inserted.rowCount === 1
      ? inserted
      : await client.query<{
        revision_id: string; revision_number: string; goal_id: string; repository_path: string;
        branch_name: string; base_revision: string; commit_sha: string;
      }>(
        `SELECT revision_id, revision_number, goal_id, repository_path, branch_name, base_revision, commit_sha
           FROM goal_integration_revisions
          WHERE goal_id = $1 AND commit_sha = $2`, [goalId, commitSha],
      );
    if (revisionResult.rowCount !== 1) throw new GitIntegrationError("Could not read the frozen Goal integration revision");
    const revision = revisionResult.rows[0]!;
    for (const acceptedCommit of accepted.rows) {
      await client.query(
        `INSERT INTO goal_integration_revision_commits (member_id, revision_id, worker_id, commit_sha)
         VALUES ($1, $2, $3, $4) ON CONFLICT (revision_id, worker_id, commit_sha) DO NOTHING`,
        [randomUUID(), revision.revision_id, acceptedCommit.worker_id, acceptedCommit.commit_sha],
      );
    }
    await client.query("COMMIT"); open = false;
    return {
      revisionId: revision.revision_id,
      revisionNumber: Number(revision.revision_number),
      goalId: revision.goal_id,
      repositoryPath: canonicalRepositoryPath,
      branchName: revision.branch_name,
      baseRevision: revision.base_revision,
      commitSha: revision.commit_sha.trim(),
    };
  } catch (error) {
    if (open) await client.query("ROLLBACK");
    if (error instanceof GitIntegrationError || error instanceof StaleGoalLeaseError) throw error;
    throw new GitIntegrationError(error instanceof Error ? error.message : "Could not freeze Goal integration revision");
  } finally {
    client.release();
  }
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
    const activeParticipation = await client.query(
      `SELECT 1 FROM goal_head_participations
        WHERE goal_id = $1 AND department_id = $2 AND contract_id = $3
          AND head_role_id = $4 AND status = 'active' AND active_session_ref = $5
        FOR SHARE`,
      [council.goalId, departmentId, council.contractId, captured.headRoleId ?? captured.participantId, captured.sessionRef],
    );
    if (activeParticipation.rowCount !== 1) throw new GitIntegrationError("Captured Head session is no longer authorized for Git integration");
    if (council.state !== "resolved" || council.decisionPacket === null || !council.decisionPacket.departmentOwnership.some((ownership) => ownership.departmentId === departmentId)) {
      throw new GitIntegrationError("The Council decision must be resolved and assign ownership to this Department before it may create a Department branch");
    }
    const goalBranch = await client.query<{ repository_path: string; branch_name: string }>("SELECT repository_path, branch_name FROM goal_integration_branches WHERE goal_id = $1 FOR KEY SHARE", [council.goalId]);
    if (goalBranch.rowCount !== 1) throw new GitIntegrationError("Goal integration branch must exist before a Department branch");
    const { repository_path: storedRepositoryPath, branch_name: baseBranchName } = goalBranch.rows[0]!;
    const repositoryPath = assertWorkspacePath(storedRepositoryPath, "repositoryPath");
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
  const canonicalWorktreePath = assertWorkspacePath(worktreePath, "worktreePath");
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
    const activeParticipation = await client.query(
      `SELECT 1 FROM goal_head_participations
        WHERE goal_id = $1 AND department_id = $2 AND contract_id = $3
          AND head_role_id = $4 AND status = 'active' AND active_session_ref = $5
        FOR SHARE`,
      [council.goalId, departmentId, council.contractId, captured.headRoleId ?? captured.participantId, captured.sessionRef],
    );
    if (activeParticipation.rowCount !== 1) throw new GitIntegrationError("Captured Head session is no longer authorized for Git integration");
    const deptBranch = await client.query<{ repository_path: string; branch_name: string }>("SELECT repository_path, branch_name FROM department_branches WHERE goal_id = $1 AND department_id = $2 FOR KEY SHARE", [council.goalId, departmentId]);
    if (deptBranch.rowCount !== 1) throw new GitIntegrationError("Department branch must exist before a worker worktree");
    const { repository_path: storedRepositoryPath, branch_name: baseBranchName } = deptBranch.rows[0]!;
    const repositoryPath = assertWorkspacePath(storedRepositoryPath, "repositoryPath");
    const existing = await client.query<{ worktree_path: string; branch_name: string }>("SELECT worktree_path, branch_name FROM worker_worktrees WHERE worker_id = $1 FOR UPDATE", [workerId]);
    if ((existing.rowCount ?? 0) > 0) {
      await client.query("COMMIT"); open = false;
      const row = existing.rows[0]!;
      const storedWorktreePath = assertWorkspacePath(row.worktree_path, "worktreePath");
      if (storedWorktreePath !== canonicalWorktreePath) throw new GitIntegrationError("Worker worktree already exists at a different path");
      return { workerId, repositoryPath, worktreePath: storedWorktreePath, branchName: row.branch_name, baseBranchName };
    }
    const branchName = `worker/${workerId}`;
    await git.createBranch(repositoryPath, branchName, baseBranchName);
    await git.createWorktree(repositoryPath, canonicalWorktreePath, branchName);
    await client.query(
      "INSERT INTO worker_worktrees (worker_id, repository_path, worktree_path, branch_name, base_branch_name) VALUES ($1, $2, $3, $4, $5)",
      [workerId, repositoryPath, canonicalWorktreePath, branchName, baseBranchName],
    );
    await client.query("COMMIT"); open = false;
    return { workerId, repositoryPath, worktreePath: canonicalWorktreePath, branchName, baseBranchName };
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
