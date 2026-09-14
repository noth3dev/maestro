import { describe, expect, it, vi } from "vitest";
import { parseInput } from "./commands/parser.js";
import { createAutomaticProviderSignInGate, isProviderLoginActive, runAutomaticProviderSignInOffer, shouldOfferAutomaticProviderSignIn } from "./entry.js";

const model = (provider: string, id: string) => ({
  identity: { provider, id },
  capabilities: ["text"],
  authModes: ["api-key" as const],
  dataPolicy: {
    allowedDataClasses: ["public" as const],
    retention: "none" as const,
    trainsOnCustomerData: false,
    regions: ["US"],
  },
});

describe("automatic provider sign-in", () => {
  it("offers sign-in when no model/provider credential is resolvable", () => {
    expect(shouldOfferAutomaticProviderSignIn([], undefined)).toBe(true);
    expect(shouldOfferAutomaticProviderSignIn([model("openai", "gpt-5")], "openai/unknown")).toBe(true);
  });

  it("does not offer sign-in when the session or environment model is available", () => {
    expect(shouldOfferAutomaticProviderSignIn([model("openai", "gpt-5")], "openai/gpt-5")).toBe(false);
  });

  it("enters the account sign-in flow from a connected empty catalog without a keypress", async () => {
    const onOffer = vi.fn();
    await runAutomaticProviderSignInOffer({
      client: { listModels: async () => [] },
      getConfiguredModel: () => undefined,
      gate: createAutomaticProviderSignInGate(),
      isCurrent: () => true,
      isManualLoginActive: () => false,
      onOffer,
    });
    expect(onOffer).toHaveBeenCalledOnce();
  });

  it("claims the automatic offer only once, including after dismissal", async () => {
    const gate = createAutomaticProviderSignInGate();
    const onOffer = vi.fn();
    const options = {
      client: { listModels: async () => [] },
      getConfiguredModel: () => undefined,
      gate,
      isCurrent: () => true,
      isManualLoginActive: () => false,
      onOffer,
    };
    await runAutomaticProviderSignInOffer(options);
    await runAutomaticProviderSignInOffer(options);
    expect(onOffer).toHaveBeenCalledOnce();
  });

  it("keeps automatic offers blocked while a provider-key request is in flight", () => {
    expect(isProviderLoginActive(undefined, true, undefined)).toBe(true);
    expect(isProviderLoginActive("openai", false, undefined)).toBe(true);
    expect(isProviderLoginActive(undefined, false, 0)).toBe(true);
    expect(isProviderLoginActive(undefined, false, undefined)).toBe(false);
  });

  it("does not overwrite manual provider-key entry or a stale connection", async () => {
    let resolveModels: ((models: readonly []) => void) | undefined;
    let manualLoginActive = false;
    const manualOffer = vi.fn();
    const manualRequest = runAutomaticProviderSignInOffer({
      client: { listModels: () => new Promise<readonly []>((resolve) => { resolveModels = resolve; }) },
      getConfiguredModel: () => undefined,
      gate: createAutomaticProviderSignInGate(),
      isCurrent: () => true,
      isManualLoginActive: () => manualLoginActive,
      onOffer: manualOffer,
    });
    manualLoginActive = true;
    resolveModels!([]);
    await manualRequest;
    expect(manualOffer).not.toHaveBeenCalled();

    let current = true;
    resolveModels = undefined;
    const staleOffer = vi.fn();
    const staleRequest = runAutomaticProviderSignInOffer({
      client: { listModels: () => new Promise<readonly []>((resolve) => { resolveModels = resolve; }) },
      getConfiguredModel: () => undefined,
      gate: createAutomaticProviderSignInGate(),
      isCurrent: () => current,
      isManualLoginActive: () => false,
      onOffer: staleOffer,
    });
    current = false;
    resolveModels!([]);
    await staleRequest;
    expect(staleOffer).not.toHaveBeenCalled();
  });

  it("does not consume the offer gate when model discovery fails", async () => {
    let unavailable = true;
    const onOffer = vi.fn();
    const client = { listModels: vi.fn(async () => { if (unavailable) throw new Error("gateway unavailable"); return []; }) };
    const gate = createAutomaticProviderSignInGate();
    const options = {
      client,
      getConfiguredModel: () => undefined,
      gate,
      isCurrent: () => true,
      isManualLoginActive: () => false,
      onOffer,
    };
    await runAutomaticProviderSignInOffer(options);
    unavailable = false;
    await runAutomaticProviderSignInOffer(options);
    expect(onOffer).toHaveBeenCalledOnce();
  });

  it("leaves the explicit /login command available", () => {
    expect(parseInput("/login")).toEqual({ kind: "command", name: "login", options: {} });
  });
});
