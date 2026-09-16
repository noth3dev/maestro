import { resolveWorkspace, type Workspace } from "./workspace.js";

export type RetryWorkspaceResolver = (cwd: string) => Promise<Workspace>;

export type RetryWorkspaceResult = { kind: "resolved"; workspace: Workspace } | { kind: "error"; message: string };

export async function resolveRetryWorkspace(
  cwd: string,
  resolver: RetryWorkspaceResolver = resolveWorkspace,
): Promise<RetryWorkspaceResult> {
  try {
    return { kind: "resolved", workspace: await resolver(cwd) };
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : "Workspace could not be resolved" };
  }
}
