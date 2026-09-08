import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { buildLocalControlPlaneEnvironment, buildLocalModelGatewayEnvironment, resolveLocalConnection, type LocalProcessHandle, type LocalSecretStore } from "./local-bootstrap.js";

function secretStore(initial?: string): LocalSecretStore {
  let value = initial;
  return {
    read: () => value,
    write: (next) => { value = next; },
    clear: () => { value = undefined; },
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("resolveLocalConnection", () => {
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
    await expect(resolveLocalConnection({ env: { MAESTRO_LOCAL_DATABASE_URL: "postgresql://localhost/maestro" }, fetch, secretStore: store, runCommand, startModelGateway, retryDelayMs: 0 })).resolves.toEqual({ kind: "configured", apiUrl: "http://127.0.0.1:4310", token: "55555555-5555-4555-8555-555555555555.stable-secret" });
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

    await expect(resolveLocalConnection({ env: {}, fetch, secretStore: secretStore("credential.secret"), runCommand, startControlPlane, retryDelayMs: 0 })).resolves.toEqual({
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

    const result = await resolveLocalConnection({ env: {}, fetch, secretStore: store, runCommand, startModelGateway, startControlPlane, retryDelayMs: 0 });
    expect(result.kind).toBe("configured");
    if (result.kind === "configured") {
      expect(result.apiUrl).toBe("http://127.0.0.1:4310");
      expect(result.token).toMatch(/^44444444-4444-4444-8444-444444444444\./);
      expect(store.read()).toBe(result.token);
    }
    expect(startControlPlane).toHaveBeenCalledOnce();
    expect(runCommand).toHaveBeenCalledWith("docker", expect.arrayContaining(["run"]));
  });



  it("starts a model gateway before auto-starting Control Plane and shares its service token", async () => {
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
    const startModelGateway = vi.fn(async () => undefined);
    let controlPlaneOptions: Record<string, unknown> | undefined;
    const startControlPlane = vi.fn(async (options: Record<string, unknown>) => { controlPlaneOptions = options; });

    const options = {
      env: {
        MAESTRO_CODEX_APP_SERVER_COMMAND: "/tmp/codex/app-server",
        MAESTRO_CODEX_MODELS: "gpt-5.3-codex",
        MAESTRO_MODEL_GATEWAY_OPERATOR_ID: "local-operator",
      },
      fetch,
      secretStore: secretStore(),
      runCommand,
      startModelGateway,
      startControlPlane,
      retryDelayMs: 0,
    };
    await expect(resolveLocalConnection(options)).resolves.toMatchObject({ kind: "configured" });
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
    });
    expect(controlPlaneOptions?.modelGatewayOperatorId).toBe((startModelGateway.mock.calls[0]?.[0] as { operatorId: string }).operatorId);
    expect(controlPlaneOptions?.modelGatewayToken).toBe((startModelGateway.mock.calls[0]?.[0] as { token: string }).token);
  });

  it("stops a gateway when operator bootstrap fails after child startup", async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error("Control Plane is down"))
      .mockRejectedValueOnce(new Error("gateway is down"))
      .mockResolvedValueOnce(response({ status: "ok" }))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({ status: "ok" }));
    const gatewayStop = vi.fn(async () => undefined);
    const startModelGateway = vi.fn(async (): Promise<LocalProcessHandle> => ({ stop: gatewayStop }));
    const startControlPlane = vi.fn(async () => undefined);
    const runCommand = vi.fn(async () => ({ code: 1, stdout: "", stderr: "bootstrap failed" }));
    const result = await resolveLocalConnection({
      env: { MAESTRO_LOCAL_DATABASE_URL: "postgresql://localhost/maestro", MAESTRO_CONTROL_PLANE_ENTRY: "/tmp/control.js", MAESTRO_MODEL_GATEWAY_ENTRY: "/tmp/gateway.js" },
      fetch,
      secretStore: secretStore(),
      runCommand,
      startModelGateway,
      startControlPlane,
      retryDelayMs: 0,
    });
    expect(result).toMatchObject({ kind: "setup-required", reason: "Local operator bootstrap failed; check PostgreSQL and Control Plane logs" });
    expect(gatewayStop).toHaveBeenCalledOnce();
  });

  it("stops newly started children when Control Plane startup fails", async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error("Control Plane is down"))
      .mockRejectedValueOnce(new Error("gateway is down"))
      .mockResolvedValueOnce(response({ status: "ok" }))
      .mockResolvedValueOnce(response([]))
      .mockRejectedValue(new Error("Control Plane is still down"));
    const gatewayStop = vi.fn(async () => undefined);
    const controlPlaneStop = vi.fn(async () => undefined);
    const gatewayHandle: LocalProcessHandle = { stop: gatewayStop };
    const controlPlaneHandle: LocalProcessHandle = { stop: controlPlaneStop };
    const startModelGateway = vi.fn(async () => gatewayHandle);
    const startControlPlane = vi.fn(async () => controlPlaneHandle);
    const result = await resolveLocalConnection({
      env: { MAESTRO_LOCAL_DATABASE_URL: "postgresql://localhost/maestro", MAESTRO_CONTROL_PLANE_ENTRY: "/tmp/control.js", MAESTRO_MODEL_GATEWAY_ENTRY: "/tmp/gateway.js" },
      fetch,
      secretStore: secretStore(),
      runCommand: vi.fn(),
      startModelGateway,
      startControlPlane,
      retryDelayMs: 0,
    });
    expect(result.kind).toBe("setup-required");
    expect(gatewayStop).toHaveBeenCalledOnce();
    expect(controlPlaneStop).toHaveBeenCalledOnce();
  });

  it("yields between zero-delay gateway startup probes", async () => {
    let childStarted = false;
    let controlPlaneStarted = false;
    const gatewayUrl = "http://127.0.0.1:46201";
    const startModelGateway = vi.fn(async () => {
      setImmediate(() => { childStarted = true; });
      return { stop: vi.fn(async () => undefined) };
    });
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith(gatewayUrl)) {
        if (!childStarted) throw new Error("gateway is not listening");
        if (String(input).endsWith("/healthz")) return response({ status: "ok" });
        return response([]);
      }
      if (!controlPlaneStarted) throw new Error("Control Plane is down");
      return response({ status: "ok" });
    });
    const result = await resolveLocalConnection({
      env: { MAESTRO_API_URL: "http://127.0.0.1:46202", MAESTRO_MODEL_GATEWAY_URL: gatewayUrl, MAESTRO_MODEL_GATEWAY_ENTRY: "/tmp/gateway.js", MAESTRO_CONTROL_PLANE_ENTRY: "/tmp/control.js", MAESTRO_LOCAL_DATABASE_URL: "postgresql://localhost/maestro" },
      fetch,
      secretStore: secretStore(),
      runCommand: vi.fn(async () => ({ code: 1, stdout: "", stderr: "bootstrap failed" })),
      startModelGateway,
      startControlPlane: vi.fn(async () => {
        controlPlaneStarted = true;
      }),
      retryDelayMs: 0,
    });
    expect(result).toEqual({ kind: "setup-required", reason: "Local operator bootstrap failed; check PostgreSQL and Control Plane logs" });
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
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith(gatewayUrl)) return realFetch(input, init);
      throw new Error("Control Plane is down");
    });
    try {
      const result = await resolveLocalConnection({
        env: { MAESTRO_API_URL: "http://127.0.0.1:46199", MAESTRO_MODEL_GATEWAY_URL: gatewayUrl, MAESTRO_MODEL_GATEWAY_ENTRY: entry, MAESTRO_CONTROL_PLANE_ENTRY: `${directory}/control.js`, MAESTRO_CODEX_APP_SERVER_COMMAND: "/tmp/codex", MAESTRO_CODEX_MODELS: "gpt-5.3-codex", MAESTRO_LOCAL_DATABASE_URL: "postgresql://localhost/maestro" },
        fetch,
        secretStore: secretStore(),
        runCommand: vi.fn(),
        startControlPlane: vi.fn(async () => undefined),
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

  it("returns actionable guidance when Docker is unavailable", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("connection refused"));
    const runCommand = vi.fn(async () => ({ code: 127, stdout: "", stderr: "docker: command not found" }));

    await expect(resolveLocalConnection({ env: {}, fetch, secretStore: secretStore(), runCommand, retryDelayMs: 0 })).resolves.toMatchObject({
      kind: "setup-required",
      reason: expect.stringContaining("Docker"),
    });
  });
});
