import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Entry } from "@napi-rs/keyring";
import { ApiError, createApiClient } from "@maestro/api-client";
import type { ConnectionEnvironment, ConnectionState } from "./connection.js";
import { ensureLocalControlPlane } from "./local-control-plane.js";

export const DEFAULT_LOCAL_API_URL = "http://127.0.0.1:4310";
export const DEFAULT_LOCAL_DATABASE_URL = "postgresql://maestro@127.0.0.1:55432/maestro_local";
export const LOCAL_POSTGRES_CONTAINER = "maestro-local-postgres";

export interface LocalSecretStore {
  read(): string | undefined;
  write(value: string): void;
  clear(): void;
}

export interface LocalCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type LocalCommandRunner = (
  file: string,
  args: readonly string[],
  options?: { cwd?: string; env?: Record<string, string | undefined> },
) => Promise<LocalCommandResult>;

export interface LocalProcessHandle {
  stop(): Promise<void>;
}

export interface LocalModelGatewayLaunchOptions {
  entry: string;
  apiUrl: string;
  token: string;
  operatorId: string;
  codexCommand?: string;
  codexModels?: string;
}

export interface LocalControlPlaneLaunchOptions {
  entry: string;
  databaseUrl: string;
  dataDir: string;
  apiUrl: string;
  modelGatewayUrl: string;
  modelGatewayToken: string;
  modelGatewayOperatorId: string;
}

export interface LocalBootstrapOptions {
  env: ConnectionEnvironment;
  fetch?: typeof globalThis.fetch;
  secretStore?: LocalSecretStore;
  runCommand?: LocalCommandRunner;
  startControlPlane?: (options: LocalControlPlaneLaunchOptions) => Promise<LocalProcessHandle | void>;
  startModelGateway?: (options: LocalModelGatewayLaunchOptions) => Promise<LocalProcessHandle | void>;
  retryDelayMs?: number;
}

const defaultSecretStore = (): LocalSecretStore => {
  const entry = new Entry("maestro", "local-control-plane");
  return {
    read: () => {
      try {
        const value = entry.getPassword();
        return value === null || value.trim() === "" ? undefined : value;
      } catch {
        return undefined;
      }
    },
    write: (value) => entry.setPassword(value),
    clear: () => {
      try { entry.deletePassword(); } catch { /* Missing keychain entries are already clear. */ }
    },
  };
};

const defaultRunCommand: LocalCommandRunner = (file, args, options) => new Promise((resolveResult) => {
  execFile(file, [...args], {
    ...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options?.env === undefined ? {} : { env: options.env }),
    maxBuffer: 1_024 * 1_024,
  }, (error, stdout, stderr) => {
    const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
    resolveResult({ code, stdout: String(stdout), stderr: String(stderr) });
  });
});

const defaultStartModelGateway = async (options: LocalModelGatewayLaunchOptions): Promise<LocalProcessHandle> => {
  const child = spawn(process.execPath, [options.entry], {
    cwd: dirname(options.entry),
    env: buildLocalModelGatewayEnvironment(options),
    detached: true,
    stdio: "ignore",
  });
  return detachProcess(child);
};

const defaultStartControlPlane = async (options: LocalControlPlaneLaunchOptions): Promise<LocalProcessHandle> => {
  const child = spawn(process.execPath, [options.entry], {
    cwd: dirname(options.entry),
    env: buildLocalControlPlaneEnvironment(options),
    detached: true,
    stdio: "ignore",
  });
  return detachProcess(child);
};

function detachProcess(child: ReturnType<typeof spawn>): LocalProcessHandle {
  // Detached children otherwise become untracked orphans when a later startup
  // step fails. Keep a kill handle while still allowing the successful process
  // to outlive this CLI invocation.
  child.once("error", () => undefined);
  child.unref();
  return {
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      try { child.kill("SIGTERM"); } catch { /* The child may have exited between checks. */ }
    },
  };
}

/**
 * Resolve a local connection without putting a bearer secret in a file. The
 * first run creates the local operator through the Control Plane bootstrap
 * helper, then stores only the bearer in the platform keychain.
 */
