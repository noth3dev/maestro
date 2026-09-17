import { z } from "zod";
import { UuidSchema } from "./common.js";

export const GoalIntegrationBranchInputSchema = z
  .object({ projectId: UuidSchema, repositoryPath: z.string().min(1), branchName: z.string().min(1), baseRevision: z.string().min(1) })
  .strict();
export type GoalIntegrationBranchInput = z.infer<typeof GoalIntegrationBranchInputSchema>;
export const DepartmentBranchInputSchema = z.object({ projectId: UuidSchema }).strict();
export type DepartmentBranchInput = z.infer<typeof DepartmentBranchInputSchema>;
export const WorkerWorktreeInputSchema = z
  .object({ projectId: UuidSchema, worktreePath: z.string().min(1), repositoryPath: z.string().min(1).max(4_096).optional() })
  .strict();
export type WorkerWorktreeInput = z.infer<typeof WorkerWorktreeInputSchema>;
export const GoalIntegrationRevisionSchema = z
  .object({
    revisionId: UuidSchema,
    revisionNumber: z.number().int().positive(),
    goalId: UuidSchema,
    repositoryPath: z.string().min(1),
    branchName: z.string().min(1),
    baseRevision: z.string().min(1),
    commitSha: z.string().regex(/^[0-9a-f]{40}$/),
  })
  .strict();
export type GoalIntegrationRevision = z.infer<typeof GoalIntegrationRevisionSchema>;
export const GoalIntegrationBranchSchema = z
  .object({ goalId: UuidSchema, repositoryPath: z.string().min(1), branchName: z.string().min(1), baseRevision: z.string().min(1) })
  .strict();
export type GoalIntegrationBranch = z.infer<typeof GoalIntegrationBranchSchema>;
export const DepartmentBranchSchema = z
  .object({
    goalId: UuidSchema,
    departmentId: z.string().min(1),
    repositoryPath: z.string().min(1),
    branchName: z.string().min(1),
    baseBranchName: z.string().min(1),
  })
  .strict();
export type DepartmentBranch = z.infer<typeof DepartmentBranchSchema>;
export const GoalGitIntegrationStateSchema = z
  .object({ goalId: UuidSchema, branch: GoalIntegrationBranchSchema.nullable(), latestRevision: GoalIntegrationRevisionSchema.nullable() })
  .strict();
export type GoalGitIntegrationState = z.infer<typeof GoalGitIntegrationStateSchema>;
export const WorkerWorktreeSchema = z
  .object({
    workerId: UuidSchema,
    repositoryPath: z.string().min(1),
    worktreePath: z.string().min(1),
    branchName: z.string().min(1),
    baseBranchName: z.string().min(1),
  })
  .strict();
export type WorkerWorktree = z.infer<typeof WorkerWorktreeSchema>;
export const IntegrationCommitSchema = z
  .object({
    workerId: UuidSchema,
    commitSha: z.string().regex(/^[a-f0-9]{40}$/),
    message: z.string().min(1),
    evidenceReferences: z.array(z.string().min(1)).readonly(),
  })
  .strict();
export type IntegrationCommit = z.infer<typeof IntegrationCommitSchema>;
