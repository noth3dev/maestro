import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { startEmbeddedDatabase } from "@maestro/persistence";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildLocalControlPlaneEnvironment, buildLocalModelGatewayEnvironment, buildNodeChildEnvironment, configuredEmbeddedDatabasePort, resolveInstalledControlPlaneEntry, resolveLocalConnection, resolvePackagedAppEntry, type LocalBootstrapStepEvent, type LocalProcessHandle, type LocalSecretStore } from "./local-bootstrap.js";
import { resolveCodexAppServerCommand } from "@maestro/model-provider-openai";

function secretStore(initial?: string): LocalSecretStore {
  let value = initial;
  return {
    read: () => value,
    write: (next) => { value = next; },
    clear: () => { value = undefined; },
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("Electron child runtime environment", () => {
  it("runs script children as Node when composed inside Electron", () => {
    expect(buildNodeChildEnvironment({ PATH: "/usr/bin" }, "33.4.11")).toMatchObject({
      PATH: "/usr/bin",
      ELECTRON_RUN_AS_NODE: "1",
    });
  });

  it("does not opt normal Node children into Electron mode", () => {
    expect(buildNodeChildEnvironment({ PATH: "/usr/bin" }, undefined)).toEqual({ PATH: "/usr/bin" });
  });
});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Codex app-server command discovery", () => {
  it("finds an executable codex binary on PATH", async () => {
    const directory = await mkdtemp(`${tmpdir()}/maestro-codex-path-`);
    const codex = join(directory, "codex");
    try {
      await writeFile(codex, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      expect(resolveCodexAppServerCommand(undefined, directory)).toBe(codex);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not configure Codex when PATH has no codex binary", () => {
    expect(resolveCodexAppServerCommand(undefined, `/tmp/maestro-no-codex${delimiter}/usr/bin`)).toBeUndefined();
  });

  it("keeps an explicit Codex app-server command instead of auto-detecting", () => {
    expect(resolveCodexAppServerCommand("/custom/codex", "/tmp/maestro-no-codex")).toBe("/custom/codex");
  });
});

async function probeSpawnedGatewayEnvironment(options: {
  readonly pathDirectory: string;
  readonly configuredCodexCommand?: string;
}): Promise<Record<string, string | undefined>> {
  const directory = await mkdtemp(`${tmpdir()}/maestro-codex-gateway-`);
  const outputPath = `${directory}/environment.json`;
  const port = 46000 + Math.floor(Math.random() * 1000);
  const gatewayUrl = `http://127.0.0.1:${port}`;
  const entry = `${directory}/gateway.mjs`;
  await writeFile(
    entry,
    `import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
const token = process.env.MAESTRO_MODEL_GATEWAY_TOKEN;
const server = createServer((request, response) => {
  if (request.url === "/healthz") { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ status: "ok" })); return; }
  if (request.url === "/v1/models" && request.headers.authorization === "Bearer " + token) { response.writeHead(200, { "content-type": "application/json" }); response.end("[]"); return; }
  response.writeHead(401); response.end();
});
server.listen(Number(process.env.MAESTRO_MODEL_GATEWAY_PORT), process.env.MAESTRO_MODEL_GATEWAY_HOST, () => writeFileSync(${JSON.stringify(outputPath)}, JSON.stringify({ token, host: process.env.MAESTRO_MODEL_GATEWAY_HOST, port: process.env.MAESTRO_MODEL_GATEWAY_PORT, operator: process.env.MAESTRO_OPERATOR_ID, pid: process.pid, codexCommand: process.env.MAESTRO_CODEX_APP_SERVER_COMMAND, codexModels: process.env.MAESTRO_CODEX_MODELS })));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`,
  );
  const priorPath = process.env.PATH;
  process.env.PATH = options.pathDirectory;
  const realFetch = globalThis.fetch;
  let controlPlaneStarted = false;
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(gatewayUrl)) return realFetch(input, init);
    if (!controlPlaneStarted) throw new Error("Control Plane is down");
    if (url.endsWith("/healthz")) return response({ status: "ok" });
    return response({ error: { code: "authentication_required", message: "invalid credential" } }, 401);
  });
  try {
    const env = {
      MAESTRO_API_URL: "http://127.0.0.1:46199",
      MAESTRO_MODEL_GATEWAY_URL: gatewayUrl,
      MAESTRO_MODEL_GATEWAY_ENTRY: entry,
      MAESTRO_CONTROL_PLANE_ENTRY: `${directory}/control.js`,
      MAESTRO_LOCAL_DATABASE_URL: "postgresql://localhost/maestro",
      ...(options.configuredCodexCommand === undefined ? {} : { MAESTRO_CODEX_APP_SERVER_COMMAND: options.configuredCodexCommand }),
    };
    const result = await resolveLocalConnection({
      env,
      fetch,
      secretStore: secretStore(),
      runCommand: vi.fn(async () => ({
        code: 0,
        stdout: JSON.stringify({ credentialId: "44444444-4444-4444-8444-444444444444" }),
        stderr: "",
      })),
      startControlPlane: vi.fn(async () => {
        controlPlaneStarted = true;
      }),
      // Detached child startup can exceed the zero-delay polling window on CI.
      retryDelayMs: 50,
    });
    expect(result.kind).toBe("setup-required");
    return JSON.parse(await readFile(outputPath, "utf8")) as Record<string, string | undefined>;
  } finally {
    if (priorPath === undefined) delete process.env.PATH;
    else process.env.PATH = priorPath;
    await rm(directory, { recursive: true, force: true });
  }
}

