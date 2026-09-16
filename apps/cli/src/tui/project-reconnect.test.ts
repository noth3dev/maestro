import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@maestro/api-client";
import type { WorkspaceSession } from "./session.js";
import { reconnectWorkspaceProject } from "./project-reconnect.js";

const session: WorkspaceSession = { workspacePath: "/workspace", projectId: "old-project", model: "model-a" };

describe("workspace project reconnect", () => {
  it("attaches a newly discovered project and persists the updated session", async () => {
    const order: string[] = [];
    let currentSession: WorkspaceSession | undefined = session;
    let syncedSession: WorkspaceSession | undefined;
    const saveSession = vi.fn(async () => {
      order.push("save");
    });
    const syncModelState = vi.fn(() => {
      order.push("sync");
      syncedSession = currentSession;
    });
    const onDiscovered = vi.fn(() => {
      order.push("discovered");
    });
    const client = { listProjects: vi.fn(async () => ({ projects: ["new-project"] })) } as unknown as Pick<ApiClient, "listProjects">;

    await expect(
      reconnectWorkspaceProject({
        workspacePath: session.workspacePath,
        session,
        client,
        saveSession,
        syncModelState,
        onDiscovered,
        onSessionAttached: (nextSession) => {
          order.push("attached");
          currentSession = nextSession;
        },
      }),
    ).resolves.toEqual({
      project: { kind: "attached", projectId: "new-project" },
      session: { workspacePath: "/workspace", projectId: "new-project", model: "model-a" },
    });

    expect(saveSession).toHaveBeenCalledWith({ workspacePath: "/workspace", projectId: "new-project", model: "model-a" });
    expect(syncModelState).toHaveBeenCalledOnce();
    expect(onDiscovered).toHaveBeenCalledWith({ kind: "attached", projectId: "new-project" });
    expect(order).toEqual(["discovered", "attached", "sync", "save"]);
    expect(syncedSession).toEqual({ workspacePath: "/workspace", projectId: "new-project", model: "model-a" });
  });

  it("keeps the attached session visible when persistence fails", async () => {
    const nextSession: WorkspaceSession[] = [];
    const client = { listProjects: vi.fn(async () => ({ projects: ["new-project"] })) } as unknown as Pick<ApiClient, "listProjects">;
    const saveSession = vi.fn(async () => {
      throw new Error("disk full");
    });
    const syncModelState = vi.fn();

    await expect(
      reconnectWorkspaceProject({
        workspacePath: session.workspacePath,
        session,
        client,
        saveSession,
        syncModelState,
        onDiscovered: vi.fn(),
        onSessionAttached: (attached) => nextSession.push(attached),
      }),
    ).rejects.toThrow("disk full");

    expect(nextSession).toEqual([{ workspacePath: "/workspace", projectId: "new-project", model: "model-a" }]);
    expect(syncModelState).toHaveBeenCalledOnce();
  });

  it("returns the discovery notice without persisting when no project is attachable", async () => {
    const saveSession = vi.fn(async () => undefined);
    const client = { listProjects: vi.fn(async () => ({ projects: ["one", "two"] })) } as unknown as Pick<ApiClient, "listProjects">;

    await expect(
      reconnectWorkspaceProject({
        workspacePath: "/workspace",
        session: undefined,
        client,
        saveSession,
        syncModelState: vi.fn(),
        onDiscovered: vi.fn(),
        onSessionAttached: vi.fn(),
      }),
    ).resolves.toEqual({
      project: { kind: "unavailable", reason: "Multiple projects are available; choose one with /session attach --project-index=<1-2>" },
      notice: "Multiple projects are available; choose one with /session attach --project-index=<1-2>",
      session: undefined,
    });
    expect(saveSession).not.toHaveBeenCalled();
  });
});
