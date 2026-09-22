import { describe, expect, it, vi } from "vitest";
import { initializeCarnegieConnection } from "./bootstrap.js";
import type { ConnectionConfig } from "./store.js";
import type { LocalBootstrapStepEvent } from "@maestro/local-backend";

const bootstrapped: ConnectionConfig = {
  apiUrl: "http://127.0.0.1:4310",
  token: "credential.secret",
  projectId: "11111111-1111-4111-8111-111111111111",
};

describe("initializeCarnegieConnection", () => {
  it("auto-bootstraps and persists a fresh local connection", async () => {
    const save = vi.fn<(config: ConnectionConfig) => void>();
    const resolveLocalConnection = vi.fn(async () => ({
      kind: "configured" as const,
      apiUrl: bootstrapped.apiUrl,
      token: bootstrapped.token,
      projectId: bootstrapped.projectId,
    }));

    await expect(initializeCarnegieConnection({ env: {}, load: () => undefined, save, resolveLocalConnection })).resolves.toEqual({
      config: bootstrapped,
    });
    expect(resolveLocalConnection).toHaveBeenCalledWith({ env: {}, includeProjectId: true });
    expect(save).toHaveBeenCalledWith(bootstrapped);
  });

  it("forwards real local bootstrap progress to the Electron startup boundary", async () => {
    const events: LocalBootstrapStepEvent[] = [];
    const resolveLocalConnection = vi.fn(async (options: { onStep?: (event: LocalBootstrapStepEvent) => void }) => {
      options.onStep?.({ step: "docker-check", status: "started" });
      options.onStep?.({ step: "docker-check", status: "completed", message: "Docker is ready" });
      return { kind: "configured" as const, apiUrl: bootstrapped.apiUrl, token: bootstrapped.token, projectId: bootstrapped.projectId };
    });

    await expect(initializeCarnegieConnection({ env: {}, load: () => undefined, save: vi.fn(), resolveLocalConnection, onStep: (event) => events.push(event) })).resolves.toEqual({ config: bootstrapped });
    expect(resolveLocalConnection).toHaveBeenCalledWith(expect.objectContaining({ env: {}, includeProjectId: true, onStep: expect.any(Function) }));
    const forwarded = vi.mocked(resolveLocalConnection).mock.calls[0]?.[0].onStep;
    forwarded?.({ step: "postgres-ready", status: "completed" });
    expect(events).toEqual([
      { step: "docker-check", status: "started" },
      { step: "docker-check", status: "completed", message: "Docker is ready" },
      { step: "postgres-ready", status: "completed" },
    ]);
  });

  it("recovers from an incomplete saved local connection", async () => {
    const resolveLocalConnection = vi.fn(async () => ({
      kind: "configured" as const,
      apiUrl: bootstrapped.apiUrl,
      token: bootstrapped.token,
      projectId: bootstrapped.projectId,
    }));
    const save = vi.fn();

    await expect(initializeCarnegieConnection({
      env: {},
      load: () => { throw new Error("Stored control-plane token is unavailable"); },
      save,
      resolveLocalConnection,
    })).resolves.toEqual({ config: bootstrapped });
    expect(resolveLocalConnection).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith(bootstrapped);
  });

  it("does not bootstrap over an existing saved connection", async () => {
    const load = vi.fn(() => bootstrapped);
    const resolveLocalConnection = vi.fn();
    const save = vi.fn();

    await expect(initializeCarnegieConnection({ env: {}, load, save, resolveLocalConnection })).resolves.toEqual({ config: bootstrapped });
    expect(resolveLocalConnection).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("leaves env-overridden connections on the manual setup path", async () => {
    const resolveLocalConnection = vi.fn();
    const save = vi.fn();

    await expect(initializeCarnegieConnection({ env: { MAESTRO_API_URL: "https://team.example" }, load: () => undefined, save, resolveLocalConnection })).resolves.toEqual({});
    expect(resolveLocalConnection).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("honors the explicit local-autostart disable override", async () => {
    const resolveLocalConnection = vi.fn();

    await expect(initializeCarnegieConnection({ env: { MAESTRO_DISABLE_LOCAL_AUTOSTART: "true" }, load: () => undefined, save: vi.fn(), resolveLocalConnection })).resolves.toEqual({});
    expect(resolveLocalConnection).not.toHaveBeenCalled();
  });

  it("returns the bootstrap failure so Setup can explain why it is shown", async () => {
    const resolveLocalConnection = vi.fn(async () => ({ kind: "setup-required" as const, reason: "Docker is unavailable" }));

    await expect(initializeCarnegieConnection({ env: {}, load: () => undefined, save: vi.fn(), resolveLocalConnection })).resolves.toEqual({
      setupError: "Docker is unavailable",
    });
  });

  it("fails closed when bootstrap does not return a project", async () => {
    const resolveLocalConnection = vi.fn(async () => ({ kind: "configured" as const, apiUrl: bootstrapped.apiUrl, token: bootstrapped.token }));

    await expect(initializeCarnegieConnection({ env: {}, load: () => undefined, save: vi.fn(), resolveLocalConnection })).resolves.toEqual({
      setupError: "Local bootstrap did not return a project ID",
    });
  });
});