describe("Codex app-server command propagation", () => {
  it("keeps the native ChatGPT path even when a codex executable is on PATH", async () => {
    const pathDirectory = await mkdtemp(`${tmpdir()}/maestro-codex-path-`);
    const codex = join(pathDirectory, "codex");
    try {
      await writeFile(codex, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      const environment = await probeSpawnedGatewayEnvironment({ pathDirectory });
      expect(environment).not.toHaveProperty("codexCommand");
    } finally {
      await rm(pathDirectory, { recursive: true, force: true });
    }
  });

  it("leaves Codex unset in the actual spawned gateway process when PATH has no executable", async () => {
    const pathDirectory = await mkdtemp(`${tmpdir()}/maestro-no-codex-path-`);
    try {
      const environment = await probeSpawnedGatewayEnvironment({ pathDirectory });
      expect(environment).not.toHaveProperty("codexCommand");
    } finally {
      await rm(pathDirectory, { recursive: true, force: true });
    }
  });

  it("preserves an explicit Codex command in the actual spawned gateway process", async () => {
    const pathDirectory = await mkdtemp(`${tmpdir()}/maestro-explicit-codex-path-`);
    const codex = join(pathDirectory, "codex");
    try {
      await writeFile(codex, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      const environment = await probeSpawnedGatewayEnvironment({ pathDirectory, configuredCodexCommand: "/custom/codex" });
      expect(environment.codexCommand).toBe("/custom/codex");
    } finally {
      await rm(pathDirectory, { recursive: true, force: true });
    }
  });
});

describe("resolveLocalConnection", () => {
  it.each([undefined, "", "  ", "0", "65536", "abc", "1e3"])("rejects invalid embedded database port override %s", (value) => {
    expect(configuredEmbeddedDatabasePort(value)).toBeUndefined();
  });

  it.each([["1", 1], ["65535", 65_535], [" 55434 ", 55_434]])("accepts valid embedded database port override %s", (value, expected) => {
    expect(configuredEmbeddedDatabasePort(value)).toBe(expected);
  });

  it.each(["0", "65536", "abc", "1e3"])("fails closed for invalid embedded database port override %s", async (value) => {
    const startEmbeddedDatabase = vi.fn(async () => ({ databaseUrl: "postgresql://embedded", stop: vi.fn(async () => undefined) }));
    await expect(resolveLocalConnection({
      env: { MAESTRO_EMBEDDED_DATABASE_PORT: value },
      fetch: vi.fn().mockRejectedValue(new Error("control plane is down")),
      secretStore: secretStore(),
      runCommand: vi.fn(async () => ({ code: 0, stdout: "", stderr: "" })),
      startEmbeddedDatabase,
      retryDelayMs: 0,
    })).resolves.toEqual({
      kind: "setup-required",
      reason: "MAESTRO_EMBEDDED_DATABASE_PORT must be an integer from 1 to 65535",
    });
    expect(startEmbeddedDatabase).not.toHaveBeenCalled();
  });

  it("stops a database process that finishes after startup cancellation", async () => {
    const controller = new AbortController();
    let finishDatabase: ((database: { databaseUrl: string; stop: () => Promise<void> }) => void) | undefined;
    const stop = vi.fn(async () => undefined);
    const database = new Promise<{ databaseUrl: string; stop: () => Promise<void> }>((resolve) => {
      finishDatabase = resolve;
    });
    const startup = resolveLocalConnection({
      env: { MAESTRO_LOCAL_DB_ENGINE: "embedded" },
      fetch: vi.fn(),
      secretStore: secretStore(),
      runCommand: vi.fn(),
      startEmbeddedDatabase: async () => database,
      signal: controller.signal,
    });
    controller.abort();
    await expect(startup).rejects.toMatchObject({ name: "AbortError" });
    finishDatabase?.({ databaseUrl: "postgresql://localhost/maestro", stop });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(stop).toHaveBeenCalledOnce();
  });

  it("does not start a model gateway when its initial probe is cancelled", async () => {
    const controller = new AbortController();
    const fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes(":4321")) return Promise.resolve(response({ status: "ok" }));
      controller.abort();
      return Promise.reject(new Error("aborted"));
    });
    const startModelGateway = vi.fn(async () => ({ stop: vi.fn(async () => undefined) }));
    const startup = resolveLocalConnection({
      env: { MAESTRO_MODEL_GATEWAY_ENTRY: "/tmp/gateway.js" },
      fetch,
      secretStore: secretStore("44444444-4444-4444-8444-444444444444.secret"),
      runCommand: vi.fn(),
      startModelGateway,
      signal: controller.signal,
      retryDelayMs: 0,
    });
    await expect(startup).rejects.toMatchObject({ name: "AbortError" });
    expect(startModelGateway).not.toHaveBeenCalled();
  });

  it("stops a gateway when its final ready probe races with cancellation", async () => {
    const controller = new AbortController();
    let gatewayChecks = 0;
    const fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes(":4321")) return Promise.resolve(response({ status: "ok" }));
      gatewayChecks += 1;
      if (gatewayChecks === 1) return Promise.reject(new Error("Model gateway is down"));
      if (url.endsWith("/v1/models")) controller.abort();
      return Promise.resolve(response({ data: [] }));
    });
    const stop = vi.fn(async () => undefined);
    const startModelGateway = vi.fn(async () => ({ stop }));
    const startup = resolveLocalConnection({
      env: { MAESTRO_MODEL_GATEWAY_ENTRY: "/tmp/gateway.js" },
      fetch,
      secretStore: secretStore("44444444-4444-4444-8444-444444444444.secret"),
      runCommand: vi.fn(),
      startModelGateway,
      signal: controller.signal,
      retryDelayMs: 0,
    });
    await expect(startup).rejects.toMatchObject({ name: "AbortError" });
    expect(startModelGateway).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("propagates startup cancellation through local token validation", async () => {
    const controller = new AbortController();
    let controlPlaneHealth = true;
    const fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(":4321")) return Promise.resolve(url.endsWith("/healthz") ? response({ status: "ok" }) : response({ data: [] }));
      if (controlPlaneHealth) {
        controlPlaneHealth = false;
        return Promise.resolve(response({ status: "ok" }));
      }
      controller.abort();
      return Promise.reject(new Error("aborted"));
    });
    const startup = resolveLocalConnection({
      env: {},
      fetch,
      secretStore: secretStore("44444444-4444-4444-8444-444444444444.secret"),
      runCommand: vi.fn(),
      signal: controller.signal,
      retryDelayMs: 0,
    });
    await expect(startup).rejects.toMatchObject({ message: "Control plane request failed" });
  });

  it("stops a started model gateway when readiness polling is cancelled", async () => {
    const controller = new AbortController();
    let gatewayChecks = 0;
    const fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes(":4321")) return Promise.resolve(response({ status: "ok" }));
      gatewayChecks += 1;
      if (gatewayChecks === 1) return Promise.reject(new Error("Model gateway is down"));
      controller.abort();
      return Promise.reject(new Error("aborted"));
    });
    const stop = vi.fn(async () => undefined);
    const startModelGateway = vi.fn(async () => ({ stop }));
    const startup = resolveLocalConnection({
      env: { MAESTRO_MODEL_GATEWAY_ENTRY: "/tmp/gateway.js" },
      fetch,
      secretStore: secretStore("44444444-4444-4444-8444-444444444444.secret"),
      runCommand: vi.fn(),
      startModelGateway,
      signal: controller.signal,
      retryDelayMs: 0,
    });
    await expect(startup).rejects.toMatchObject({ name: "AbortError" });
    expect(startModelGateway).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("stops an owned Control Plane when readiness polling is cancelled", async () => {
    const controller = new AbortController();
    let healthChecks = 0;
    const fetch = vi.fn((_input: RequestInfo | URL) => {
      healthChecks += 1;
      if (healthChecks === 1) return Promise.reject(new Error("Control Plane is down"));
      controller.abort();
      return Promise.reject(new Error("aborted"));
    });
    const stop = vi.fn(async () => undefined);
    const startControlPlane = vi.fn(async () => ({ stop }));
    const startup = resolveLocalConnection({
      env: { MAESTRO_LOCAL_DATABASE_URL: "postgresql://localhost/maestro", MAESTRO_CONTROL_PLANE_ENTRY: "/tmp/control.js" },
      fetch,
      secretStore: secretStore(),
      runCommand: vi.fn(async () => ({
        code: 0,
        stdout: JSON.stringify({ credentialId: "44444444-4444-4444-8444-444444444444" }),
        stderr: "",
      })),
      startControlPlane,
      signal: controller.signal,
      retryDelayMs: 0,
    });
    await expect(startup).rejects.toMatchObject({ name: "AbortError" });
    expect(startControlPlane).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("uses the embedded Postgres-compatible engine by default when Docker is unavailable", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error("connection refused"))
      .mockRejectedValueOnce(new Error("connection refused"))
      .mockResolvedValueOnce(response({ status: "ok" }))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({ status: "ok" }))
      .mockResolvedValueOnce(response({ projects: [projectId] }))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({ goals: [] }))
      .mockResolvedValueOnce(response({ goalId: "22222222-2222-4222-8222-222222222222", projectId, state: "draft", version: 1 }, 201));
    const runCommand = vi.fn(async (file: string, args: readonly string[], options?: { env?: Record<string, string | undefined> }) => {
      if (file === "docker") return { code: 127, stdout: "", stderr: "docker: command not found" };
      if (file === process.execPath && args.some((arg) => arg.endsWith("local-bootstrap.js"))) {
        expect(options?.env?.MAESTRO_LOCAL_BOOTSTRAP_SECRET).toBeTruthy();
        return { code: 0, stdout: JSON.stringify({ credentialId: "44444444-4444-4444-8444-444444444444", projectId }), stderr: "" };
      }
      throw new Error(`unexpected command: ${file} ${args.join(" ")}`);
    });
    const setupEvents: LocalBootstrapStepEvent[] = [];
    const dataDir = await mkdtemp(`${tmpdir()}/maestro-embedded-bootstrap-`);
    let embedded: Awaited<ReturnType<typeof startEmbeddedDatabase>> | undefined;
    try {
      const result = await resolveLocalConnection({
        env: { MAESTRO_LOCAL_DATA_DIR: dataDir, MAESTRO_EMBEDDED_DATABASE_PORT: "55434", MAESTRO_CONTROL_PLANE_ENTRY: "/tmp/control.js", MAESTRO_MODEL_GATEWAY_ENTRY: "/tmp/gateway.js" },
        fetch,
        secretStore: secretStore(),
        runCommand,
        startEmbeddedDatabase: async (options) => {
          expect(options.port).toBe(55434);
          embedded = await startEmbeddedDatabase({ dataDir: options.dataDir, detached: false, port: options.port ?? 0 });
          return embedded;
        },
        startControlPlane: vi.fn(async () => undefined),
        startModelGateway: vi.fn(async () => undefined),
        retryDelayMs: 0,
        onStep: (event) => setupEvents.push(event),
      });
      expect(result).toMatchObject({ kind: "configured", apiUrl: "http://127.0.0.1:4310" });
      expect(setupEvents).not.toContainEqual(expect.objectContaining({ step: "docker-check" }));
      expect(setupEvents).toContainEqual(expect.objectContaining({ step: "postgres-ready", status: "completed", message: expect.stringContaining("Embedded") }));
    } finally {
      await embedded?.stop();
      await rm(dataDir, { recursive: true, force: true });
    }
    expect(runCommand).not.toHaveBeenCalledWith("docker", expect.arrayContaining(["run"]), expect.anything());
  });

  it("resolves the sibling Control Plane from the built shared module", () => {
    expect(resolveInstalledControlPlaneEntry("/opt/maestro/apps/cli/dist/tui")).toBe("/opt/maestro/apps/control-plane/dist/main.js");
  });

  it("resolves app entries from the packaged layout", () => {
    expect(resolvePackagedAppEntry("/opt/maestro/packages/local-backend/dist", "control-plane")).toBe(
      "/opt/maestro/apps/control-plane/dist/main.js",
    );
    expect(resolvePackagedAppEntry("/opt/maestro/packages/local-backend/dist", "model-gateway")).toBe(
      "/opt/maestro/apps/model-gateway/dist/main.js",
    );
  });

  it("rejects a non-UUID local operator override before starting services", async () => {
    await expect(resolveLocalConnection({ env: { MAESTRO_LOCAL_OPERATOR_ID: "local-operator" }, fetch: vi.fn(), secretStore: secretStore(), runCommand: vi.fn() })).resolves.toEqual({
      kind: "setup-required",
      reason: "MAESTRO_LOCAL_OPERATOR_ID must be a canonical UUID",
    });
  });

  it("rejects uppercase local UUID overrides to match the persistence contract", async () => {
    await expect(resolveLocalConnection({ env: { MAESTRO_LOCAL_OPERATOR_ID: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" }, fetch: vi.fn(), secretStore: secretStore(), runCommand: vi.fn() })).resolves.toEqual({
      kind: "setup-required",
      reason: "MAESTRO_LOCAL_OPERATOR_ID must be a canonical UUID",
    });
  });

  it("reuses a keychain token and repairs a missing default Goal", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ status: "ok" }))
      .mockResolvedValueOnce(response({ status: "ok" }))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({ projects: ["11111111-1111-4111-8111-111111111111"] }))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({ goals: [] }))
      .mockResolvedValueOnce(response({ goalId: "22222222-2222-4222-8222-222222222222", projectId: "11111111-1111-4111-8111-111111111111", state: "draft", version: 1 }, 201));

    const store = secretStore("credential.secret");
    const runCommand = vi.fn();

    await expect(resolveLocalConnection({ env: {}, fetch, secretStore: store, runCommand })).resolves.toEqual({
      kind: "configured",
      apiUrl: "http://127.0.0.1:4310",
      token: "credential.secret",
    });
    expect(runCommand).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(7);
  });

  it("returns the single local project when a consumer requests it", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ status: "ok" }))
      .mockResolvedValueOnce(response({ status: "ok" }))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({ projects: [projectId] }))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({ goals: [{ goalId: "22222222-2222-4222-8222-222222222222", projectId, state: "draft", version: 1 }] }));

    await expect(resolveLocalConnection({ env: {}, fetch, includeProjectId: true, secretStore: secretStore("credential.secret"), runCommand: vi.fn() })).resolves.toEqual({
      kind: "configured",
      apiUrl: "http://127.0.0.1:4310",
      token: "credential.secret",
      projectId,
    });
  });

  it("restarts a missing model gateway while retaining the Control Plane session", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ status: "ok" }))
      .mockRejectedValueOnce(new Error("gateway connection refused"))
      .mockResolvedValueOnce(response({ status: "ok" }))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({ projects: [projectId] }))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({ goals: [{ goalId: "22222222-2222-4222-8222-222222222222", projectId, state: "draft", version: 1 }] }));
    const startModelGateway = vi.fn(async () => undefined);
    const startControlPlane = vi.fn(async () => undefined);
    await expect(resolveLocalConnection({ env: {}, fetch, secretStore: secretStore("credential.secret"), runCommand: vi.fn(), startModelGateway, startControlPlane, retryDelayMs: 0 })).resolves.toEqual({ kind: "configured", apiUrl: "http://127.0.0.1:4310", token: "credential.secret" });
    expect(startModelGateway).toHaveBeenCalledOnce();
    expect(startControlPlane).not.toHaveBeenCalled();
  });

  it("does not spawn a duplicate while an existing gateway is becoming ready", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ status: "ok" }))
      .mockResolvedValueOnce(response({}, 503))
      .mockResolvedValueOnce(response({ status: "ok" }))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({ projects: [projectId] }))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({ goals: [{ goalId: "22222222-2222-4222-8222-222222222222", projectId, state: "draft", version: 1 }] }));
    const startModelGateway = vi.fn(async () => undefined);
    await expect(resolveLocalConnection({ env: {}, fetch, secretStore: secretStore("credential.secret"), runCommand: vi.fn(), startModelGateway, retryDelayMs: 0 })).resolves.toEqual({ kind: "configured", apiUrl: "http://127.0.0.1:4310", token: "credential.secret" });
    expect(startModelGateway).not.toHaveBeenCalled();
  });

  it("keeps the gateway credential stable when rotating an invalid Control Plane token", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ status: "ok" }))
      .mockResolvedValueOnce(response({ status: "ok" }))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({ error: { code: "authentication_required", message: "invalid credential" } }, 401))
      .mockResolvedValueOnce(response({ status: "ok" }))
      .mockResolvedValueOnce(response({ projects: [projectId] }))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({ goals: [{ goalId: "22222222-2222-4222-8222-222222222222", projectId, state: "draft", version: 1 }] }));
    const store = secretStore("old-credential.stable-secret");
    const runCommand = vi.fn(async (file: string, args: readonly string[], options?: { env?: Record<string, string | undefined> }) => {
      if (file === process.execPath && args.some((arg) => arg.endsWith("local-bootstrap.js"))) {
        expect(options?.env?.MAESTRO_LOCAL_BOOTSTRAP_SECRET).toBe("stable-secret");
        return { code: 0, stdout: JSON.stringify({ credentialId: "55555555-5555-4555-8555-555555555555" }), stderr: "" };
      }
      throw new Error(`unexpected command: ${file} ${args.join(" ")}`);
    });
    const startModelGateway = vi.fn(async () => undefined);
    await expect(resolveLocalConnection({ env: { MAESTRO_LOCAL_DATABASE_URL: "postgresql://localhost/maestro", MAESTRO_EMBEDDED_DATABASE_PORT: "55434" }, fetch, secretStore: store, runCommand, startModelGateway, retryDelayMs: 0 })).resolves.toEqual({ kind: "configured", apiUrl: "http://127.0.0.1:4310", token: "55555555-5555-4555-8555-555555555555.stable-secret" });
    expect(startModelGateway).not.toHaveBeenCalled();
    expect(store.read()).toBe("55555555-5555-4555-8555-555555555555.stable-secret");
  });

  it("reuses a keychain token after restarting the local Control Plane", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error("connection refused"))
      .mockResolvedValueOnce(response({ status: "ok" }))
      .mockResolvedValueOnce(response({ status: "ok" }))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({ projects: [projectId] }))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({ goals: [{ goalId: "22222222-2222-4222-8222-222222222222", projectId, state: "draft", version: 1 }] }));

    const runCommand = vi.fn(async (file: string, args: readonly string[]) => {
      if (file === "docker" && args[0] === "inspect") return { code: 0, stdout: "true", stderr: "" };
      if (file === "docker" && args[0] === "exec") return { code: 0, stdout: "accepting connections", stderr: "" };
      throw new Error(`unexpected command: ${file} ${args.join(" ")}`);
    });
    const startControlPlane = vi.fn(async () => undefined);

    await expect(resolveLocalConnection({ env: { MAESTRO_LOCAL_DB_ENGINE: "docker", MAESTRO_EMBEDDED_DATABASE_PORT: "55434" }, fetch, secretStore: secretStore("credential.secret"), runCommand, startControlPlane, retryDelayMs: 0 })).resolves.toEqual({
      kind: "configured",
      apiUrl: "http://127.0.0.1:4310",
      token: "credential.secret",
    });
    expect(startControlPlane).not.toHaveBeenCalled();
    expect(runCommand).not.toHaveBeenCalledWith(process.execPath, expect.anything(), expect.anything());
  });

  it("starts Docker PostgreSQL and Control Plane, bootstraps auth, and creates a default Goal", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error("connection refused"))
      .mockRejectedValueOnce(new Error("connection refused"))
      .mockResolvedValueOnce(response({ status: "ok" }))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({ status: "ok" }))
      .mockResolvedValueOnce(response({ projects: [projectId] }))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({ goals: [] }))
      .mockResolvedValueOnce(response({ goalId: "22222222-2222-4222-8222-222222222222", projectId, state: "draft", version: 1 }, 201));

    const store = secretStore();
    const runCommand = vi.fn(async (file: string, args: readonly string[], options?: { env?: Record<string, string | undefined> }) => {
      if (file === "docker" && args[0] === "inspect") return { code: 1, stdout: "", stderr: "not found" };
      if (file === "docker" && args[0] === "run") return { code: 0, stdout: "container-id", stderr: "" };
      if (file === "docker" && args[0] === "exec") return { code: 0, stdout: "accepting connections", stderr: "" };
      if (file === process.execPath && args.some((arg) => arg.endsWith("local-bootstrap.js"))) {
        expect(options?.env?.MAESTRO_LOCAL_BOOTSTRAP_SECRET).toBeTruthy();
        expect(options?.env?.MAESTRO_LOCAL_OPERATOR_ID).toMatch(UUID_PATTERN);
        expect(options?.env?.MAESTRO_LOCAL_CREDENTIAL_ID).toBe(options?.env?.MAESTRO_LOCAL_OPERATOR_ID);
        return { code: 0, stdout: JSON.stringify({ operatorId: "33333333-3333-4333-8333-333333333333", credentialId: "44444444-4444-4444-8444-444444444444", projectId }), stderr: "" };
      }
      throw new Error(`unexpected command: ${file} ${args.join(" ")}`);
    });
    const startModelGateway = vi.fn(async () => undefined);
    const startControlPlane = vi.fn(async () => undefined);

    const setupEvents: LocalBootstrapStepEvent[] = [];
    const result = await resolveLocalConnection({ env: { MAESTRO_LOCAL_DB_ENGINE: "docker" }, fetch, secretStore: store, runCommand, startModelGateway, startControlPlane, retryDelayMs: 0, onStep: (event) => setupEvents.push(event) });
    expect(setupEvents.filter((event) => event.status === "started").map((event) => event.step)).toEqual([
      "docker-check",
      "postgres-ready",
      "migrations",
      "control-plane-up",
      "model-gateway-up",
    ]);
    expect(result.kind).toBe("configured");
    if (result.kind === "configured") {
      expect(result.apiUrl).toBe("http://127.0.0.1:4310");
      expect(result.token).toMatch(/^44444444-4444-4444-8444-444444444444\./);
      expect(store.read()).toBe(result.token);
    }
    expect(startControlPlane).toHaveBeenCalledOnce();
    expect(runCommand).toHaveBeenCalledWith("docker", expect.arrayContaining(["run"]));
  });



  it("starts Control Plane before the model gateway and shares its service token", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error("connection refused"))
      .mockResolvedValueOnce(response({ status: "ok" }))
      .mockRejectedValueOnce(new Error("connection refused"))
      .mockResolvedValueOnce(response({ status: "ok" }))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({ projects: [projectId] }))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({ goals: [] }))
      .mockResolvedValueOnce(response({ goalId: "22222222-2222-4222-8222-222222222222", projectId, state: "draft", version: 1 }, 201));

    const runCommand = vi.fn(async (file: string, args: readonly string[], options?: { env?: Record<string, string | undefined> }) => {
      if (file === "docker" && args[0] === "inspect") return { code: 0, stdout: "true", stderr: "" };
      if (file === "docker" && args[0] === "exec") return { code: 0, stdout: "accepting connections", stderr: "" };
      if (file === process.execPath && args.some((arg) => arg.endsWith("local-bootstrap.js"))) {
        expect(options?.env?.MAESTRO_LOCAL_BOOTSTRAP_SECRET).toBeTruthy();
        expect(options?.env?.MAESTRO_LOCAL_OPERATOR_ID).toMatch(UUID_PATTERN);
        expect(options?.env?.MAESTRO_LOCAL_CREDENTIAL_ID).toBe(options?.env?.MAESTRO_LOCAL_OPERATOR_ID);
        return { code: 0, stdout: JSON.stringify({ credentialId: "44444444-4444-4444-8444-444444444444", projectId }), stderr: "" };
      }
      throw new Error(`unexpected command: ${file} ${args.join(" ")}`);
    });
    const startupOrder: string[] = [];
    const startModelGateway = vi.fn(async () => { startupOrder.push("model-gateway"); });
    let controlPlaneOptions: Record<string, unknown> | undefined;
    const startControlPlane = vi.fn(async (options: Record<string, unknown>) => { startupOrder.push("control-plane"); controlPlaneOptions = options; });

    const options = {
      env: {
        MAESTRO_LOCAL_DB_ENGINE: "docker",
        MAESTRO_CODEX_APP_SERVER_COMMAND: "/tmp/codex/app-server",
        MAESTRO_CODEX_MODELS: "gpt-5.3-codex",
        MAESTRO_MODEL_GATEWAY_OPERATOR_ID: "local-operator",
        MAESTRO_MODEL_ROUTING_MODE: "pin",
        MAESTRO_NATIVE_MODEL: "openai/gpt-5.3-codex",
        MAESTRO_ENSEMBLE_CANDIDATE_CATALOG: "/tmp/ensemble-candidates.json",
        MAESTRO_MODEL_ACCOUNT_REFS: "openai=openai-local-operator",
        MAESTRO_MODEL_MAP: "/tmp/model-map.json",
      },
      fetch,
      secretStore: secretStore(),
      runCommand,
      startModelGateway,
      startControlPlane,
      retryDelayMs: 0,
    };
    await expect(resolveLocalConnection(options)).resolves.toMatchObject({ kind: "configured" });
    expect(startupOrder).toEqual(["control-plane", "model-gateway"]);
    expect(startModelGateway).toHaveBeenCalledOnce();
    expect(startModelGateway.mock.calls[0]?.[0]).toMatchObject({
      apiUrl: "http://127.0.0.1:4321",
      operatorId: "local-operator",
      codexCommand: "/tmp/codex/app-server",
      codexModels: "gpt-5.3-codex",
    });
    expect(controlPlaneOptions).toMatchObject({
      modelGatewayUrl: "http://127.0.0.1:4321",
      modelGatewayToken: expect.any(String),
      modelGatewayOperatorId: "local-operator",
      modelRoutingMode: "pin",
      nativeModelRef: "openai/gpt-5.3-codex",
      ensembleCandidateCatalogPath: "/tmp/ensemble-candidates.json",
      modelAccountRefs: "openai=openai-local-operator",
      modelMapPath: "/tmp/model-map.json",
    });
    expect(controlPlaneOptions?.modelGatewayOperatorId).toBe((startModelGateway.mock.calls[0]?.[0] as { operatorId: string }).operatorId);
    expect(controlPlaneOptions?.modelGatewayToken).toBe((startModelGateway.mock.calls[0]?.[0] as { token: string }).token);
  });

  it("passes flexible Ensemble routing configuration to the local Control Plane", async () => {
    const controlPlane = buildLocalControlPlaneEnvironment({ entry: "/tmp/control-plane.js", databaseUrl: "postgresql://localhost/maestro", dataDir: "/tmp/maestro", apiUrl: "http://127.0.0.1:4399", modelGatewayUrl: "http://127.0.0.1:4321", modelGatewayToken: "service-token", modelGatewayOperatorId: "local-operator", modelRoutingMode: "ensemble", ensembleCandidateCatalogPath: "/tmp/ensemble-candidates.json", modelAccountRefs: "openai-codex=openai-codex-local-operator", modelMapPath: "/tmp/model-map.json" });
    expect(controlPlane).toMatchObject({ MAESTRO_MODEL_ROUTING_MODE: "ensemble", MAESTRO_ENSEMBLE_CANDIDATE_CATALOG: "/tmp/ensemble-candidates.json", MAESTRO_MODEL_ACCOUNT_REFS: "openai-codex=openai-codex-local-operator", MAESTRO_MODEL_MAP: "/tmp/model-map.json" });
  });

  it("stops an embedded database when model-gateway startup fails", async () => {
    const stopDatabase = vi.fn(async () => undefined);
    const fetch = vi.fn().mockRejectedValueOnce(new Error("Control Plane is down")).mockResolvedValueOnce(response({ status: "ok" }));
    const runCommand = vi.fn(async () => ({ code: 0, stdout: JSON.stringify({ credentialId: "44444444-4444-4444-8444-444444444444" }), stderr: "" }));
    const result = await resolveLocalConnection({
      env: { MAESTRO_LOCAL_DB_ENGINE: "embedded", MAESTRO_CONTROL_PLANE_ENTRY: "/tmp/control.js", MAESTRO_MODEL_GATEWAY_ENTRY: "/tmp/gateway.js" },
      fetch,
      secretStore: secretStore(),
      runCommand,
      startEmbeddedDatabase: vi.fn(async () => ({ databaseUrl: "postgresql://maestro@127.0.0.1:55433/maestro_local", stop: stopDatabase })),
      startControlPlane: vi.fn(async () => undefined),
      startModelGateway: vi.fn(async () => { throw new Error("gateway failed"); }),
      retryDelayMs: 0,
    });
    expect(result).toMatchObject({ kind: "setup-required", reason: expect.stringContaining("model gateway") });
    expect(stopDatabase).toHaveBeenCalledOnce();
  });

  it("reports migration helper failure before child startup", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("Control Plane is down"));
    const gatewayStop = vi.fn(async () => undefined);
    const startModelGateway = vi.fn(async (): Promise<LocalProcessHandle> => ({ stop: gatewayStop }));
    const startControlPlane = vi.fn(async () => undefined);
    const runCommand = vi.fn(async () => ({ code: 1, stdout: "", stderr: "bootstrap failed" }));
    const setupEvents: LocalBootstrapStepEvent[] = [];
    const result = await resolveLocalConnection({
      env: { MAESTRO_LOCAL_DATABASE_URL: "postgresql://localhost/maestro", MAESTRO_CONTROL_PLANE_ENTRY: "/tmp/control.js", MAESTRO_MODEL_GATEWAY_ENTRY: "/tmp/gateway.js" },
      fetch,
      secretStore: secretStore(),
      runCommand,
      startModelGateway,
      startControlPlane,
      retryDelayMs: 0,
      onStep: (event) => setupEvents.push(event),
    });
    expect(result).toMatchObject({ kind: "setup-required", reason: "Local operator bootstrap failed; check PostgreSQL and Control Plane logs" });
    expect(setupEvents.at(-1)).toMatchObject({ step: "migrations", status: "failed", message: expect.stringContaining("Local operator bootstrap failed") });
    expect(gatewayStop).not.toHaveBeenCalled();
  });

  it("stops newly started children when Control Plane startup fails", async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error("Control Plane is down"))
      .mockRejectedValue(new Error("Control Plane is still down"));
    const gatewayStop = vi.fn(async () => undefined);
    const controlPlaneStop = vi.fn(async () => undefined);
    const gatewayHandle: LocalProcessHandle = { stop: gatewayStop };
    const controlPlaneHandle: LocalProcessHandle = { stop: controlPlaneStop };
    const startModelGateway = vi.fn(async () => gatewayHandle);
    const startControlPlane = vi.fn(async () => controlPlaneHandle);
    const setupEvents: LocalBootstrapStepEvent[] = [];
    const result = await resolveLocalConnection({
      env: { MAESTRO_LOCAL_DATABASE_URL: "postgresql://localhost/maestro", MAESTRO_CONTROL_PLANE_ENTRY: "/tmp/control.js", MAESTRO_MODEL_GATEWAY_ENTRY: "/tmp/gateway.js" },
      fetch,
      secretStore: secretStore(),
      runCommand: vi.fn(async () => ({ code: 0, stdout: JSON.stringify({ credentialId: "44444444-4444-4444-8444-444444444444" }), stderr: "" })),
      startModelGateway,
      startControlPlane,
      retryDelayMs: 0,
      onStep: (event) => setupEvents.push(event),
    });
    expect(result.kind).toBe("setup-required");
    expect(setupEvents).toContainEqual(expect.objectContaining({ step: "control-plane-up", status: "failed", message: expect.stringContaining("Control Plane startup failed") }));
    expect(setupEvents).not.toContainEqual(expect.objectContaining({ step: "migrations", status: "failed" }));
    expect(gatewayStop).not.toHaveBeenCalled();
    expect(controlPlaneStop).toHaveBeenCalledOnce();
  });

  it("yields between zero-delay gateway startup probes", async () => {
    let childStarted = false;
    let controlPlaneStarted = false;
    const gatewayUrl = "http://127.0.0.1:46201";
    const projectId = "11111111-1111-4111-8111-111111111111";
    const startModelGateway = vi.fn(async () => {
      setImmediate(() => { childStarted = true; });
      return { stop: vi.fn(async () => undefined) };
    });
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith(gatewayUrl)) {
        if (!childStarted) throw new Error("gateway is not listening");
        if (url.endsWith("/healthz")) return response({ status: "ok" });
        return response([]);
      }
      if (!controlPlaneStarted) throw new Error("Control Plane is down");
      if (url.endsWith("/healthz")) return response({ status: "ok" });
      if (url.includes("/v1/projects")) return response({ projects: [projectId, "22222222-2222-4222-8222-222222222222"] });
      if (url.includes("/v1/models")) return response([]);
      if (url.includes("/v1/goals")) return response({ goals: [{ goalId: "22222222-2222-4222-8222-222222222222" }] });
      return response({});
    });
    const result = await resolveLocalConnection({
      env: { MAESTRO_API_URL: "http://127.0.0.1:46202", MAESTRO_MODEL_GATEWAY_URL: gatewayUrl, MAESTRO_MODEL_GATEWAY_ENTRY: "/tmp/gateway.js", MAESTRO_CONTROL_PLANE_ENTRY: "/tmp/control.js", MAESTRO_LOCAL_DATABASE_URL: "postgresql://localhost/maestro" },
      fetch,
      secretStore: secretStore(),
      runCommand: vi.fn(async () => ({ code: 0, stdout: JSON.stringify({ credentialId: "44444444-4444-4444-8444-444444444444" }), stderr: "" })),
      startModelGateway,
      startControlPlane: vi.fn(async () => {
        controlPlaneStarted = true;
      }),
      retryDelayMs: 0,
    });
    expect(result.kind).toBe("configured");
    expect(childStarted).toBe(true);
  });

  it("propagates gateway settings into the real detached child environment", async () => {
    const directory = await mkdtemp(`${tmpdir()}/maestro-gateway-test-`);
    const outputPath = `${directory}/environment.json`;
    const port = 46000 + Math.floor(Math.random() * 1000);
    const gatewayUrl = `http://127.0.0.1:${port}`;
    const entry = `${directory}/gateway.mjs`;
    await writeFile(entry, `import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
const token = process.env.MAESTRO_MODEL_GATEWAY_TOKEN;
const server = createServer((request, response) => {
  if (request.url === "/healthz") { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ status: "ok" })); return; }
  if (request.url === "/v1/models" && request.headers.authorization === "Bearer " + token) { response.writeHead(200, { "content-type": "application/json" }); response.end("[]"); return; }
  response.writeHead(401); response.end();
});
server.listen(Number(process.env.MAESTRO_MODEL_GATEWAY_PORT), process.env.MAESTRO_MODEL_GATEWAY_HOST, () => writeFileSync(${JSON.stringify(outputPath)}, JSON.stringify({ token, host: process.env.MAESTRO_MODEL_GATEWAY_HOST, port: process.env.MAESTRO_MODEL_GATEWAY_PORT, operator: process.env.MAESTRO_OPERATOR_ID, pid: process.pid, codexCommand: process.env.MAESTRO_CODEX_APP_SERVER_COMMAND, codexModels: process.env.MAESTRO_CODEX_MODELS })));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`);
    const realFetch = globalThis.fetch;
    let controlPlaneStarted = false;
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(gatewayUrl)) return realFetch(input, init);
      if (!controlPlaneStarted) throw new Error("Control Plane is down");
      if (url.endsWith("/healthz")) return response({ status: "ok" });
      return response({ error: { code: "authentication_required", message: "invalid credential" } }, 401);
    });
    try {
      const result = await resolveLocalConnection({
        env: { MAESTRO_API_URL: "http://127.0.0.1:46199", MAESTRO_MODEL_GATEWAY_URL: gatewayUrl, MAESTRO_MODEL_GATEWAY_ENTRY: entry, MAESTRO_CONTROL_PLANE_ENTRY: `${directory}/control.js`, MAESTRO_CODEX_APP_SERVER_COMMAND: "/tmp/codex", MAESTRO_CODEX_MODELS: "gpt-5.3-codex", MAESTRO_LOCAL_DATABASE_URL: "postgresql://localhost/maestro" },
        fetch,
        secretStore: secretStore(),
        runCommand: vi.fn(async () => ({ code: 0, stdout: JSON.stringify({ credentialId: "44444444-4444-4444-8444-444444444444" }), stderr: "" })),
        startControlPlane: vi.fn(async () => { controlPlaneStarted = true; }),
        retryDelayMs: 0,
      });
      expect(result.kind).toBe("setup-required");
      const childEnvironment = JSON.parse(await readFile(outputPath, "utf8")) as Record<string, string | undefined>;
      expect(childEnvironment).toEqual({ token: expect.any(String), host: "127.0.0.1", port: String(port), operator: expect.stringMatching(UUID_PATTERN), pid: expect.any(Number), codexCommand: "/tmp/codex", codexModels: "gpt-5.3-codex" });
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
      let childAlive = false;
      try { process.kill(Number(childEnvironment.pid), 0); childAlive = true; } catch { /* The cleanup handle terminated the child. */ }
      expect(childAlive).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("passes the gateway token and Codex configuration only through child environment builders", () => {
    const gateway = buildLocalModelGatewayEnvironment({ entry: "/tmp/gateway.js", apiUrl: "http://127.0.0.1:4321", token: "service-token", operatorId: "local-operator", codexCommand: "/tmp/codex", codexModels: "gpt-5.3-codex" });
    expect(gateway).toMatchObject({ MAESTRO_MODEL_GATEWAY_TOKEN: "service-token", MAESTRO_MODEL_GATEWAY_HOST: "127.0.0.1", MAESTRO_MODEL_GATEWAY_PORT: "4321", MAESTRO_OPERATOR_ID: "local-operator", MAESTRO_CODEX_APP_SERVER_COMMAND: "/tmp/codex", MAESTRO_CODEX_MODELS: "gpt-5.3-codex" });
    expect(gateway).not.toHaveProperty("OPENAI_API_KEY");
    const controlPlane = buildLocalControlPlaneEnvironment({ entry: "/tmp/control-plane.js", databaseUrl: "postgresql://localhost/maestro", dataDir: "/tmp/maestro", apiUrl: "http://127.0.0.1:4399", modelGatewayUrl: "http://127.0.0.1:4321", modelGatewayToken: "service-token", modelGatewayOperatorId: "local-operator" });
    expect(controlPlane).toMatchObject({ MAESTRO_HOST: "127.0.0.1", MAESTRO_PORT: "4399", MAESTRO_MODEL_GATEWAY_URL: "http://127.0.0.1:4321", MAESTRO_MODEL_GATEWAY_TOKEN: "service-token", MAESTRO_MODEL_GATEWAY_OPERATOR_ID: "local-operator" });
  });

  it("fails closed instead of auto-starting a non-loopback model gateway", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("connection refused"));
    const runCommand = vi.fn(async () => ({ code: 0, stdout: "accepting connections", stderr: "" }));
    await expect(resolveLocalConnection({ env: { MAESTRO_MODEL_GATEWAY_URL: "http://192.0.2.10:4321" }, fetch, secretStore: secretStore(), runCommand, retryDelayMs: 0 })).resolves.toEqual({ kind: "setup-required", reason: "Local model gateway auto-start requires a loopback host" });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("reports keychain persistence failure as a failed Control Plane step", async () => {
    const setupEvents: LocalBootstrapStepEvent[] = [];
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ status: "ok" }))
      .mockRejectedValueOnce(new Error("gateway is down"))
      .mockResolvedValueOnce(response({ status: "ok" }))
      .mockResolvedValueOnce(response([]));
    const runCommand = vi.fn(async () => ({
      code: 0,
      stdout: JSON.stringify({ credentialId: "44444444-4444-4444-8444-444444444444" }),
      stderr: "",
    }));
    const store: LocalSecretStore = {
      read: () => undefined,
      write: () => { throw new Error("keychain unavailable"); },
      clear: vi.fn(),
    };

    const result = await resolveLocalConnection({
      env: { MAESTRO_LOCAL_DATABASE_URL: "postgresql://localhost/maestro", MAESTRO_CONTROL_PLANE_ENTRY: "/tmp/control.js", MAESTRO_MODEL_GATEWAY_ENTRY: "/tmp/gateway.js" },
      fetch,
      secretStore: store,
      runCommand,
      startModelGateway: vi.fn(async () => undefined),
      retryDelayMs: 0,
      onStep: (event) => setupEvents.push(event),
    });

    expect(result).toMatchObject({ kind: "setup-required", reason: expect.stringContaining("OS keychain") });
    expect(setupEvents.at(-1)).toMatchObject({ step: "control-plane-up", status: "failed", message: expect.stringContaining("OS keychain") });
  });

  it("reports final Control Plane authentication failure as a failed Control Plane step", async () => {
    const setupEvents: LocalBootstrapStepEvent[] = [];
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ status: "ok" }))
      .mockRejectedValueOnce(new Error("gateway is down"))
      .mockResolvedValueOnce(response({ status: "ok" }))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({ error: { code: "authentication_required", message: "invalid credential" } }, 401));
    const runCommand = vi.fn(async () => ({
      code: 0,
      stdout: JSON.stringify({ credentialId: "44444444-4444-4444-8444-444444444444" }),
      stderr: "",
    }));

    const result = await resolveLocalConnection({
      env: { MAESTRO_LOCAL_DATABASE_URL: "postgresql://localhost/maestro", MAESTRO_CONTROL_PLANE_ENTRY: "/tmp/control.js", MAESTRO_MODEL_GATEWAY_ENTRY: "/tmp/gateway.js" },
      fetch,
      secretStore: secretStore(),
      runCommand,
      startModelGateway: vi.fn(async () => undefined),
      retryDelayMs: 0,
      onStep: (event) => setupEvents.push(event),
    });

    expect(result).toMatchObject({ kind: "setup-required", reason: "Local operator bootstrap completed but Control Plane authentication failed" });
    expect(setupEvents.at(-1)).toMatchObject({ step: "control-plane-up", status: "failed", message: "Local operator bootstrap completed but Control Plane authentication failed" });
  });

  it("reports the bootstrap step that failed", async () => {
    const setupEvents: LocalBootstrapStepEvent[] = [];
    const fetch = vi.fn().mockRejectedValue(new Error("connection refused"));
    const runCommand = vi.fn(async () => ({ code: 127, stdout: "", stderr: "docker: command not found" }));

    await resolveLocalConnection({ env: { MAESTRO_LOCAL_DB_ENGINE: "docker" }, fetch, secretStore: secretStore(), runCommand, retryDelayMs: 0, onStep: (event) => setupEvents.push(event) });

    expect(setupEvents.at(-1)).toMatchObject({ step: "docker-check", status: "failed", message: expect.stringContaining("Docker") });
  });

  it("returns actionable guidance when Docker is unavailable", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("connection refused"));
    const runCommand = vi.fn(async () => ({ code: 127, stdout: "", stderr: "docker: command not found" }));

    await expect(resolveLocalConnection({ env: { MAESTRO_LOCAL_DB_ENGINE: "docker" }, fetch, secretStore: secretStore(), runCommand, retryDelayMs: 0 })).resolves.toMatchObject({
      kind: "setup-required",
      reason: expect.stringContaining("Docker"),
    });
  });
});
