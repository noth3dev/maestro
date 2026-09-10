import { describe, expect, it } from "vitest";
import { EXTERNAL_CAPABILITY_KINDS, isExternalCapabilityKind, type ExternalCapabilityKind } from "./external-capability.js";

describe("external capability activation contract", () => {
  it("exposes only independently activatable external capability kinds", () => {
    expect(EXTERNAL_CAPABILITY_KINDS).toEqual(["browser", "device", "external-service", "deployment"]);
    expect(isExternalCapabilityKind("browser")).toBe(true);
    expect(isExternalCapabilityKind("ipython")).toBe(false);
    const kind: ExternalCapabilityKind = "device";
    expect(kind).toBe("device");
  });
});
