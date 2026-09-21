import { describe, expect, it } from "vitest";
import { StableApiErrorCodeSchema } from "@maestro/contracts";
import { ApiError } from "@maestro/api-client";
import { classifyApiError, newCommandId } from "./command-id.js";

describe("newCommandId", () => {
  it("returns a fresh v4 UUID each call", () => {
    const first = newCommandId();
    const second = newCommandId();
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});

describe("classifyApiError", () => {
  it("treats a stale-version conflict as retryable", () => {
    const result = classifyApiError(new ApiError(409, "version_conflict", "Version conflict", "expected 3, got 2"));
    expect(result.retryable).toBe(true);
    expect(result.detail).toBe("expected 3, got 2");
  });

  it("treats authority denial as non-retryable until an approval happens", () => {
    const result = classifyApiError(new ApiError(403, "authority_denied", "Not authorized"));
    expect(result.retryable).toBe(false);
    expect(result.title).toBe("Not authorized");
  });

  it("treats critical-action-requires-approval as an actionable non-retry state", () => {
    const result = classifyApiError(new ApiError(409, "critical_action_requires_approval", "Requires approval"));
    expect(result.retryable).toBe(false);
  });

  it("treats a missing connection as an actionable, non-retryable error", () => {
    const result = classifyApiError(new Error("Not connected to a control plane yet"));
    expect(result.retryable).toBe(false);
    expect(result.title).toBe("Not connected");
  });

  it("treats a generic network failure as retryable", () => {
    const result = classifyApiError(new Error("Control plane request failed"));
    expect(result.retryable).toBe(true);
  });

  it("falls back to a stable unknown-error shape for a non-Error throw", () => {
    const result = classifyApiError("boom");
    expect(result).toEqual({ title: "Unexpected error", detail: "An unknown error occurred.", retryable: true });
  });
});


it("extracts stable status/code from a clone-safe IPC error", () => {
  expect(classifyApiError({ name: "ApiError", status: 403, code: "authority_denied", message: "Not authorized" })).toEqual({
    title: "Not authorized",
    detail: "Not authorized",
    retryable: false,
  });
});

it("redacts bearer and token values before they become renderer detail", () => {
  const result = classifyApiError({ name: "ApiError", status: 500, code: "provider_unavailable", message: "token=provider-secret" });
  expect(result.detail).toBe("token=[redacted]");
  expect(result.detail).not.toContain("provider-secret");
  expect(classifyApiError({ name: "ApiError", status: 500, code: "provider_unavailable", message: '{"access_token":"provider-secret"}' }).detail)
    .toBe('{"access_token":"[redacted]"}');
});


it("assigns a stable title to every contract error code", () => {
  for (const code of StableApiErrorCodeSchema.options) {
    expect(classifyApiError({ name: "ApiError", status: 400, code, message: "failure" }).title, code).not.toBe("Request failed");
  }
});