export async function resolveLocalConnection(options: LocalBootstrapOptions): Promise<ConnectionState> {
  const apiUrl = normalizeApiUrl(options.env.MAESTRO_API_URL);
  let modelGatewayUrl: string;
  try { modelGatewayUrl = normalizeModelGatewayUrl(options.env.MAESTRO_MODEL_GATEWAY_URL); }
  catch (error) { return { kind: "setup-required", reason: error instanceof Error ? error.message : "MAESTRO_MODEL_GATEWAY_URL is invalid" }; }
  const fetch = options.fetch ?? globalThis.fetch;
  const secretStore = options.secretStore ?? defaultSecretStore();
  const runCommand = options.runCommand ?? defaultRunCommand;
  const retryDelayMs = options.retryDelayMs ?? 500;
  let storedToken = secretStore.read();
  let bootstrapSecret: string | undefined;
  const configuredOperatorId = options.env.MAESTRO_LOCAL_OPERATOR_ID?.trim();
  if (configuredOperatorId !== undefined && !isCanonicalUuid(configuredOperatorId)) {
    return { kind: "setup-required", reason: "MAESTRO_LOCAL_OPERATOR_ID must be a canonical UUID" };
  }
  const localOperatorId = configuredOperatorId || extractUuidCredentialId(storedToken) || randomUUID();
  let gatewayReady = false;
  let ownedGateway: LocalProcessHandle | undefined;
  let ownedControlPlane: LocalProcessHandle | undefined;
  const stopOwnedProcesses = async (): Promise<void> => {
    const controlPlane = ownedControlPlane;
    const gateway = ownedGateway;
    ownedControlPlane = undefined;
    ownedGateway = undefined;
    await controlPlane?.stop().catch(() => undefined);
    await gateway?.stop().catch(() => undefined);
  };

  if (storedToken !== undefined) {
    const health = await ensureLocalControlPlane({ apiUrl, fetch });
    if (health.kind === "ready") {
      const localSecret = extractLocalSecret(storedToken);
      if (localSecret === undefined) {
        secretStore.clear();
        storedToken = undefined;
      } else {
        const gateway = await ensureLocalModelGatewayForBootstrap({
          env: options.env,
          operatorId: localOperatorId,
          apiUrl: modelGatewayUrl,
          token: options.env.MAESTRO_MODEL_GATEWAY_TOKEN?.trim() || deriveModelGatewayToken(localSecret),
          fetch,
          retryDelayMs,
          ...(options.startModelGateway === undefined ? {} : { startModelGateway: options.startModelGateway }),
        });
        if (gateway.kind !== "ready") return { kind: "setup-required", reason: gateway.reason };
        ownedGateway = gateway.process;
        gatewayReady = true;
        const validation = await validateLocalToken(apiUrl, storedToken, fetch);
        if (validation.kind === "valid") return { kind: "configured", apiUrl, token: storedToken };
        if (validation.kind === "unavailable") {
          await stopOwnedProcesses();
          return { kind: "setup-required", reason: validation.reason };
        }
        // Keep the stable local secret when rotating only the Control Plane
        // credential. The gateway token is derived from this secret, so the
        // running gateway and the new Control Plane process remain compatible.
        bootstrapSecret = localSecret;
        secretStore.clear();
        storedToken = undefined;
      }
    }
  }

  const databaseUrl = options.env.MAESTRO_LOCAL_DATABASE_URL?.trim() || DEFAULT_LOCAL_DATABASE_URL;
  const database = await ensureLocalDatabase({ databaseUrl, runCommand, retryDelayMs });
  if (database.kind === "unavailable") return { kind: "setup-required", reason: database.reason };

  const initialHealth = await ensureLocalControlPlane({ apiUrl, fetch });
  if (initialHealth.kind !== "ready") {
    const entry = resolveControlPlaneEntry(options.env);
    if (entry === undefined) {
      return {
        kind: "setup-required",
        reason: "Local Control Plane is not running and its executable was not found; set MAESTRO_CONTROL_PLANE_ENTRY or configure MAESTRO_API_URL and MAESTRO_API_TOKEN",
      };
    }
    bootstrapSecret = extractLocalSecret(storedToken) ?? randomBytes(32).toString("base64url");
    const modelGatewayToken = options.env.MAESTRO_MODEL_GATEWAY_TOKEN?.trim() || deriveModelGatewayToken(bootstrapSecret);
    const gateway = await ensureLocalModelGatewayForBootstrap({
      env: options.env,
      operatorId: localOperatorId,
      apiUrl: modelGatewayUrl,
      token: modelGatewayToken,
      fetch,
      retryDelayMs,
      ...(options.startModelGateway === undefined ? {} : { startModelGateway: options.startModelGateway }),
    });
    if (gateway.kind !== "ready") return { kind: "setup-required", reason: gateway.reason };
    ownedGateway = gateway.process;
    const modelGatewayOperatorId = options.env.MAESTRO_MODEL_GATEWAY_OPERATOR_ID?.trim() || localOperatorId;
    const dataDir = options.env.MAESTRO_LOCAL_DATA_DIR?.trim() || join(homedir(), ".local", "share", "maestro");
    try {
      await makeLocalDataDirectories(dataDir);
      ownedControlPlane = await (options.startControlPlane ?? defaultStartControlPlane)({ entry, databaseUrl, dataDir, apiUrl, modelGatewayUrl, modelGatewayToken, modelGatewayOperatorId }) ?? undefined;
    } catch {
      await stopOwnedProcesses();
      return { kind: "setup-required", reason: "Local Control Plane could not be started; check its executable and local data directory permissions" };
    }
    // Fresh PostgreSQL migrations and a cold Node process can take several
    // seconds. Retry failed connections, not just hanging requests, while
    // keeping the whole startup window bounded.
    const started = await waitForLocalControlPlane({ apiUrl, fetch, retryDelayMs });
    if (started.kind !== "ready") {
      await stopOwnedProcesses();
      return { kind: "setup-required", reason: `Local Control Plane startup failed: ${started.reason}` };
    }
  }

  if (initialHealth.kind === "ready" && !gatewayReady) {
    bootstrapSecret = extractLocalSecret(storedToken) ?? randomBytes(32).toString("base64url");
    const modelGatewayToken = options.env.MAESTRO_MODEL_GATEWAY_TOKEN?.trim() || deriveModelGatewayToken(bootstrapSecret);
    const gateway = await ensureLocalModelGatewayForBootstrap({
      env: options.env,
      operatorId: localOperatorId,
      apiUrl: modelGatewayUrl,
      token: modelGatewayToken,
      fetch,
      retryDelayMs,
      ...(options.startModelGateway === undefined ? {} : { startModelGateway: options.startModelGateway }),
    });
    if (gateway.kind !== "ready") return { kind: "setup-required", reason: gateway.reason };
    ownedGateway = gateway.process;
    gatewayReady = true;
  }

  // A keychain token may have been valid before a restart even though the
  // Control Plane was temporarily down. Reuse it after the local process is
  // back instead of issuing another credential on every launch.
  if (storedToken !== undefined) {
    const validation = await validateLocalToken(apiUrl, storedToken, fetch);
    if (validation.kind === "valid") return { kind: "configured", apiUrl, token: storedToken };
    if (validation.kind === "unavailable") {
      await stopOwnedProcesses();
      return { kind: "setup-required", reason: validation.reason };
    }
    bootstrapSecret = extractLocalSecret(storedToken);
    secretStore.clear();
    storedToken = undefined;
  }

  const secret = bootstrapSecret ?? randomBytes(32).toString("base64url");
  const projectId = randomUUID();
  const bootstrap = await runBootstrapHelper({ env: options.env, databaseUrl, secret, projectId, operatorId: localOperatorId, runCommand });
  if (bootstrap.kind === "unavailable") {
    await stopOwnedProcesses();
    return { kind: "setup-required", reason: bootstrap.reason };
  }
  const token = `${bootstrap.credentialId}.${secret}`;
  try {
    secretStore.write(token);
  } catch {
    await stopOwnedProcesses();
    return { kind: "setup-required", reason: "Local operator was created, but the OS keychain is unavailable; set MAESTRO_API_TOKEN explicitly or enable a system keychain" };
  }

  const validation = await validateLocalToken(apiUrl, token, fetch);
  if (validation.kind !== "valid") {
    await stopOwnedProcesses();
    secretStore.clear();
    return { kind: "setup-required", reason: validation.kind === "unavailable" ? validation.reason : "Local operator bootstrap completed but Control Plane authentication failed" };
  }
  return { kind: "configured", apiUrl, token };
}

