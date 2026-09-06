import { realpath } from "node:fs/promises";
import { join, dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface Workspace {
  cwd: string;
  gitRoot?: string;
}

export async function resolveWorkspace(cwd: string): Promise<Workspace> {
  const resolvedCwd = await realpath(cwd);
  try {
    const { stdout } = await execFileAsync("git", ["-C", resolvedCwd, "rev-parse", "--show-toplevel"]);
    return { cwd: resolvedCwd, gitRoot: await realpath(stdout.trim()) };
  } catch {
    return { cwd: resolvedCwd };
  }
}

export function parentDirectory(path: string): string {
  return dirname(path) || join(path, "..");
}
