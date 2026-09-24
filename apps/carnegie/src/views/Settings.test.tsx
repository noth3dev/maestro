import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.stubGlobal("React", React);
import { describe, expect, it, vi } from "vitest";
import type { RouterCatalogRead, RouterConfigInput } from "@maestro/contracts";
import { RouterCatalogPanel, RouterRow, routerConfigDocument, nextRouterPool, createAccountLoginController } from "./Settings.js";
import { RouterConfigImportPreview } from "./RouterConfigImportPreview.js";
import { createRouterConfigImportController } from "./router-config-import.js";
import { createRouterPoolMutationGate, routerPoolControlsLocked } from "./router-pool-mutation.js";

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
  onValidateConfig: vi.fn(async () => ({
    valid: true,
    enabledModelRefs: [],
    unknownModelRefs: [],
    nonCandidateModelRefs: [],
    changes: [],
  })),
  onApplyConfig: vi.fn(async () => catalog),
};

describe("Router Catalog settings", () => {
  it("renders exact provider groups and disables unprofiled rows", () => {
    const html = renderToStaticMarkup(<RouterCatalogPanel {...props} />);
    expect(html).toContain("Ensemble Router");
    expect(html).toContain(">upload operator config</button>");
    expect(html).toContain('type="file" accept="application/json,.json"');
    expect(html).toContain("openai-codex");
    expect(html).toContain("anthropic");
    expect(html).toContain('aria-label="Enable openai-codex/model-a"');
    expect(html).toContain('disabled=""');
    expect(html).toContain("Live Gateway catalog is unavailable");
    expect(html).toContain("Pool eligibility reflects only the human profile, explicit candidate, and operator pool");
    expect(html).toContain("does not guarantee live, account, Goal, or Mission Bundle readiness");
  });

  it("does not render a profile-only row as enabled", () => {
    const nonCandidate: RouterCatalogRead["entries"][number] = {
      modelRef: "openai/model-b",
      providerId: "openai",
      modelId: "model-b",
      baseline: { present: true, score: null },
      live: { present: true, capabilities: ["text"], authModes: ["api-key"], regions: ["us"] },
      candidate: { present: false, candidateRefs: [], accountBindings: [] },
      inUse: false,
      state: "not-a-candidate" as const,
    };
    const html = renderToStaticMarkup(
      <RouterCatalogPanel {...props} catalog={{ ...catalog, entries: [...catalog.entries, nonCandidate] }} />,
    );
    const buttonIndex = html.indexOf('aria-label="Enable openai/model-b"');
    const rowStart = html.lastIndexOf("<tr", buttonIndex);
    const rowEnd = html.indexOf("</tr>", buttonIndex) + "</tr>".length;
    const row = html.slice(rowStart, rowEnd);

    expect(row).toContain('aria-checked="false"');
    expect(row).toContain('disabled=""');
    expect(row).toContain("not a candidate");
  });

  it("renders candidate membership unknown without claiming nonmembership", () => {
    const candidateUnknown: RouterCatalogRead["entries"][number] = {
      ...catalog.entries[0]!,
      candidate: { present: null, candidateRefs: [], accountBindings: [] },
      inUse: false,
      state: "candidate-unknown",
    };
    const html = renderToStaticMarkup(
      <RouterCatalogPanel
        {...props}
        catalog={{
          ...catalog,
          active: false,
          status: "inactive",
          reason: "Candidate catalog unavailable; restore it, then refresh.",
          poolModelRefs: [candidateUnknown.modelRef],
          entries: [candidateUnknown],
        }}
      />,
    );
    const buttonIndex = html.indexOf('aria-label="Enable openai/model-a"');
    const rowStart = html.lastIndexOf("<tr", buttonIndex);
    const rowEnd = html.indexOf("</tr>", buttonIndex) + "</tr>".length;
    const row = html.slice(rowStart, rowEnd);

    expect(html).toContain("Candidate catalog unavailable; restore it, then refresh.");
    expect(html).toContain('role="status"');
    expect(html).toContain('<option value="candidate-unknown">candidate status unknown</option>');
    expect(html).toContain('<option value="live-unknown">live Gateway catalog not checked</option>');
    expect(html).toContain('<option value="live-unavailable">not listed in live Gateway catalog</option>');
    expect(row).toContain("candidate membership not checked");
    expect(row).toContain("account binding not checked");
    expect(row).toContain("candidate status unknown");
    expect(row).not.toContain("not a candidate");
    expect(row).toContain('aria-describedby="router-disabled-openai%2Fmodel-a"');
    expect(row).toContain('disabled=""');
  });

  it("renders Gateway membership unknown as not checked, not unavailable", () => {
    const liveUnknown: RouterCatalogRead["entries"][number] = {
      ...catalog.entries[0]!,
      live: { present: null, capabilities: [], authModes: [], regions: [] },
      inUse: true,
      state: "live-unknown",
    };
    const row = renderToStaticMarkup(
      <RouterRow entry={liveUnknown} busy={false} locked={false} lockStatusId="router-pool-lock-status" onToggle={vi.fn()} />,
    );

    expect(row).toContain("not checked in live Gateway catalog");
    expect(row).toContain("live Gateway catalog not checked");
    expect(row).not.toContain("unavailable");
    expect(row).not.toContain('disabled=""');
  });

  it("does not count stale profile-only refs as the last enabled candidate", () => {
    const nonCandidate: RouterCatalogRead["entries"][number] = {
      modelRef: "openai/model-b",
      providerId: "openai",
      modelId: "model-b",
      baseline: { present: true, score: null },
      live: { present: true, capabilities: ["text"], authModes: ["api-key"], regions: ["us"] },
      candidate: { present: false, candidateRefs: [], accountBindings: [] },
      inUse: false,
      state: "not-a-candidate",
    };
    const singleCandidateCatalog: RouterCatalogRead = {
      ...catalog,
      poolModelRefs: ["openai/model-a", nonCandidate.modelRef],
      entries: [catalog.entries[0]!, nonCandidate],
    };

    expect(() => nextRouterPool(singleCandidateCatalog, "openai/model-a", false)).toThrow(
      "At least one catalog candidate must remain enabled",
    );
  });

  it("labels a confirmed live-catalog omission separately from an unknown source", () => {
    const liveAbsent: RouterCatalogRead["entries"][number] = {
      ...catalog.entries[0]!,
      live: { present: false, capabilities: [], authModes: [], regions: [] },
      state: "live-unavailable",
    };
    const row = renderToStaticMarkup(
      <RouterRow entry={liveAbsent} busy={false} locked={false} lockStatusId="router-pool-lock-status" onToggle={vi.fn()} />,
    );

    expect(row).toContain("not listed in live Gateway catalog");
    expect(row).not.toContain("not checked in live Gateway catalog");
    expect(row).not.toContain(">unavailable<");
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

describe("Router config import preview", () => {
  it("warns that profile-only refs are saved preferences without routing effect", () => {
    const ref = "openai/model-b";
    const entry: RouterCatalogRead["entries"][number] = {
      modelRef: ref,
      providerId: "openai",
      modelId: "model-b",
      baseline: { present: true, score: null },
      live: { present: true, capabilities: ["text"], authModes: ["api-key"], regions: ["us"] },
      candidate: { present: false, candidateRefs: [], accountBindings: [] },
      inUse: false,
      state: "not-a-candidate",
    };
    const html = renderToStaticMarkup(
      <RouterConfigImportPreview
        validation={{ valid: true, enabledModelRefs: [ref], unknownModelRefs: [], nonCandidateModelRefs: [ref], changes: [] }}
        entries={[entry]}
        applying={false}
        onCancel={() => undefined}
        onApply={() => undefined}
      />,
    );

    expect(html).toContain("saved in the operator pool as preferences");
    expect(html).toContain("cannot route");
    expect(html).toContain(ref);
    expect(html).toContain("apply import");
    expect(html).not.toContain('disabled=""');
  });

  it("keeps cancellation disabled and announces while atomic apply is running", () => {
    const html = renderToStaticMarkup(
      <RouterConfigImportPreview
        validation={{ valid: true, enabledModelRefs: [], unknownModelRefs: [], nonCandidateModelRefs: [], changes: [] }}
        entries={[]}
        applying={true}
        onCancel={() => undefined}
        onApply={() => undefined}
      />,
    );

    expect(html).toContain("<h3");
    expect(html).toContain("Applying the operator pool update");
    expect(html).toContain("Other pool controls are locked");
    expect(html).toContain('id="router-pool-lock-status"');
    expect(html).toContain('class="router-import-applying-status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toMatch(/<button type="button" class="btn btn-sm" disabled="">\s*cancel<\/button>/);
  });

  it("identifies live-only unknown refs and blocks applying them", () => {
    const ref = "openai-codex/live-only";
    const entry: RouterCatalogRead["entries"][number] = {
      modelRef: ref,
      providerId: "openai-codex",
      modelId: "live-only",
      baseline: { present: false, score: null },
      live: { present: true, capabilities: ["text"], authModes: ["managed-subscription"], regions: ["us"] },
      candidate: { present: false, candidateRefs: [], accountBindings: [] },
      inUse: false,
      state: "unprofiled",
    };
    const html = renderToStaticMarkup(
      <RouterConfigImportPreview
        validation={{ valid: false, enabledModelRefs: [ref], unknownModelRefs: [ref], nonCandidateModelRefs: [], changes: [] }}
        entries={[entry]}
        applying={false}
        onCancel={() => undefined}
        onApply={() => undefined}
      />,
    );

    expect(html).toContain("Live-only Gateway models");
    expect(html).toContain(ref);
    expect(html).toContain('disabled=""');
  });
});

describe("router pool mutation gate", () => {
  it("serializes writes so competing row and import updates cannot overlap", async () => {
    let finishFirst!: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const first = vi.fn(() => firstWrite);
    const second = vi.fn(async () => undefined);
    const gate = createRouterPoolMutationGate();

    const pending = gate.run(first);
    expect(gate.locked).toBe(true);
    await expect(gate.run(second)).resolves.toBe(false);
    expect(second).not.toHaveBeenCalled();

    finishFirst();
    await expect(pending).resolves.toBe(true);
    expect(gate.locked).toBe(false);
    await expect(gate.run(second)).resolves.toBe(true);
    expect(second).toHaveBeenCalledOnce();
  });

  it("releases the write lock after a failed request", async () => {
    const gate = createRouterPoolMutationGate();
    await expect(
      gate.run(async () => {
        throw new Error("network failure");
      }),
    ).rejects.toThrow("network failure");
    expect(gate.locked).toBe(false);
  });
});

it.each(["poolMutationBusy", "validatingImport", "hasImportPreview", "applyingImport"] as const)(
  "locks pool controls during %s",
  (stateKey) => {
    const state = {
      poolMutationBusy: false,
      validatingImport: false,
      hasImportPreview: false,
      applyingImport: false,
      [stateKey]: true,
    };
    expect(routerPoolControlsLocked(state)).toBe(true);
  },
);

it("leaves pool controls unlocked when there is no competing operation", () => {
  expect(
    routerPoolControlsLocked({
      poolMutationBusy: false,
      validatingImport: false,
      hasImportPreview: false,
      applyingImport: false,
    }),
  ).toBe(false);
});

it("associates disabled row explanations with their switches", () => {
  const entry: RouterCatalogRead["entries"][number] = {
    ...catalog.entries[0]!,
    candidate: { present: false, candidateRefs: [], accountBindings: [] },
    inUse: false,
    state: "not-a-candidate",
  };
  const disabledReasonId = `router-disabled-${encodeURIComponent(entry.modelRef)}`;
  const html = renderToStaticMarkup(
    <RouterRow entry={entry} busy={false} locked={false} lockStatusId="router-pool-lock-status" onToggle={vi.fn()} />,
  );

  expect(html).toContain(`aria-describedby="${disabledReasonId}"`);
  expect(html).toContain(`id="${disabledReasonId}"`);
  expect(html).toContain("not a candidate");
});

it("disables a row switch and describes the pool lock while another operation is active", () => {
  const html = renderToStaticMarkup(
    <RouterRow entry={catalog.entries[0]!} busy={false} locked={true} lockStatusId="router-pool-lock-status" onToggle={vi.fn()} />,
  );
  expect(html).toContain('aria-describedby="router-pool-lock-status"');
  expect(html).toContain('role="switch"');
  expect(html).toContain('disabled=""');
});

describe("router config import controller", () => {
  it("releases the validation guard when a file is malformed", async () => {
    const controller = createRouterConfigImportController();
    const validate = vi.fn(async () => ({
      valid: true,
      enabledModelRefs: [],
      unknownModelRefs: [],
      nonCandidateModelRefs: [],
      changes: [],
    }));

    await expect(controller.validate({ text: async () => "{" }, validate)).rejects.toThrow();
    expect(controller.validating).toBe(false);
  });

  it("allows one file validation at a time and does not start a stale second request", async () => {
    let finishRead!: (text: string) => void;
    const pendingText = new Promise<string>((resolve) => {
      finishRead = resolve;
    });
    const firstFile = { text: vi.fn(() => pendingText) };
    const secondFile = { text: vi.fn(async () => JSON.stringify({ schemaVersion: 1, enabledModelRefs: ["openai/model-b"] })) };
    const validate = vi.fn(async (input: RouterConfigInput) => ({
      valid: true,
      enabledModelRefs: input.enabledModelRefs,
      unknownModelRefs: [],
      nonCandidateModelRefs: [],
      changes: [],
    }));
    const controller = createRouterConfigImportController();

    const first = controller.validate(firstFile, validate);
    expect(controller.validating).toBe(true);
    await expect(controller.validate(secondFile, validate)).resolves.toBeUndefined();
    expect(secondFile.text).not.toHaveBeenCalled();
    expect(validate).not.toHaveBeenCalled();

    finishRead(JSON.stringify({ schemaVersion: 1, enabledModelRefs: ["openai/model-a"] }));
    await expect(first).resolves.toMatchObject({ input: { enabledModelRefs: ["openai/model-a"] }, result: { valid: true } });
    expect(validate).toHaveBeenCalledTimes(1);
    expect(controller.validating).toBe(false);
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