type LocalTokenValidation =
  | { kind: "valid" }
  | { kind: "invalid" }
  | { kind: "unavailable"; reason: string };

async function validateLocalToken(apiUrl: string, token: string, fetch: typeof globalThis.fetch): Promise<LocalTokenValidation> {
  try {
    const client = createApiClient({ baseUrl: apiUrl, token, fetch });
    const projects = (await client.listProjects()).projects;
    if (projects.length === 0) return { kind: "invalid" };
    // A healthy Control Plane alone is not enough for conversations or login:
    // this authenticated read proves its model-gateway composition is usable.
    await client.listModels();
    if (projects.length !== 1) return { kind: "valid" };
    const projectId = projects[0]!;
    const goals = (await client.listGoals(projectId)).goals;
    if (goals.length === 0) await client.createGoal({ projectId }, randomUUID());
    return { kind: "valid" };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return { kind: "invalid" };
    return { kind: "unavailable", reason: `Local Control Plane authentication check failed: ${error instanceof Error ? error.message : "request unavailable"}` };
  }
}

type LocalModelGatewayProbe =
  | { kind: "ready" }
  | { kind: "unavailable"; reason: string; reachable: boolean }
  | { kind: "unauthorized" };

async function requestLocalModelGateway(options: {
  url: string;
  fetch: typeof globalThis.fetch;
  headers?: Record<string, string>;
  timeoutMs: number;
}): Promise<Response | undefined> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = options.fetch(options.url, {
      method: "GET",
      headers: { accept: "application/json", ...options.headers },
      signal: controller.signal,
    });
    request.catch(() => undefined);
    const timeout = new Promise<undefined>((resolveTimeout) => {
      timer = setTimeout(() => { controller.abort(); resolveTimeout(undefined); }, options.timeoutMs);
    });
    return await Promise.race([request, timeout]);
  } catch {
    return undefined;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function probeLocalModelGateway(options: {
  apiUrl: string;
  token: string;
  fetch: typeof globalThis.fetch;
  timeoutMs?: number;
}): Promise<LocalModelGatewayProbe> {
  const timeoutMs = options.timeoutMs ?? 1_000;
  const health = await requestLocalModelGateway({ url: `${options.apiUrl}/healthz`, fetch: options.fetch, timeoutMs });
  if (health === undefined) return { kind: "unavailable", reason: "Model gateway is not reachable", reachable: false };
  if (!health.ok) return { kind: "unavailable", reason: "Model gateway is running but not ready", reachable: true };
  const authorized = await requestLocalModelGateway({
    url: `${options.apiUrl}/v1/models`,
    fetch: options.fetch,
    headers: { authorization: `Bearer ${options.token}` },
    timeoutMs,
  });
  if (authorized === undefined) return { kind: "unavailable", reason: "Model gateway authorization check timed out", reachable: true };
  if (authorized.status === 401 || authorized.status === 403) return { kind: "unauthorized" };
  if (!authorized.ok) return { kind: "unavailable", reason: "Model gateway authorization check failed", reachable: true };
  return { kind: "ready" };
}

async function ensureLocalModelGatewayForBootstrap(options: {
  env: ConnectionEnvironment;
  operatorId: string;
  apiUrl: string;
  token: string;
  fetch: typeof globalThis.fetch;
  retryDelayMs: number;
  startModelGateway?: (options: LocalModelGatewayLaunchOptions) => Promise<LocalProcessHandle | void>;
}): Promise<{ kind: "ready"; process?: LocalProcessHandle } | { kind: "setup-required"; reason: string }> {
  let current = await probeLocalModelGateway({ apiUrl: options.apiUrl, token: options.token, fetch: options.fetch });
  if (current.kind === "ready") return current;
  if (current.kind === "unauthorized") return { kind: "setup-required", reason: "A local model gateway is already running with a different service credential; stop it or set MAESTRO_MODEL_GATEWAY_TOKEN to its credential" };
  if (current.reachable) {
    current = await waitForLocalModelGateway({ apiUrl: options.apiUrl, token: options.token, fetch: options.fetch, retryDelayMs: options.retryDelayMs });
    if (current.kind === "ready") return current;
    if (current.kind === "unauthorized") return { kind: "setup-required", reason: "A local model gateway is already running with a different service credential; stop it or set MAESTRO_MODEL_GATEWAY_TOKEN to its credential" };
    return { kind: "setup-required", reason: `Local model gateway is already running but did not become ready: ${current.reason}` };
  }
  const entry = resolveModelGatewayEntry(options.env);
  if (entry === undefined) return { kind: "setup-required", reason: "Local model gateway is not running and its executable was not found; set MAESTRO_MODEL_GATEWAY_ENTRY or configure the gateway separately" };
  const operatorId = options.env.MAESTRO_MODEL_GATEWAY_OPERATOR_ID?.trim() || options.env.MAESTRO_LOCAL_OPERATOR_ID?.trim() || options.operatorId;
  let startedProcess: LocalProcessHandle | undefined;
  try {
    startedProcess = await (options.startModelGateway ?? defaultStartModelGateway)({
      entry,
      apiUrl: options.apiUrl,
      token: options.token,
      operatorId,
      ...(options.env.MAESTRO_CODEX_APP_SERVER_COMMAND?.trim() ? { codexCommand: options.env.MAESTRO_CODEX_APP_SERVER_COMMAND.trim() } : {}),
      ...(options.env.MAESTRO_CODEX_MODELS?.trim() ? { codexModels: options.env.MAESTRO_CODEX_MODELS.trim() } : {}),
    }) ?? undefined;
  } catch {
    return { kind: "setup-required", reason: "Local model gateway could not be started; check its executable and local configuration" };
  }
  current = await waitForLocalModelGateway({ apiUrl: options.apiUrl, token: options.token, fetch: options.fetch, retryDelayMs: options.retryDelayMs });
  if (current.kind === "ready") return { kind: "ready", ...(startedProcess === undefined ? {} : { process: startedProcess }) };
  await startedProcess?.stop().catch(() => undefined);
  if (current.kind === "unauthorized") return { kind: "setup-required", reason: "Local model gateway started, but its service credential did not match" };
  return { kind: "setup-required", reason: `Local model gateway startup failed: ${current.reason}` };
}

async function waitForLocalModelGateway(options: {
  apiUrl: string;
  token: string;
  fetch: typeof globalThis.fetch;
  retryDelayMs: number;
}): Promise<LocalModelGatewayProbe> {
  let last = await probeLocalModelGateway({ apiUrl: options.apiUrl, token: options.token, fetch: options.fetch });
  for (let attempt = 1; attempt < 120 && last.kind === "unavailable"; attempt += 1) {
    await delay(Math.max(options.retryDelayMs, 1));
    last = await probeLocalModelGateway({ apiUrl: options.apiUrl, token: options.token, fetch: options.fetch });
  }
  return last;
}

async function waitForLocalControlPlane(options: {
  apiUrl: string;
  fetch: typeof globalThis.fetch;
  retryDelayMs: number;
}): Promise<Awaited<ReturnType<typeof ensureLocalControlPlane>>> {
  let last = await ensureLocalControlPlane({ apiUrl: options.apiUrl, fetch: options.fetch, timeoutMs: 1_000 });
  for (let attempt = 1; attempt < 120 && last.kind !== "ready"; attempt += 1) {
    await delay(Math.max(options.retryDelayMs, 1));
    last = await ensureLocalControlPlane({ apiUrl: options.apiUrl, fetch: options.fetch, timeoutMs: 1_000 });
  }
  return last;
}

async function runBootstrapHelper(options: {
  env: ConnectionEnvironment;
  databaseUrl: string;
  secret: string;
  projectId: string;
  operatorId: string;
  runCommand: LocalCommandRunner;
}): Promise<{ kind: "ready"; credentialId: string } | { kind: "unavailable"; reason: string }> {
  const entry = resolveControlPlaneEntry(options.env);
  if (entry === undefined) return { kind: "unavailable", reason: "Local bootstrap helper was not found; set MAESTRO_CONTROL_PLANE_ENTRY or configure MAESTRO_API_URL and MAESTRO_API_TOKEN" };
  const result = await options.runCommand(process.execPath, [join(dirname(entry), "local-bootstrap.js")], {
    env: localHelperEnvironment(options),
  });
  if (result.code !== 0) return { kind: "unavailable", reason: "Local operator bootstrap failed; check PostgreSQL and Control Plane logs" };
  try {
    const parsed = JSON.parse(result.stdout) as { credentialId?: unknown };
    if (typeof parsed.credentialId !== "string" || !isCanonicalUuid(parsed.credentialId)) throw new Error("invalid credential");
    return { kind: "ready", credentialId: parsed.credentialId };
  } catch {
    return { kind: "unavailable", reason: "Local operator bootstrap returned an invalid result" };
  }
}

async function ensureLocalDatabase(options: {
  databaseUrl: string;
  runCommand: LocalCommandRunner;
  retryDelayMs: number;
}): Promise<{ kind: "ready"; databaseUrl: string } | { kind: "unavailable"; reason: string }> {
  if (options.databaseUrl !== DEFAULT_LOCAL_DATABASE_URL) return { kind: "ready", databaseUrl: options.databaseUrl };
  const inspect = await options.runCommand("docker", ["inspect", "--format", "{{.State.Running}}", LOCAL_POSTGRES_CONTAINER]);
  if (inspect.code !== 0) {
    const started = await options.runCommand("docker", [
      "run", "-d", "--name", LOCAL_POSTGRES_CONTAINER, "--restart", "unless-stopped",
      "-e", "POSTGRES_USER=maestro", "-e", "POSTGRES_DB=maestro_local", "-e", "POSTGRES_HOST_AUTH_METHOD=trust",
      "-p", "127.0.0.1:55432:5432", "-v", "maestro-local-postgres-data:/var/lib/postgresql/data", "postgres:17-alpine",
    ]);
    if (started.code !== 0) return { kind: "unavailable", reason: dockerUnavailableReason(started.stderr || inspect.stderr) };
  } else if (inspect.stdout.trim() !== "true") {
    const started = await options.runCommand("docker", ["start", LOCAL_POSTGRES_CONTAINER]);
    if (started.code !== 0) return { kind: "unavailable", reason: "Docker PostgreSQL exists but could not be started; run `docker logs maestro-local-postgres`" };
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const ready = await options.runCommand("docker", ["exec", LOCAL_POSTGRES_CONTAINER, "pg_isready", "-U", "maestro", "-d", "maestro_local"]);
    if (ready.code === 0) return { kind: "ready", databaseUrl: options.databaseUrl };
    if (options.retryDelayMs > 0) await delay(options.retryDelayMs);
  }
  return { kind: "unavailable", reason: "Docker PostgreSQL started but did not become ready; run `docker logs maestro-local-postgres`" };
}

function dockerUnavailableReason(detail: string): string {
  if (/not found|cannot connect|is the docker daemon running/i.test(detail)) return "Docker is required for local automatic setup but is not available; install/start Docker or set MAESTRO_LOCAL_DATABASE_URL";
  return "Docker PostgreSQL could not be started; run `docker ps -a` and check the maestro-local-postgres container";
}

function resolveModelGatewayEntry(env: ConnectionEnvironment): string | undefined {
  const explicit = env.MAESTRO_MODEL_GATEWAY_ENTRY?.trim();
  if (explicit !== undefined && explicit !== "") return resolve(explicit);
  const cwdCandidate = resolve(process.cwd(), "apps", "model-gateway", "dist", "main.js");
  try { if (requireFile(cwdCandidate)) return cwdCandidate; } catch { /* Continue to the installed-layout candidate. */ }
  const installedCandidate = resolve(dirname(fileURLToPath(import.meta.url)), "../../../model-gateway/dist/main.js");
  try { if (requireFile(installedCandidate)) return installedCandidate; } catch { /* No local bundled model gateway. */ }
  return undefined;
}

function resolveControlPlaneEntry(env: ConnectionEnvironment): string | undefined {
  const explicit = env.MAESTRO_CONTROL_PLANE_ENTRY?.trim();
  if (explicit !== undefined && explicit !== "") return resolve(explicit);
  const cwdCandidate = resolve(process.cwd(), "apps", "control-plane", "dist", "main.js");
  try { if (requireFile(cwdCandidate)) return cwdCandidate; } catch { /* Continue to the installed-layout candidate. */ }
  const installedCandidate = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../apps/control-plane/dist/main.js");
  try { if (requireFile(installedCandidate)) return installedCandidate; } catch { /* No local bundled Control Plane. */ }
  return undefined;
}

function requireFile(path: string): boolean {
  return existsSync(path);
}

async function makeLocalDataDirectories(dataDir: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(dataDir, "evidence"), { recursive: true, mode: 0o700 });
  await mkdir(join(dataDir, "workspaces"), { recursive: true, mode: 0o700 });
}

