import { describe, expect, it, vi } from "vitest";
import { ModelGatewayClientError } from "./model-gateway-client.js";
import type { AccountLoginStore } from "@maestro/persistence";
import {
  cancelAccountLoginFlow,
  pollAccountLoginStatus,
  startAccountLoginFlow,
  waitForAccountLoginStart,
  withLoginOperation,
  type AccountLoginFlowDeps,
  type AccountLoginIdentity,
} from "./account-login-flow.js";

const identity: AccountLoginIdentity = { operatorId: "operator-1", loginId: "durable-login-1", providerId: "openai-codex", requestId: "request-1" };
const base = { loginId: "durable-login-1", requestId: "request-1", operatorId: "operator-1", ownerId: "control-plane-test", providerId: "openai-codex" as const, providerLoginId: "provider-login-1", authUrl: "https://chatgpt.com/login" };

function depsFor(record: unknown, overrides: Record<string, unknown> = {}): AccountLoginFlowDeps {
  const store = {
    reserveStart: vi.fn(), completeStart: vi.fn(), failStart: vi.fn(),
    get: vi.fn(async () => record), getByRequest: vi.fn(), updateState: vi.fn(async () => record),
    claimOperation: vi.fn(async () => "operation-token"), releaseOperation: vi.fn(async () => {}), recoverStarting: vi.fn(async () => 0),
    ...overrides,
  } as unknown as AccountLoginStore;
  return { store, ownerId: "control-plane-test", staleAfterMs: 30_000 };
}

describe("withLoginOperation", () => {
  it("rejects unknown sessions and provider mismatches at load", async () => {
    const gateway = { accountLoginStatus: vi.fn() };
    await expect(pollAccountLoginStatus(depsFor(undefined), gateway, identity)).rejects.toThrow("account login session is unknown");
    const mismatch = { ...base, providerId: "other" as string, state: "pending" as const, message: null };
    await expect(pollAccountLoginStatus(depsFor(mismatch), gateway, identity)).rejects.toThrow("account login session is unknown");
    expect(gateway.accountLoginStatus).not.toHaveBeenCalled();
  });

  it("releases the claim when the gateway run throws", async () => {
    const pending = { ...base, state: "pending" as const, message: null };
    const releaseOperation = vi.fn(async () => {});
    const deps = depsFor(pending, { releaseOperation });
    const failure = new Error("gateway exploded");
    await expect(
      withLoginOperation({
        deps, id: identity, record: pending as never, operation: "status",
        settled: () => "settled", contended: () => "contended",
        run: async () => { throw failure; },
      }),
    ).rejects.toBe(failure);
    expect(releaseOperation).toHaveBeenCalledWith("durable-login-1", "operator-1", "control-plane-test", "operation-token");
  });
});

describe("pollAccountLoginStatus", () => {
  it("maps starting, echo, contended, and updated outcomes", async () => {
    const gateway = { accountLoginStatus: vi.fn(async () => ({ providerId: "openai-codex" as const, loginId: "provider-login-1", state: "pending" as const })) };
    const starting = { ...base, providerLoginId: null, authUrl: null, state: "starting" as const, message: null };
    expect(await pollAccountLoginStatus(depsFor(starting), gateway, identity)).toEqual({ kind: "starting" });
    expect(gateway.accountLoginStatus).not.toHaveBeenCalled();

    const cancelled = { ...base, state: "cancelled" as const, message: "m" };
    expect(await pollAccountLoginStatus(depsFor(cancelled), gateway, identity)).toEqual({ kind: "echo", record: cancelled });

    const pending = { ...base, state: "pending" as const, message: null };
    const contendedDeps = depsFor(pending, { claimOperation: vi.fn(async () => undefined) });
    expect(await pollAccountLoginStatus(contendedDeps, gateway, identity)).toEqual({ kind: "contended" });

    const updated = { ...base, state: "succeeded" as const, message: null };
    const updateState = vi.fn(async () => updated);
    const result = await pollAccountLoginStatus(depsFor(pending, { updateState }), gateway, identity);
    expect(result).toEqual({ kind: "updated", record: updated });
    expect(updateState).toHaveBeenCalledWith("durable-login-1", "operator-1", "pending", undefined, "control-plane-test", "operation-token");
  });
});

