import { describe, expect, it } from "vitest";
import { hydrateOrganizationState } from "./startup.js";

describe("TUI startup organization hydration", () => {
  it("maps the authenticated organization taxonomy into the visible Department Head roster", async () => {
    const state = await hydrateOrganizationState({
      getOrganization: async () => ({
        groups: [{ groupId: "product", displayName: "Product Group" }],
        departments: [{ departmentId: "product", groupId: "product", displayName: "Product Department", status: "sleeping", activeSessionId: null, goalContext: null }],
      }),
    });
    expect(state).toEqual({ kind: "value", value: { departments: ["Product Department"] } });
  });

  it("keeps organization read failures explicit without hiding the rest of startup", async () => {
    await expect(hydrateOrganizationState({ getOrganization: async () => { throw new Error("organization unavailable"); } })).resolves.toEqual({ kind: "error", message: "organization unavailable" });
  });
});