function localHelperEnvironment(options: { env: ConnectionEnvironment; databaseUrl: string; secret: string; projectId: string; operatorId: string }): Record<string, string | undefined> {
  const entry = options.env.MAESTRO_CONTROL_PLANE_ENTRY;
  return cleanEnvironment({
    ...(entry === undefined ? {} : { MAESTRO_CONTROL_PLANE_ENTRY: entry }),
    DATABASE_URL: options.databaseUrl,
    MAESTRO_LOCAL_BOOTSTRAP_SECRET: options.secret,
    // PostgreSQL stores operator and credential identities as UUIDs. Reuse the
    // same generated identity for both so a later launch can derive it from the
    // credential envelope and keep gateway bindings stable without a secret file.
    MAESTRO_LOCAL_OPERATOR_ID: options.operatorId,
    MAESTRO_LOCAL_CREDENTIAL_ID: options.operatorId,
    MAESTRO_LOCAL_PROJECT_ID: options.projectId,
  });
}

export function buildLocalModelGatewayEnvironment(options: LocalModelGatewayLaunchOptions): Record<string, string | undefined> {
  const url = new URL(options.apiUrl);
  const host = url.hostname === "[::1]" ? "::1" : url.hostname;
  return cleanEnvironment({
    MAESTRO_MODEL_GATEWAY_TOKEN: options.token,
    MAESTRO_MODEL_GATEWAY_HOST: host,
    MAESTRO_MODEL_GATEWAY_PORT: url.port || (url.protocol === "https:" ? "443" : "80"),
    MAESTRO_OPERATOR_ID: options.operatorId,
    ...(options.codexCommand === undefined ? {} : { MAESTRO_CODEX_APP_SERVER_COMMAND: options.codexCommand }),
    ...(options.codexModels === undefined ? {} : { MAESTRO_CODEX_MODELS: options.codexModels }),
  });
}

