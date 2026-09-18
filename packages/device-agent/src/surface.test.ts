import { describe, expect, it } from "vitest";

describe("device-agent surface", () => {
  it("pins the barrel export list", async () => {
    const surface = await import("./index.js");
    expect(Object.keys(surface).sort()).toMatchInlineSnapshot(`
      [
        "DeviceFenceState",
        "DeviceFileScopeError",
        "LocalDeviceGrantDeniedError",
        "assertLocallyExecutableDeviceGrant",
        "canonicalDeviceGrantEnvelope",
        "createBoundedProjectFileReader",
        "createDeviceAgentServer",
        "signDeviceGrantEnvelope",
        "verifyDeviceGrantEnvelope",
      ]
    `);
  });
});