describe("cancelAccountLoginFlow", () => {
  it("maps echo, contended, cancelled, and unknown outcomes", async () => {
    const gateway = { cancelAccountLogin: vi.fn(async () => {}) };
    const cancelled = { ...base, state: "cancelled" as const, message: null };
    expect(await cancelAccountLoginFlow(depsFor(cancelled), gateway, identity)).toEqual({ kind: "echo", record: cancelled });
    expect(gateway.cancelAccountLogin).not.toHaveBeenCalled();

    const pending = { ...base, state: "pending" as const, message: null };
    const contendedDeps = depsFor(pending, { claimOperation: vi.fn(async () => undefined) });
    expect(await cancelAccountLoginFlow(contendedDeps, gateway, identity)).toEqual({ kind: "contended" });

    const updateState = vi.fn(async () => ({ ...pending, state: "cancelled" as const }));
    expect(await cancelAccountLoginFlow(depsFor(pending, { updateState }), gateway, identity)).toEqual({ kind: "cancelled" });
    expect(gateway.cancelAccountLogin).toHaveBeenCalledWith({ operatorId: "operator-1", requestId: "request-1", providerId: "openai-codex", loginId: "provider-login-1" });

    const lost = vi.fn(async () => {
      throw new ModelGatewayClientError("account_login_session_unknown", 409, "gone");
    });
    const unknownState = vi.fn(async () => ({ ...pending, state: "unknown" as const, message: "Gateway login session was lost during restart" }));
    expect(await cancelAccountLoginFlow(depsFor(pending, { updateState: unknownState }), { cancelAccountLogin: lost }, identity)).toEqual({ kind: "unknown" });
  });
});

describe("startAccountLoginFlow", () => {
  const startId = { operatorId: "operator-1", providerId: "openai-codex" as const, requestId: "request-1" };
  const starting = { ...base, providerLoginId: null, authUrl: null, state: "starting" as const, message: null };
  const ready = { ...base, state: "pending" as const, message: null };

  it("starts once, fails the reservation on gateway error, and waits for concurrent starters", async () => {
    const providerResult = { providerId: "openai-codex" as const, loginId: "provider-login-1", authUrl: "https://chatgpt.com/login" };
    const startAccountLogin = vi.fn(async () => providerResult);
    const completeStart = vi.fn(async () => ready);
    const deps = depsFor(starting, {
      reserveStart: vi.fn(async () => ({ created: true, record: starting })),
      completeStart,
    });
    const result = await startAccountLoginFlow(deps, { startAccountLogin }, startId);
    expect(result).toEqual({ providerId: "openai-codex", loginId: "durable-login-1", authUrl: "https://chatgpt.com/login" });
    expect(startAccountLogin).toHaveBeenCalledWith({ operatorId: "operator-1", requestId: "request-1", providerId: "openai-codex" });
    expect(completeStart).toHaveBeenCalledWith("durable-login-1", "provider-login-1", "https://chatgpt.com/login");

    const failure = new Error("gateway exploded");
    const failStart = vi.fn(async () => starting);
    const failingDeps = depsFor(starting, {
      reserveStart: vi.fn(async () => ({ created: true, record: starting })),
      failStart,
    });
    await expect(
      startAccountLoginFlow(failingDeps, { startAccountLogin: vi.fn(async () => { throw failure; }) }, startId),
    ).rejects.toBe(failure);
    expect(failStart).toHaveBeenCalledWith("durable-login-1", "Provider account login failed");

    const waitingDeps = depsFor(starting, {
      reserveStart: vi.fn(async () => ({ created: false, record: starting })),
      getByRequest: vi.fn(async () => ready),
    });
    const waited = await startAccountLoginFlow(waitingDeps, { startAccountLogin: vi.fn() }, startId);
    expect(waited).toEqual({ providerId: "openai-codex", loginId: "durable-login-1", authUrl: "https://chatgpt.com/login" });
  });

  it("rejects records that never become ready and times out stuck starters", async () => {
    const unready = { ...base, providerLoginId: null, authUrl: null, state: "pending" as const, message: null };
    const deps = depsFor(unready, { reserveStart: vi.fn(async () => ({ created: false, record: unready })) });
    await expect(startAccountLoginFlow(deps, { startAccountLogin: vi.fn() }, startId)).rejects.toThrow("Provider account login is not ready");

    const stuck = { ...base, providerLoginId: null, authUrl: null, state: "starting" as const, message: null };
    const stuckStore = depsFor(stuck, {
      reserveStart: vi.fn(async () => ({ created: false, record: stuck })),
      getByRequest: vi.fn(async () => stuck),
    }).store;
    vi.useFakeTimers();
    try {
      const pending = waitForAccountLoginStart(stuckStore, "operator-1", "request-1");
      const assertion = expect(pending).rejects.toThrow("account login start is still in progress");
      await vi.advanceTimersByTimeAsync(6000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