export function buildLocalControlPlaneEnvironment(options: LocalControlPlaneLaunchOptions): Record<string, string | undefined> {
  const url = new URL(options.apiUrl);
  const host = url.hostname === "[::1]" ? "::1" : url.hostname;
  return cleanEnvironment({
    DATABASE_URL: options.databaseUrl,
    MAESTRO_EVIDENCE_DIR: join(options.dataDir, "evidence"),
    MAESTRO_WORKTREE_ROOT: join(options.dataDir, "workspaces"),
    MAESTRO_HOST: host,
    MAESTRO_PORT: url.port || (url.protocol === "https:" ? "443" : "80"),
    MAESTRO_ACTOR_ID: "maestro-control-plane",
    MAESTRO_INSTANCE_ID: "maestro-local-control-plane",
    MAESTRO_MODEL_GATEWAY_URL: options.modelGatewayUrl,
    MAESTRO_MODEL_GATEWAY_TOKEN: options.modelGatewayToken,
    MAESTRO_MODEL_GATEWAY_OPERATOR_ID: options.modelGatewayOperatorId,
  });
}

function cleanEnvironment(values: Record<string, string | undefined>): Record<string, string | undefined> {
  const safe: Record<string, string | undefined> = {};
  for (const name of ["PATH", "HOME", "LANG", "NODE_OPTIONS"]) {
    const value = process.env[name];
    if (value !== undefined) safe[name] = value;
  }
  return { ...safe, ...values };
}

