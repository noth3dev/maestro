import { describe, expect, it, vi } from "vitest";
import { createAccountLoginController } from "./Settings.js";

describe("account login controller", () => {
  const makeDeps = (providerId: "openai-codex" | "anthropic-claude") => {
    const ref: { loginId?: string; abort?: AbortController } = {};
    const panelStates: Array<Record<string, unknown>> = [];
    const connectedCalls: boolean[] = [];
    const busy = { current: undefined as string | undefined };
    const api = {
      startAccountLogin: vi.fn(async (pid: "openai-codex" | "anthropic-claude") => ({
        providerId: pid,
        loginId: "login-1",
        authUrl: pid === "openai-codex" ? "https://chatgpt.com/login" : "https://claude.ai/oauth/authorize",
      })),
      accountLoginStatus: vi.fn(async (pid: "openai-codex" | "anthropic-claude", loginId: string) => ({
        providerId: pid,
        loginId,
        state: "succeeded" as const,
      })),
      cancelAccountLogin: vi.fn(async () => undefined),
      logoutAccount: vi.fn(async () => undefined),
    };
    const openExternal = vi.fn(async () => undefined);
    const refreshProviderSettings = vi.fn(async () => undefined);
    const setPanelState = (patch: Record<string, unknown>) => panelStates.push(patch);
    const setConnected = (connected: boolean) => connectedCalls.push(connected);
    const controller = createAccountLoginController({
      providerId,
      label: providerId === "openai-codex" ? "ChatGPT / Codex" : "Claude Pro/Max",
      ref,
      api,
      openExternal,
      refreshProviderSettings,
      getBusy: () => busy.current,
      setBusy: (value) => {
        busy.current = value;
      },
      setPanelState,
      setConnected,
    });
    return { ref, panelStates, connectedCalls, api, openExternal, refreshProviderSettings, busy, controller };
  };

  it.each(["openai-codex", "anthropic-claude"] as const)("completes a successful login for %s", async (providerId) => {
    const { controller, api, panelStates, connectedCalls } = makeDeps(providerId);
    await controller.start();
    expect(api.startAccountLogin).toHaveBeenCalledWith(providerId);
    expect(api.accountLoginStatus).toHaveBeenCalledWith(providerId, "login-1");
    expect(connectedCalls).toEqual([true]);
    expect(panelStates.some((patch) => patch.loginState === "connected")).toBe(true);
  });

  it.each(["openai-codex", "anthropic-claude"] as const)("cancels an in-flight login for %s", async (providerId) => {
    const { controller, ref, api } = makeDeps(providerId);
    ref.loginId = "login-1";
    ref.abort = new AbortController();
    await controller.cancel();
    expect(api.cancelAccountLogin).toHaveBeenCalledWith(providerId, "login-1");
    expect(ref.loginId).toBeUndefined();
  });

  it.each(["openai-codex", "anthropic-claude"] as const)("surfaces a login error for %s", async (providerId) => {
    const { panelStates } = makeDeps(providerId);
    const api = {
      startAccountLogin: vi.fn(async () => {
        throw new Error("boom");
      }),
      accountLoginStatus: vi.fn(),
      cancelAccountLogin: vi.fn(async () => undefined),
      logoutAccount: vi.fn(async () => undefined),
    };
    const errorController = createAccountLoginController({
      providerId,
      label: providerId === "openai-codex" ? "ChatGPT / Codex" : "Claude Pro/Max",
      ref: {},
      api,
      openExternal: vi.fn(async () => undefined),
      refreshProviderSettings: vi.fn(async () => undefined),
      getBusy: () => undefined,
      setBusy: vi.fn(),
      setPanelState: (patch) => panelStates.push(patch),
      setConnected: vi.fn(),
    });
    await errorController.start();
    expect(panelStates.some((patch) => patch.loginState === "error" && patch.message === "boom")).toBe(true);
  });

  it.each(["openai-codex", "anthropic-claude"] as const)("logs out for %s", async (providerId) => {
    const { controller, api, panelStates, connectedCalls } = makeDeps(providerId);
    await controller.logout();
    expect(api.logoutAccount).toHaveBeenCalledWith(providerId);
    expect(connectedCalls).toEqual([false]);
    expect(panelStates.some((patch) => patch.loginState === "idle")).toBe(true);
  });
});
