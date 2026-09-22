import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.stubGlobal("React", React);
import { describe, expect, it, vi } from "vitest";
import type { RouterCatalogRead } from "@maestro/contracts";
import { RouterCatalogPanel, routerConfigDocument, nextRouterPool, createAccountLoginController } from "./Settings.js";

const catalog: RouterCatalogRead = {
  mode: "ensemble" as const,
  active: true,
  status: "partial" as const,
  reason: "Live Gateway catalog is unavailable; provider availability cannot be confirmed.",
  poolModelRefs: ["anthropic/claude-3"],
  entries: [
    {
      modelRef: "openai/model-a",
      providerId: "openai",
      modelId: "model-a",
      baseline: { present: true, score: 88, reviewedAt: "2026-09-22T00:00:00.000Z" },
      live: { present: true, capabilities: ["text"], authModes: ["api-key"], regions: ["us"] },
      candidate: { present: true, candidateRefs: ["candidate-a"], accountBindings: ["account-a"] },
      inUse: true,
      state: "catalog-ready" as const,
    },
    {
      modelRef: "openai-codex/model-a",
      providerId: "openai-codex",
      modelId: "model-a",
      baseline: { present: false, score: null },
      live: { present: true, capabilities: ["text"], authModes: ["managed-subscription"], regions: ["us"] },
      candidate: { present: false, candidateRefs: [], accountBindings: [] },
      inUse: false,
      state: "unprofiled" as const,
    },
    {
      modelRef: "anthropic/claude-3",
      providerId: "anthropic",
      modelId: "claude-3",
      baseline: { present: true, score: 80 },
      live: { present: false, capabilities: [], authModes: [], regions: [] },
      candidate: { present: true, candidateRefs: ["candidate-anthropic"], accountBindings: ["account-anthropic"] },
      inUse: false,
      state: "pool-disabled" as const,
    },
  ],
};

const props = {
  catalog,
  loading: false,
  error: undefined,
  onRefresh: vi.fn(),
  onToggle: vi.fn(async () => undefined),
  onValidateConfig: vi.fn(async () => ({ valid: true, enabledModelRefs: [], unknownModelRefs: [], changes: [] })),
  onApplyConfig: vi.fn(async () => catalog),
};

describe("Router Catalog settings", () => {
  it("renders exact provider groups and disables unprofiled rows", () => {
    const html = renderToStaticMarkup(<RouterCatalogPanel {...props} />);
    expect(html).toContain("Ensemble Router");
    expect(html).toContain("openai-codex");
    expect(html).toContain("anthropic");
    expect(html).toContain('aria-label="Enable openai-codex/model-a"');
    expect(html).toContain('disabled=""');
    expect(html).toContain("Live Gateway catalog is unavailable");
  });

  it("keeps imported configuration strict and computes a narrowed pool", () => {
    expect(routerConfigDocument({ schemaVersion: 1, enabledModelRefs: ["openai/model-a"] })).toEqual({
      schemaVersion: 1,
      enabledModelRefs: ["openai/model-a"],
    });
    expect(() => routerConfigDocument({ schemaVersion: 1, enabledModelRefs: [], token: "secret" })).toThrow();
    expect(nextRouterPool(catalog, "openai/model-a", false)).toEqual(["anthropic/claude-3"]);
  });

  it("explains inactive catalog state without rendering provider secrets", () => {
    const html = renderToStaticMarkup(
      <RouterCatalogPanel
        {...props}
        catalog={{
          ...catalog,
          status: "inactive",
          reason: "Candidate catalog is unavailable; configure it before Ensemble worker admission.",
        }}
      />,
    );
    expect(html).toContain("Candidate catalog is unavailable");
    expect(html).not.toContain("secret");
  });
});

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
      setBusy: (value) => { busy.current = value; },
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
      startAccountLogin: vi.fn(async () => { throw new Error("boom"); }),
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
