import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import type { ActionRequest, AuthorityDecision } from "@maestro/authority";
import { GitOperationError, type GitPort } from "@maestro/domain";
import { assertWorkspacePath } from "./path-containment.js";

/** The authority boundary required before any local Git process is started. */
export interface GitAuthorityGateway {
  execute(request: ActionRequest, effect: () => Promise<unknown>): Promise<AuthorityDecision>;
}

/** Immutable authority fields captured for one Git port instance. */
export type GitAuthorityContext = Omit<ActionRequest, "action" | "target">;

export interface LocalGitPortOptions {
  readonly authority: GitAuthorityGateway;
  readonly context: GitAuthorityContext;
  /** Explicit root from the validated application configuration. */
  readonly workspaceRoot?: string;
}

const TRUSTED_GIT_EXECUTABLE = "/usr/bin/git";
const GIT_TIMEOUT_MS = 30_000;
const MAX_GIT_OUTPUT_BYTES = 1_048_576;

export class GitAuthorizationError extends GitOperationError {
  readonly decision: AuthorityDecision;

  constructor(decision: AuthorityDecision) {
    super(`Git operation not authorized: ${decision.reason}`);
    this.name = "GitAuthorizationError";
    this.decision = decision;
  }
}

/**
 * Runs one Git command with an explicit argument array and a minimal environment.
 * Never through a shell; no string interpolation into a command line. The
 * timeout/output cap prevent a repository or hook from pinning the process.
 */
function runGit(args: readonly string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let executable: string;
    try { executable = realpathSync.native(TRUSTED_GIT_EXECUTABLE); }
    catch { reject(new GitOperationError("Trusted Git executable is unavailable")); return; }
    const child = spawn(executable, args, {
      cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: "/usr/bin:/bin",
        HOME: "/nonexistent",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;
    const finish = (callback: () => void) => { if (!settled) { settled = true; clearTimeout(timer); callback(); } };
    const terminate = () => { try { process.kill(-child.pid!, "SIGKILL"); } catch { child.kill("SIGKILL"); } };
    const timer = setTimeout(() => finish(() => { terminate(); reject(new GitOperationError(`git ${args.join(" ")} timed out`)); }), GIT_TIMEOUT_MS);
    const read = (kind: "stdout" | "stderr", chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_GIT_OUTPUT_BYTES) {
        finish(() => { terminate(); reject(new GitOperationError(`git ${args.join(" ")} produced too much output`)); });
        return;
      }
      if (kind === "stdout") stdout += chunk.toString("utf8"); else stderr += chunk.toString("utf8");
    };
    child.stdout.on("data", (chunk: Buffer) => read("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => read("stderr", chunk));
    child.on("error", (error) => finish(() => reject(new GitOperationError(`git ${args.join(" ")} failed to start: ${error.message}`))));
    child.on("close", (code) => finish(() => {
      if (code !== 0) reject(new GitOperationError(`git ${args.join(" ")} exited ${code}: ${stderr.trim()}`));
      else resolve(stdout.trim());
    }));
  });
}

async function authorized<T>(
  authority: GitAuthorityGateway,
  context: GitAuthorityContext,
  action: string,
  target: string,
  effect: () => Promise<T>,
): Promise<T> {
  let invoked = false;
  let result: T | undefined;
  const decision = await authority.execute(
    { ...context, action, target },
    async () => {
      invoked = true;
      result = await effect();
    },
  );
  if (decision.effect !== "allow") throw new GitAuthorizationError(decision);
  if (!invoked) throw new GitOperationError("Git authority allowed without invoking the effect");
  return result as T;
}

function target(...parts: readonly string[]): string {
  // Encode operation fields without delimiter ambiguity so an exact authority
  // grant for one repository/branch tuple cannot match another tuple.
  return JSON.stringify(parts);
}

/**
 * Construct the only production Git port. Every operation is classified and
 * executed through the supplied AuthorizedEffectExecutor-compatible gateway;
 * this module intentionally exposes no unauthenticated Git operation.
 */
export function createLocalGitPort(options: LocalGitPortOptions): GitPort {
  const { authority, context, workspaceRoot } = options;
  return {
    async createBranch(repositoryPath: string, branchName: string, baseRevision: string): Promise<void> {
      const repository = assertWorkspacePath(repositoryPath, "repositoryPath", workspaceRoot);
      await authorized(authority, context, "git.local.branch.create", target(repository, branchName, baseRevision), () =>
        runGit(["branch", "--", branchName, baseRevision], repository).then(() => undefined));
    },

    async createWorktree(repositoryPath: string, worktreePath: string, branchName: string): Promise<void> {
      const repository = assertWorkspacePath(repositoryPath, "repositoryPath", workspaceRoot);
      const worktree = assertWorkspacePath(worktreePath, "worktreePath", workspaceRoot);
      await authorized(authority, context, "git.local.worktree.create", target(repository, worktree, branchName), () =>
        runGit(["worktree", "add", "--", worktree, branchName], repository).then(() => undefined));
    },

    /** Advances a local branch atomically, only when target descends from its expected current revision. */
    async advanceBranch(repositoryPath: string, branchName: string, expectedRevision: string, targetRevision: string): Promise<void> {
      const repository = assertWorkspacePath(repositoryPath, "repositoryPath", workspaceRoot);
      if (expectedRevision === targetRevision) throw new GitOperationError("Branch target must advance beyond its expected revision");
      await authorized(authority, context, "git.local.branch.advance", target(repository, branchName, expectedRevision, targetRevision), async () => {
        await runGit(["merge-base", "--is-ancestor", expectedRevision, targetRevision], repository);
        await runGit(["update-ref", `refs/heads/${branchName}`, targetRevision, expectedRevision], repository);
      });
    },

    async commit(worktreePath: string, message: string, authorName: string, authorEmail: string): Promise<{ commitSha: string }> {
      const worktree = assertWorkspacePath(worktreePath, "worktreePath", workspaceRoot);
      return authorized(authority, context, "git.local.commit", target(worktree, message, authorName, authorEmail), async () => {
        await runGit(["add", "-A"], worktree);
        await runGit(["-c", `user.name=${authorName}`, "-c", `user.email=${authorEmail}`, "commit", "--no-verify", "-m", message], worktree);
        const commitSha = await runGit(["rev-parse", "HEAD"], worktree);
        return { commitSha };
      });
    },

    async headRevision(repositoryPath: string, ref = "HEAD"): Promise<string> {
      const repository = assertWorkspacePath(repositoryPath, "repositoryPath", workspaceRoot);
      return authorized(authority, context, "git.local.revision.read", target(repository, ref), () =>
        runGit(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`], repository));
    },

    async removeWorktree(repositoryPath: string, worktreePath: string): Promise<void> {
      const repository = assertWorkspacePath(repositoryPath, "repositoryPath", workspaceRoot);
      const worktree = assertWorkspacePath(worktreePath, "worktreePath", workspaceRoot);
      await authorized(authority, context, "git.local.worktree.remove", target(repository, worktree), () =>
        runGit(["worktree", "remove", "--force", "--", worktree], repository).then(() => undefined));
    },
  };
}
