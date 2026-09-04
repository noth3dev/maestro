import { spawn } from "node:child_process";
import { GitOperationError } from "@maestro/domain";
import { assertWorkspacePath } from "./path-containment.js";

/** Runs one Git command with an explicit argument array. Never through a shell; no string interpolation into a command line. */
function runGit(args: readonly string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => reject(new GitOperationError(`git ${args.join(" ")} failed to start: ${error.message}`)));
    child.on("close", (code) => {
      if (code !== 0) reject(new GitOperationError(`git ${args.join(" ")} exited ${code}: ${stderr.trim()}`));
      else resolve(stdout.trim());
    });
  });
}

export async function createBranch(repositoryPath: string, branchName: string, baseRevision: string): Promise<void> {
  const canonicalRepositoryPath = assertWorkspacePath(repositoryPath, "repositoryPath");
  await runGit(["branch", "--", branchName, baseRevision], canonicalRepositoryPath);
}

export async function createWorktree(repositoryPath: string, worktreePath: string, branchName: string): Promise<void> {
  const canonicalRepositoryPath = assertWorkspacePath(repositoryPath, "repositoryPath");
  const canonicalWorktreePath = assertWorkspacePath(worktreePath, "worktreePath");
  await runGit(["worktree", "add", "--", canonicalWorktreePath, branchName], canonicalRepositoryPath);
}

/** Advances a local branch atomically, only when target descends from its expected current revision. */
export async function advanceBranch(repositoryPath: string, branchName: string, expectedRevision: string, targetRevision: string): Promise<void> {
  const canonicalRepositoryPath = assertWorkspacePath(repositoryPath, "repositoryPath");
  if (expectedRevision === targetRevision) throw new GitOperationError("Branch target must advance beyond its expected revision");
  await runGit(["merge-base", "--is-ancestor", expectedRevision, targetRevision], canonicalRepositoryPath);
  await runGit(["update-ref", `refs/heads/${branchName}`, targetRevision, expectedRevision], canonicalRepositoryPath);
}

export async function commit(worktreePath: string, message: string, authorName: string, authorEmail: string): Promise<{ commitSha: string }> {
  const canonicalWorktreePath = assertWorkspacePath(worktreePath, "worktreePath");
  await runGit(["add", "-A"], canonicalWorktreePath);
  await runGit(["-c", `user.name=${authorName}`, "-c", `user.email=${authorEmail}`, "commit", "-m", message], canonicalWorktreePath);
  const commitSha = await runGit(["rev-parse", "HEAD"], canonicalWorktreePath);
  return { commitSha };
}

export async function headRevision(repositoryPath: string, ref = "HEAD"): Promise<string> {
  const canonicalRepositoryPath = assertWorkspacePath(repositoryPath, "repositoryPath");
  return runGit(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`], canonicalRepositoryPath);
}

export async function removeWorktree(repositoryPath: string, worktreePath: string): Promise<void> {
  const canonicalRepositoryPath = assertWorkspacePath(repositoryPath, "repositoryPath");
  const canonicalWorktreePath = assertWorkspacePath(worktreePath, "worktreePath");
  await runGit(["worktree", "remove", "--force", "--", canonicalWorktreePath], canonicalRepositoryPath);
}

export const localGitPort = { createBranch, createWorktree, advanceBranch, commit, headRevision, removeWorktree };
