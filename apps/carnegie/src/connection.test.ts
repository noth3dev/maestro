import { describe, expect, it } from "vitest";
import { readConnectionState, classifySessionRecovery, sessionRecoveryForConnectionState } from "./connection.js";

describe("readConnectionState", () => {
  it("keeps saved config from masking a retryable local bootstrap failure", async () => {
    const credential = ["session", "private-value"].join("-");
    const state = await readConnectionState({
      config: {
        get: async () => ({ apiUrl: "http://127.0.0.1:4310", projectId: "saved-project" }),
        error: async () => undefined,
      },
      bootstrap: {
        status: async () => ({
          phase: "setup-required" as const,
          reason: `Docker unavailable. Bearer ${credential}`,
          canRetryLocal: true,
        }),
      },
    });

    expect(state.config).toBeUndefined();
    expect(state.setupError).toBe("Docker unavailable. Bearer [redacted]");
    expect(sessionRecoveryForConnectionState(state)).toBeUndefined();
  });

  it("keeps showing bootstrap progress when the stale saved config cannot be read", async () => {
    const state = await readConnectionState({
      config: {
        get: async () => {
          throw new Error("Stored control-plane token is unavailable");
        },
        error: async () => undefined,
      },
      bootstrap: {
        status: async () => ({ phase: "starting" as const }),
      },
    });

    expect(state).toEqual({
      config: undefined,
      setupError: undefined,
      bootstrap: { phase: "starting" },
    });
  });
});


describe("classifySessionRecovery", () => {
  it("gives invalid sessions a re-authentication action", () => {
    expect(classifySessionRecovery(Object.assign(new Error("session is invalid"), { status: 401 }))).toEqual({
      kind: "invalid-session", action: "sign-in-again", message: "Your session is invalid. Sign in again.",
    });
  });
  it("keeps generic API 401 recovery distinct", () => {
    expect(classifySessionRecovery(Object.assign(new Error("Authentication is required"), { status: 401 }))).toEqual({
      kind: "unauthorized", action: "reconnect", message: "The Control Plane rejected this session. Reconnect to continue.",
    });
  });
  it("distinguishes durable store failures without echoing credentials", () => {
    const credential = ["super", "secret"].join("-");
    const failure = new Error(`Stored control-plane token is unavailable: Bearer ${credential}`);
    expect(classifySessionRecovery(failure)).toEqual({
      kind: "durable-store-unavailable", action: "repair-storage", message: "The saved session could not be read. Repair or reconnect the local session.",
    });
    expect(JSON.stringify(classifySessionRecovery(failure))).not.toContain(credential);
  });
  it("uses a retry action for a reconnectable failure", () => {
    expect(classifySessionRecovery(new Error("Control plane request failed"))).toEqual({
      kind: "reconnect-required", action: "retry", message: "The Control Plane is unreachable. Retry the connection.",
    });
  });
});
