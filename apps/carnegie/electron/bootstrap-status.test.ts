import { describe, expect, it } from "vitest";
import { sanitizeBootstrapStatus } from "./bootstrap-status.js";

describe("sanitizeBootstrapStatus", () => {
  it("redacts credential-shaped values from setup reasons before IPC", () => {
    const credential = ["bootstrap", "private-token"].join("-");
    expect(
      sanitizeBootstrapStatus({
        phase: "setup-required",
        reason: `Docker is unavailable. Bearer ${credential}`,
        canRetryLocal: true,
      }),
    ).toEqual({
      phase: "setup-required",
      reason: "Docker is unavailable. Bearer [redacted]",
      canRetryLocal: true,
    });
  });

  it("redacts credential-shaped values from progress messages before IPC", () => {
    const credential = ["bootstrap", "private-token"].join("-");
    expect(
      sanitizeBootstrapStatus({
        phase: "starting",
        step: { step: "control-plane-up", status: "failed", message: `token=${credential}` },
      }),
    ).toEqual({
      phase: "starting",
      step: { step: "control-plane-up", status: "failed", message: "token=[redacted]" },
    });
  });

  it("replaces oversized database-lock diagnostics with a safe recovery summary", () => {
    const diagnostic = `PGlite database mutex could not be acquired: ${"x".repeat(65_598)}`;
    const status = sanitizeBootstrapStatus({ phase: "setup-required", reason: diagnostic });
    expect(status).toEqual({
      phase: "setup-required",
      reason: "The local database may be busy or locked. Close other Maestro instances, then retry local setup.",
    });
    expect(JSON.stringify(status)).not.toContain("x".repeat(128));
  });

  it("replaces oversized unknown diagnostics with a concise safe summary", () => {
    const diagnostic = `Unknown startup failure: ${"x".repeat(65_598)}`;
    const status = sanitizeBootstrapStatus({ phase: "setup-required", reason: diagnostic });
    expect(status).toEqual({
      phase: "setup-required",
      reason: "Local setup failed. The diagnostic is too long to display; retry local setup or use Manual connection below.",
    });
    expect(JSON.stringify(status)).not.toContain("x".repeat(128));
  });
});
