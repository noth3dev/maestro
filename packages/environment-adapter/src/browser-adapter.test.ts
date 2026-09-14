import { describe, expect, it, vi } from "vitest";
import type { AuthorityDecision, AuthorityRepository } from "@maestro/authority";
import { AuthorizedEffectExecutor } from "@maestro/authority";
import type { EnvironmentRecord } from "@maestro/domain";
import {
  createBrowserEnvironmentAdapter,
  type BrowserAdapterOptions,
  type BrowserDriver,
  type BrowserPage,
} from "./browser-adapter.js";
import { EnvironmentAuthorizationError, EnvironmentBoundaryError, EnvironmentExecutionError, type EnvironmentAuthorityGateway } from "./runtime-adapter.js";

function makeEnvironment(overrides: Partial<EnvironmentRecord> = {}): EnvironmentRecord {
  return {
    environmentId: "environment-1",
    recipeVersion: 1,
    goalId: "goal-1",
    departmentId: "engineering",
    workerId: "worker-1",
    projectId: "project-1",
    missionId: "mission-1",
    type: "browser_automation",
    recipe: { runtime: "chromium" },
    resolvedInputs: {},
    capabilities: [{ name: "chromium", version: "130" }],
    boundaries: {
      network: ["https://example.com"],
      filesystem: [],
      processes: [],
      browsers: ["navigate", "click", "fill", "get_text", "screenshot"],
      devices: [],
    },
    secretsReferences: [],
    resources: {
      cpuMillis: 1000,
      memoryMb: 512,
      diskMb: 1024,
      processCount: 2,
      durationSeconds: 30,
    },
    expiresAt: "2030-01-01T00:00:00.000Z",
    state: "ready",
    setupLog: [],
    health: { status: "healthy", checkedAt: "2029-01-01T00:00:00.000Z", summary: "ok" },
    contentIdentity: "a".repeat(64),
    cleanup: {
      status: "not_scheduled",
      scheduledAt: null,
      completedAt: null,
      ownedResources: [],
      retainedEvidence: [],
    },
    ...overrides,
  };
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    commandId: "command-1",
    actorId: "worker-1",
    action: "navigate",
    target: "https://example.com/page",
    policyVersion: 1,
    budgetEffectCents: 0,
    controlEpoch: "1",
    ...overrides,
  };
}

function fakePage(overrides: Partial<BrowserPage> = {}): BrowserPage {
  return {
    goto: vi.fn(async () => undefined),
    click: vi.fn(async () => undefined),
    fill: vi.fn(async () => undefined),
    textContent: vi.fn(async () => "hello"),
    screenshot: vi.fn(async () => Buffer.from("fake-png-bytes")),
    close: vi.fn(async () => undefined),
    ...overrides,
  };
}

function permissiveAuthority(): { authority: EnvironmentAuthorityGateway; calls: string[] } {
  const calls: string[] = [];
  const authority: EnvironmentAuthorityGateway = {
    async execute(request, effect, beforeClaim) {
      calls.push(request.action);
      await beforeClaim?.();
      await effect();
      return { effect: "allow", reason: "exact_grant", classification: "ordinary", request } satisfies AuthorityDecision;
    },
  };
  return { authority, calls };
}

function createAllowedBrowserEnvironmentAdapter(
  environment: EnvironmentRecord,
  authority: EnvironmentAuthorityGateway,
  options: BrowserAdapterOptions = {},
) {
  return createBrowserEnvironmentAdapter(environment, authority, {
    externalCapability: { require: async () => undefined },
    ...options,
  });
}

async function waitForTerminal(handle: { observe(): Promise<{ status: string }> }): Promise<Awaited<ReturnType<typeof handle.observe>>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await handle.observe();
    if (result.status !== "running") return result;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("browser command never reached a terminal state");
}

