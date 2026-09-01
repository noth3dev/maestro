import { spawn } from "node:child_process";
import { GitOperationError } from "@maestro/domain";

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
  await runGit(["branch", "--", branchName, baseRevision], repositoryPath);
}

export async function createWorktree(repositoryPath: string, worktreePath: string, branchName: string): Promise<void> {
  await runGit(["worktree", "add", "--", worktreePath, branchName], repositoryPath);
}

export async function commit(worktreePath: string, message: string, authorName: string, authorEmail: string): Promise<{ commitSha: string }> {
  await runGit(["add", "-A"], worktreePath);
  await runGit(["-c", `user.name=${authorName}`, "-c", `user.email=${authorEmail}`, "commit", "-m", message], worktreePath);
  const commitSha = await runGit(["rev-parse", "HEAD"], worktreePath);
  return { commitSha };
}

export async function headRevision(worktreePath: string): Promise<string> {
  return runGit(["rev-parse", "HEAD"], worktreePath);
}

export async function removeWorktree(repositoryPath: string, worktreePath: string): Promise<void> {
  await runGit(["worktree", "remove", "--force", "--", worktreePath], repositoryPath);
}

export const localGitPort = { createBranch, createWorktree, commit, headRevision, removeWorktree };
