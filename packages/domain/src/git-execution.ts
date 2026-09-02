export class GitOperationError extends Error {}

/**
 * A minimal, provider-neutral local Git execution port. No remote push,
 * shared merge, history rewriting, release, or deployment operation is
 * exposed here by construction -- those remain blocked critical actions
 * per plan/phase2.md's Git execution model, point 9.
 */
export interface GitPort {
  createBranch(repositoryPath: string, branchName: string, baseRevision: string): Promise<void>;
  createWorktree(repositoryPath: string, worktreePath: string, branchName: string): Promise<void>;
  /** Atomically advances a local branch only to a descendant of its expected revision. */
  advanceBranch(repositoryPath: string, branchName: string, expectedRevision: string, targetRevision: string): Promise<void>;
  commit(worktreePath: string, message: string, authorName: string, authorEmail: string): Promise<{ commitSha: string }>;
  /** Read HEAD for a worktree, or a named ref when repositoryPath is a repository. */
  headRevision(repositoryPath: string, ref?: string): Promise<string>;
  removeWorktree(repositoryPath: string, worktreePath: string): Promise<void>;
}

export interface GoalIntegrationBranch {
  readonly goalId: string;
  readonly repositoryPath: string;
  readonly branchName: string;
  readonly baseRevision: string;
}

export interface DepartmentBranch {
  readonly goalId: string;
  readonly departmentId: string;
  readonly repositoryPath: string;
  readonly branchName: string;
  readonly baseBranchName: string;
}

export interface WorkerWorktree {
  readonly workerId: string;
  readonly repositoryPath: string;
  readonly worktreePath: string;
  readonly branchName: string;
  readonly baseBranchName: string;
}

export interface IntegrationCommit {
  readonly workerId: string;
  readonly commitSha: string;
  readonly message: string;
  readonly evidenceReferences: readonly string[];
}

/** Immutable snapshot of the actual Goal integration branch used by certification. */
export interface GoalIntegrationRevision {
  readonly revisionId: string;
  readonly revisionNumber: number;
  readonly goalId: string;
  readonly repositoryPath: string;
  readonly branchName: string;
  readonly baseRevision: string;
  readonly commitSha: string;
}