describe("browser environment adapter", () => {
  it("fails closed before the driver when the Goal has no browser activation", async () => {
    const page = fakePage();
    const driver: BrowserDriver = { newPage: vi.fn(async () => page) };
    const { authority } = permissiveAuthority();
    const adapter = createBrowserEnvironmentAdapter(makeEnvironment(), authority, { driver });

    await expect(adapter.start(command())).rejects.toThrow("browser capability is not activated");
    expect(driver.newPage).not.toHaveBeenCalled();
  });

  it("passes the exact Goal and command identity to the browser activation gate", async () => {
    const page = fakePage();
    const driver: BrowserDriver = { newPage: vi.fn(async () => page) };
    const { authority } = permissiveAuthority();
    const require = vi.fn(async () => undefined);
    const adapter = createBrowserEnvironmentAdapter(makeEnvironment(), authority, { driver, externalCapability: { require } });

    await adapter.start(command());
    expect(require).toHaveBeenCalledWith({
      capabilityKind: "browser", projectId: "project-1", goalId: "goal-1", commandId: "command-1", budgetEffectCents: 0,
    });
  });

  it("navigates within the network allowlist and reports success", async () => {
    const page = fakePage();
    const driver: BrowserDriver = { newPage: vi.fn(async () => page) };
    const { authority, calls } = permissiveAuthority();
    const adapter = createAllowedBrowserEnvironmentAdapter(makeEnvironment(), authority, { driver });

    const handle = await adapter.start(command());
    const result = await waitForTerminal(handle);

    expect(result.status).toBe("succeeded");
    expect(page.goto).toHaveBeenCalledWith("https://example.com/page", expect.any(Number));
    expect(page.close).toHaveBeenCalled();
    expect(calls).toEqual(["browser.navigate"]);
  });

  it("denies an expired browser activation before the driver", async () => {
    const driver: BrowserDriver = { newPage: vi.fn() };
    const { authority } = permissiveAuthority();
    const adapter = createBrowserEnvironmentAdapter(makeEnvironment(), authority, {
      driver, externalCapability: { require: async () => { throw new Error("External browser capability is expired"); } },
    });

    await expect(adapter.start(command())).rejects.toThrow("External browser capability is expired");
    expect(driver.newPage).not.toHaveBeenCalled();
  });

  it("denies navigation outside the network allowlist before authority or the driver", async () => {
    const driver: BrowserDriver = { newPage: vi.fn() };
    const { authority } = permissiveAuthority();
    const require = vi.fn(async () => undefined);
    const adapter = createBrowserEnvironmentAdapter(makeEnvironment(), authority, { driver, externalCapability: { require } });

    await expect(adapter.start(command({ target: "https://evil.example/page" }))).rejects.toBeInstanceOf(EnvironmentBoundaryError);
    expect(require).not.toHaveBeenCalled();
    expect(driver.newPage).not.toHaveBeenCalled();
  });

  it("denies an action outside the environment's browser boundary", async () => {
    const driver: BrowserDriver = { newPage: vi.fn() };
    const { authority } = permissiveAuthority();
    const environment = makeEnvironment({ boundaries: { ...makeEnvironment().boundaries, browsers: ["navigate"] } });
    const adapter = createAllowedBrowserEnvironmentAdapter(environment, authority, { driver });

    await expect(adapter.start(command({ action: "click", target: "#button" }))).rejects.toBeInstanceOf(EnvironmentBoundaryError);
    expect(driver.newPage).not.toHaveBeenCalled();
  });

  it("denies a browser provider that is absent from the capability manifest before authority or driver", async () => {
    const driver: BrowserDriver = { newPage: vi.fn() };
    const { authority, calls } = permissiveAuthority();
    const environment = makeEnvironment({ capabilities: [] });
    const adapter = createAllowedBrowserEnvironmentAdapter(environment, authority, { driver });

    await expect(adapter.start(command())).rejects.toBeInstanceOf(EnvironmentBoundaryError);
    expect(calls).toEqual([]);
    expect(driver.newPage).not.toHaveBeenCalled();
  });

  it("captures bounded text for get_text without exposing raw page HTML", async () => {
    const page = fakePage({ textContent: vi.fn(async () => "x".repeat(20_000)) });
    const driver: BrowserDriver = { newPage: vi.fn(async () => page) };
    const { authority } = permissiveAuthority();
    const adapter = createAllowedBrowserEnvironmentAdapter(makeEnvironment(), authority, { driver, maxCapturedTextLength: 100 });

    const handle = await adapter.start(command({ action: "get_text", target: "#content" }));
    const result = await waitForTerminal(handle);

    expect(result.status).toBe("succeeded");
    expect(result.capturedText).toHaveLength(100);
    expect(result.evidenceRef).toBeNull();
  });

  it("records a screenshot as a content-addressed evidence reference, never raw bytes on the result", async () => {
    const page = fakePage();
    const driver: BrowserDriver = { newPage: vi.fn(async () => page) };
    const { authority } = permissiveAuthority();
    const written: Array<{ bytes: Uint8Array; mediaType: string }> = [];
    const adapter = createAllowedBrowserEnvironmentAdapter(makeEnvironment(), authority, {
      driver,
      evidence: { write: async (bytes, mediaType) => { written.push({ bytes, mediaType }); return "deadbeef".repeat(8); } },
    });

    const handle = await adapter.start(command({ action: "screenshot", target: "" }));
    const result = await waitForTerminal(handle);

    expect(result.status).toBe("succeeded");
    expect(result.evidenceRef).toBe("deadbeef".repeat(8));
    expect(result.capturedText).toBeNull();
    expect(written).toHaveLength(1);
    expect(written[0]!.mediaType).toBe("image/png");
  });

  it("rejects a screenshot larger than the evidence size cap and does not write evidence", async () => {
    const page = fakePage({ screenshot: vi.fn(async () => Buffer.alloc(1024)) });
    const driver: BrowserDriver = { newPage: vi.fn(async () => page) };
    const { authority } = permissiveAuthority();
    const written: unknown[] = [];
    const adapter = createAllowedBrowserEnvironmentAdapter(makeEnvironment(), authority, {
      driver, maxScreenshotBytes: 10,
      evidence: { write: async (bytes) => { written.push(bytes); return "x".repeat(64); } },
    });

    const handle = await adapter.start(command({ action: "screenshot", target: "" }));
    const result = await waitForTerminal(handle);

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/evidence size cap/);
    expect(written).toHaveLength(0);
  });

  it("does not consume browser activation when durable authority denies", async () => {
    const driver: BrowserDriver = { newPage: vi.fn() };
    const repository: AuthorityRepository = {
      load: async () => [],
      appendDecision: async () => undefined,
      recheckControl: async () => ({ effect: "allow" }),
    };
    const executor = new AuthorizedEffectExecutor(repository, () => new Date("2029-01-01T00:00:00.000Z"));
    const require = vi.fn(async () => undefined);
    const adapter = createBrowserEnvironmentAdapter(makeEnvironment(), executor, { driver, externalCapability: { require } });

    await expect(adapter.start(command())).rejects.toBeInstanceOf(EnvironmentAuthorizationError);
    expect(require).not.toHaveBeenCalled();
    expect(driver.newPage).not.toHaveBeenCalled();
  });

  it("does not invoke the driver when the durable authority gateway denies the exact request", async () => {
    const driver: BrowserDriver = { newPage: vi.fn() };
    const repository: AuthorityRepository = {
      load: async () => [],
      appendDecision: async () => undefined,
      recheckControl: async () => ({ effect: "allow" }),
    };
    const executor = new AuthorizedEffectExecutor(repository, () => new Date("2029-01-01T00:00:00.000Z"));
    const authority: EnvironmentAuthorityGateway = { execute: (request, effect) => executor.execute(request, effect) };
    const adapter = createAllowedBrowserEnvironmentAdapter(makeEnvironment(), authority, { driver });

    await expect(adapter.start(command())).rejects.toBeInstanceOf(EnvironmentAuthorizationError);
    expect(driver.newPage).not.toHaveBeenCalled();
  });

  it("rejects a durable reread whose immutable environment binding changed", async () => {
    const driver: BrowserDriver = { newPage: vi.fn(async () => fakePage()) };
    const { authority } = permissiveAuthority();
    const environment = makeEnvironment();
    let reads = 0;
    const adapter = createAllowedBrowserEnvironmentAdapter(environment, authority, {
      driver,
      readEnvironment: async () => {
        reads += 1;
        return reads === 1 ? environment : { ...environment, contentIdentity: "b".repeat(64) };
      },
    });

    await expect(adapter.start(command())).rejects.toBeInstanceOf(EnvironmentExecutionError);
  });

  it("does not exceed the environment browser-page ceiling while a page is in flight", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const firstStarted = new Promise<void>((resolve) => { started = resolve; });
    const driver: BrowserDriver = {
      newPage: vi.fn(async () => fakePage({
        goto: vi.fn(async () => {
          started();
          await blocked;
        }),
      })),
    };
    const { authority } = permissiveAuthority();
    const environment = makeEnvironment({ resources: { ...makeEnvironment().resources, processCount: 1 } });
    const adapter = createAllowedBrowserEnvironmentAdapter(environment, authority, { driver });

    const first = adapter.start(command());
    await firstStarted;
    await expect(adapter.start(command())).rejects.toBeInstanceOf(EnvironmentBoundaryError);
    release();
    await waitForTerminal(await first);
    await expect(adapter.start(command())).resolves.toBeDefined();
  });
});
