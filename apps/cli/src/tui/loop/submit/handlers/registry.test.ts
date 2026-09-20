import { describe, expect, it, vi } from "vitest";
import { handleRegistryCommand } from "./registry.js";

const { executeReadCommand } = vi.hoisted(() => ({ executeReadCommand: vi.fn() }));
vi.mock("../../../commands/read-commands.js", () => ({ executeReadCommand }));

describe("registry command Goal context", () => {
  it("uses the dashboard-selected Goal when the persisted session has no Goal", async () => {
    executeReadCommand.mockResolvedValue({ title: "Channels", lines: [] });
    const view = { append: vi.fn() };
    const client = {};
    const controller = {
      client,
      project: { kind: "attached", projectId: "project-1" },
      session: undefined,
      state: { goal: { kind: "value", value: { goalId: "goal-1", name: "goal-1", state: "draft" } } },
      registry: { find: vi.fn(() => ({ actions: [{ name: "list", kind: "read" }] })) },
      view,
    };

    await handleRegistryCommand(controller as never, { kind: "command", name: "channel", action: "list", options: {} } as never);

    expect(executeReadCommand).toHaveBeenCalledWith(
      { client, projectId: "project-1", goalId: "goal-1" },
      expect.objectContaining({ name: "channel", action: "list" }),
    );
    expect(view.append).toHaveBeenCalledWith("Channels: ");
  });
});
  it("routes a sidebar read result into the destination page without appending transcript text", async () => {
    executeReadCommand.mockResolvedValue({ title: "Billing", lines: ["Daily spend"] });
    const view = { append: vi.fn(), setMainPageResult: vi.fn() };
    const controller = {
      client: {},
      project: { kind: "attached", projectId: "project-1" },
      session: undefined,
      state: { goal: { kind: "value", value: { goalId: "goal-1", name: "goal-1", state: "draft" } } },
      registry: { find: vi.fn(() => ({ actions: [{ name: "get", kind: "read" }] })) },
      view,
    };

    await handleRegistryCommand(controller as never, { kind: "command", name: "billing", action: "get", options: {} } as never, {
      readViewId: "billing",
      readViewGeneration: 7,
    });

    expect(view.setMainPageResult).toHaveBeenCalledWith("billing", { title: "Billing", lines: ["Daily spend"] }, 7);
    expect(view.append).not.toHaveBeenCalled();
  });
