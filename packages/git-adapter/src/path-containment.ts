import { realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { GitOperationError } from "@maestro/domain";

const WORKTREE_ROOT_ENV = "MAESTRO_WORKTREE_ROOT";

/**
 * Resolves an existing path and the existing ancestors of a not-yet-created
 * path, so symlinks cannot bypass the configured workspace root.
 */
function canonicalizePath(inputPath: string, label: string): string {
  if (inputPath.trim() === "" || inputPath.includes("\0")) {
    throw new GitOperationError(`${label} must be a non-empty path`);
  }

  let candidate = resolve(inputPath);
  const missingSegments: string[] = [];
  while (true) {
    try {
      const existing = realpathSync.native(candidate);
      return missingSegments.length === 0 ? existing : resolve(existing, ...missingSegments);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
        throw new GitOperationError(`Could not resolve ${label}: ${error instanceof Error ? error.message : "unknown error"}`);
      }
      const parent = dirname(candidate);
      if (parent === candidate) {
        throw new GitOperationError(`Could not resolve ${label}`);
      }
      missingSegments.unshift(basename(candidate));
      candidate = parent;
    }
  }
}

function configuredWorkspaceRoot(workspaceRoot?: string): string {
  const configuredRoot = (workspaceRoot ?? process.env[WORKTREE_ROOT_ENV])?.trim();
  if (configuredRoot === undefined || configuredRoot === "") {
    throw new GitOperationError(`${WORKTREE_ROOT_ENV} must be configured before Git operations`);
  }

  const root = canonicalizePath(configuredRoot, "workspace root");
  try {
    if (!statSync(root).isDirectory()) throw new Error("is not a directory");
  } catch (error) {
    throw new GitOperationError(`Configured workspace root is invalid: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  return root;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath));
}

/** Returns the canonical path only when it is contained by MAESTRO_WORKTREE_ROOT. */
export function assertWorkspacePath(inputPath: string, label = "Git path", workspaceRoot?: string): string {
  const root = configuredWorkspaceRoot(workspaceRoot);
  const candidate = canonicalizePath(inputPath, label);
  if (!isWithinRoot(root, candidate)) {
    throw new GitOperationError(`${label} is outside configured workspace root`);
  }
  return candidate;
}


/** Returns the canonical path only when it is contained by one declared Goal scope. */
export function assertGoalScopedWorkspacePath(inputPath: string, label = "Git path", workspaceRoot?: string, pathScope?: readonly string[]): string {
  const candidate = assertWorkspacePath(inputPath, label, workspaceRoot);
  if (pathScope === undefined) return candidate;
  if (pathScope.length === 0) throw new GitOperationError(`${label} is outside the Goal path scope`);
  const allowed = pathScope.some((scope) => {
    if (typeof scope !== "string" || scope.trim() === "") return false;
    try { return isWithinRoot(canonicalizePath(scope, "Goal path scope"), candidate); }
    catch { return false; }
  });
  if (!allowed) throw new GitOperationError(`${label} is outside the Goal path scope`);
  return candidate;
}
