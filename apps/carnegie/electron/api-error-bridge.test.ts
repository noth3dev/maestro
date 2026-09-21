import { describe, expect, it } from "vitest";
import { ApiError } from "@maestro/api-client";
import { invokeWithErrorEnvelope, restoreBridgeError } from "./api-error-bridge.js";

describe("Carnegie API IPC error envelope", () => {
  it("preserves stable ApiError fields across the IPC boundary and redacts credentials", async () => {
    const result = await invokeWithErrorEnvelope(() => {
      throw new ApiError(403, "authority_denied", "Not authorized", 'Authorization: Bearer provider-secret {"token":"provider-secret", "access_token":"provider-secret"}');
    });
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "api-error",
        status: 403,
        code: "authority_denied",
        message: "Not authorized",
        detail: 'Authorization: [redacted] {"token":"[redacted]", "access_token":"[redacted]"}', 
      },
    });
    expect(JSON.stringify(result)).not.toContain("provider-secret");
  });

  it("restores a clone-safe serialized ApiError as a structurally classifiable error", () => {
    const error = restoreBridgeError({
      kind: "api-error",
      status: 409,
      code: "version_conflict",
      message: "Version conflict",
      detail: "expected 3, got 2",
    });
    expect(error).toMatchObject({ name: "ApiError", status: 409, code: "version_conflict", detail: "expected 3, got 2" });
  });

  it("normalizes generic failures without exposing arbitrary credential text", async () => {
    const result = await invokeWithErrorEnvelope(() => { throw new Error("token=provider-secret"); });
    expect(result).toEqual({ ok: false, error: { kind: "error", message: "token=[redacted]" } });
    expect(JSON.stringify(result)).not.toContain("provider-secret");
  });
});