function extractLocalSecret(token: string | undefined): string | undefined {
  if (token === undefined) return undefined;
  const separator = token.indexOf(".");
  if (separator <= 0 || separator === token.length - 1) return undefined;
  return token.slice(separator + 1);
}

function extractUuidCredentialId(token: string | undefined): string | undefined {
  if (token === undefined) return undefined;
  const credentialId = token.slice(0, token.indexOf("."));
  return isCanonicalUuid(credentialId) ? credentialId : undefined;
}

function isCanonicalUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

function deriveModelGatewayToken(secret: string): string {
  return createHash("sha256").update(`maestro-model-gateway\0${secret}`, "utf8").digest("base64url");
}

function normalizeModelGatewayUrl(value: string | undefined): string {
  const candidate = value?.trim() || "http://127.0.0.1:4321";
  let url: URL;
  try { url = new URL(candidate); } catch { throw new Error("MAESTRO_MODEL_GATEWAY_URL is not a valid URL"); }
  if (url.protocol !== "http:") throw new Error("Local model gateway auto-start requires loopback HTTP");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Local model gateway auto-start requires a loopback host");
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") throw new Error("MAESTRO_MODEL_GATEWAY_URL must not include a path or query");
  return url.toString().replace(/\/$/, "");
}

function normalizeApiUrl(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? DEFAULT_LOCAL_API_URL : trimmed.replace(/\/$/, "");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
