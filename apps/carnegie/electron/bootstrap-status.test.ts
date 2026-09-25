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
});
