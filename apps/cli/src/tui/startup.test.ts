import { describe, expect, it } from "vitest";
import { hydrateOrganizationState, shouldAutoBootstrapLocal } from "./startup.js";

describe("shouldAutoBootstrapLocal", () => {
  it("allows local startup when no endpoint or token is configured", () => {
    expect(shouldAutoBootstrapLocal({})).toBe(true);
  });

  it("does not auto-start when an endpoint or token is configured", () => {
    expect(shouldAutoBootstrapLocal({ MAESTRO_API_URL: "http://127.0.0.1:4310" })).toBe(false);
    expect(shouldAutoBootstrapLocal({ MAESTRO_API_TOKEN: "token" })).toBe(false);
  });

  it("honors the explicit disable switch", () => {
    expect(shouldAutoBootstrapLocal({ MAESTRO_DISABLE_LOCAL_AUTOSTART: "true" })).toBe(false);
  });
});

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
