import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@maestro/api-client";
import { parseInput } from "./parser.js";
import { dispatchInteractiveWriteCommand } from "./interactive-dispatch.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const operatorId = "44444444-4444-4444-8444-444444444444";

describe("interactive command dispatch", () => {
  it("submits parsed admin project-access through the typed client after confirmation", async () => {
    const provisionProjectAccess = vi.fn().mockResolvedValue({ projectId, operatorId, roles: ["head-product"] });
    const client = { provisionProjectAccess } as unknown as ApiClient;
    const command = parseInput(`/admin project-access --operator-id ${operatorId} --roles-json '["head-product"]'`);
    if (command.kind !== "command") throw new Error("expected a parsed command");
    const confirm = vi.fn().mockResolvedValue("approved" as const);

    await expect(dispatchInteractiveWriteCommand({ client, projectId, confirm }, command)).resolves.toEqual({
      title: "Project access", lines: [JSON.stringify({ projectId, operatorId, roles: ["head-product"] })],
    });
    expect(confirm).toHaveBeenCalledOnce();
    expect(provisionProjectAccess).toHaveBeenCalledWith({ projectId, operatorId, roles: ["head-product"] });
  });
});
