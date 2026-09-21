import { describe, expect, it } from "vitest";
import { bootstrapProgressText } from "./bootstrap-status.js";

describe("bootstrapProgressText", () => {
  it("names the active bootstrap step when the event has no message", () => {
    expect(bootstrapProgressText({ phase: "starting", step: { step: "migrations", status: "started" } })).toBe("running database migrations…");
  });

  it("preserves a real bootstrap message", () => {
    expect(bootstrapProgressText({ phase: "starting", step: { step: "control-plane-up", status: "failed", message: "Control Plane binary was not found" } })).toBe("Control Plane binary was not found");
  });

  it("shows the startup fallback before the first step arrives", () => {
    expect(bootstrapProgressText({ phase: "starting" })).toBe("preparing the local Control Plane…");
  });
});
