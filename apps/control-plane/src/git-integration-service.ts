import type { ActionRequest } from "@maestro/authority";
import type { DepartmentBranch, GitPort, GoalIntegrationBranch, GoalIntegrationRevision, WorkerWorktree } from "@maestro/domain";
import { assertProjectRole, recordDepartmentBranch, recordGoalIntegrationBranch, recordGoalIntegrationRevision, recordWorkerWorktree, readHeadCouncil, readWorker } from "@maestro/persistence";
import type { Pool } from "pg";

export type GitPortFactory = (context: Omit<ActionRequest, "action" | "target">) => GitPort;
export interface GitIntegrationService {
  createGoalBranch(goalId: string, input: { projectId: string; repositoryPath: string; branchName: string; baseRevision: string }, operatorId: string, commandId: string): Promise<GoalIntegrationBranch>;
  createDepartmentBranch(councilId: string, departmentId: string, projectId: string, operatorId: string, commandId: string): Promise<DepartmentBranch>;
  createWorkerWorktree(workerId: string, input: { projectId: string; worktreePath: string }, operatorId: string, commandId: string): Promise<WorkerWorktree>;
  freezeGoalRevision(goalId: string, projectId: string, operatorId: string, commandId: string): Promise<GoalIntegrationRevision>;
}
export interface GitIntegrationServiceDependencies {
  pool: Pool;
  withGoalLease: <T>(goalId: string, operation: (proof: import("@maestro/persistence").GoalLeaseProof) => Promise<T>) => Promise<T>;
  createGitPort: GitPortFactory;
  getControlEpoch: (projectId: string, goalId: string) => Promise<string>;
}
export class GitProjectMismatchError extends Error { constructor() { super("Git integration project does not match the Goal or Council project"); this.name = "GitProjectMismatchError"; } }

/** Git actions are only reachable after membership, Goal lease, and authority-gateway composition. */
export function createGitIntegrationService(deps: GitIntegrationServiceDependencies): GitIntegrationService {
  async function port(projectId: string, goalId: string, operatorId: string, commandId: string): Promise<GitPort> {
    return deps.createGitPort({ commandId, projectId, actorId: operatorId, goalId, policyVersion: 1, budgetEffectCents: 0, controlEpoch: await deps.getControlEpoch(projectId, goalId) });
  }
  return {
    async createGoalBranch(goalId, input, operatorId, commandId) {
      await assertProjectRole(deps.pool, operatorId, input.projectId, "concertmaster");
      const goal = await deps.pool.query<{ project_id: string; task_contract_id: string | null }>("SELECT project_id, task_contract_id FROM goals WHERE goal_id = $1", [goalId]);
      if (goal.rowCount !== 1 || goal.rows[0]!.project_id !== input.projectId) throw new GitProjectMismatchError();
      if (goal.rows[0]!.task_contract_id === null) throw new GitProjectMismatchError();
      const contract = await deps.pool.query<{ content: { project?: { projectId?: string; repository?: string; immutableBaseRevision?: string } } }>("SELECT content FROM task_contracts WHERE contract_id = $1 AND launch_state = 'launched'", [goal.rows[0]!.task_contract_id]);
      const project = contract.rows[0]?.content.project;
      if (contract.rowCount !== 1 || project?.projectId !== input.projectId || project.repository !== input.repositoryPath || project.immutableBaseRevision !== input.baseRevision || input.branchName !== "goal/integration") {
        throw new GitProjectMismatchError();
      }
      return deps.withGoalLease(goalId, async (proof) => recordGoalIntegrationBranch(deps.pool, await port(input.projectId, goalId, operatorId, commandId), goalId, input.repositoryPath, input.branchName, input.baseRevision, proof));
    },
    async createDepartmentBranch(councilId, departmentId, projectId, operatorId, commandId) {
      await assertProjectRole(deps.pool, operatorId, projectId, `head-${departmentId}`);
      const council = await readHeadCouncil(deps.pool, councilId);
      if (council.snapshot.projectId !== projectId) throw new GitProjectMismatchError();
      return deps.withGoalLease(council.goalId, async (proof) => {
        const git = await port(projectId, council.goalId, operatorId, commandId);
        const participant = council.snapshot.participants.find((entry) => (entry.departmentId ?? entry.participantId) === departmentId);
        if (participant === undefined || participant.headRoleId === undefined) throw new GitProjectMismatchError();
        return recordDepartmentBranch(deps.pool, git, councilId, departmentId, proof, { actorId: participant.headRoleId, sessionRef: participant.sessionRef, commandId });
      });
    },
    async createWorkerWorktree(workerId, input, operatorId, commandId) {
      const worker = await readWorker(deps.pool, workerId);
      const council = await readHeadCouncil(deps.pool, worker.councilId);
      if (council.snapshot.projectId !== input.projectId) throw new GitProjectMismatchError();
      await assertProjectRole(deps.pool, operatorId, input.projectId, `head-${worker.departmentId}`);
      return deps.withGoalLease(council.goalId, async (proof) => {
        const git = await port(input.projectId, council.goalId, operatorId, commandId);
        const participant = council.snapshot.participants.find((entry) => (entry.departmentId ?? entry.participantId) === worker.departmentId);
        if (participant === undefined || participant.headRoleId === undefined) throw new GitProjectMismatchError();
        return recordWorkerWorktree(deps.pool, git, workerId, input.worktreePath, proof, { actorId: participant.headRoleId, sessionRef: participant.sessionRef, commandId });
      });
    },
    async freezeGoalRevision(goalId, projectId, operatorId, commandId) {
      await assertProjectRole(deps.pool, operatorId, projectId, "concertmaster");
      const goal = await deps.pool.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1", [goalId]);
      if (goal.rowCount !== 1 || goal.rows[0]!.project_id !== projectId) throw new GitProjectMismatchError();
      return deps.withGoalLease(goalId, async (proof) => recordGoalIntegrationRevision(deps.pool, await port(projectId, goalId, operatorId, commandId), goalId, proof));
    },
  };
}
