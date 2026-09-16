import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Entry } from "@napi-rs/keyring";
import { ApiError, createApiClient } from "@maestro/api-client";
import { startEmbeddedDatabase, type EmbeddedDatabaseHandle } from "@maestro/persistence";
import type { ConnectionEnvironment, ConnectionState } from "./connection.js";
import { ensureLocalControlPlane } from "./local-control-plane.js";

export const DEFAULT_LOCAL_API_URL = "http://127.0.0.1:4310";
export const DEFAULT_LOCAL_DATABASE_URL = "postgresql://maestro@127.0.0.1:55433/maestro_local";
export const DOCKER_LOCAL_DATABASE_URL = "postgresql://maestro@127.0.0.1:55432/maestro_local";
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
  options?: { cwd?: string; env?: Record<string, string | undefined>; signal?: AbortSignal },
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
  startEmbeddedDatabase?: (options: { dataDir: string; detached?: boolean }) => Promise<EmbeddedDatabaseHandle>;
  retryDelayMs?: number;
  signal?: AbortSignal;
  onStep?: (event: LocalBootstrapStepEvent) => void;
  includeProjectId?: boolean;
}

export const LOCAL_BOOTSTRAP_STEP_ORDER = [
  "docker-check",
  "postgres-ready",
  "migrations",
  "control-plane-up",
  "model-gateway-up",
] as const;

export type LocalBootstrapStepName = typeof LOCAL_BOOTSTRAP_STEP_ORDER[number];
export type LocalBootstrapStepStatus = "pending" | "started" | "completed" | "failed";

export interface LocalBootstrapStepEvent {
  readonly step: LocalBootstrapStepName;
  readonly status: LocalBootstrapStepStatus;
  readonly message?: string;
}

function reportSetupStep(
  onStep: ((event: LocalBootstrapStepEvent) => void) | undefined,
  step: LocalBootstrapStepName,
  status: LocalBootstrapStepStatus,
  message?: string,
): void {
  try {
    onStep?.({ step, status, ...(message === undefined ? {} : { message }) });
  } catch {
    // Setup telemetry is presentation-only and must never change bootstrap behavior.
  }
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
    ...(options?.signal === undefined ? {} : { signal: options.signal }),
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
  let stopOwnedProcesses: (() => Promise<void>) | undefined;
  try {
    return await resolveLocalConnectionInternal(options, (stop) => { stopOwnedProcesses = stop; });
  } finally {
    if (options.signal?.aborted) await stopOwnedProcesses?.();
  }
}

async function resolveLocalConnectionInternal(
  options: LocalBootstrapOptions,
  registerCleanup: (stop: () => Promise<void>) => void,
): Promise<ConnectionState> {
  throwIfAborted(options.signal);
  const apiUrl = normalizeApiUrl(options.env.MAESTRO_API_URL);
  let modelGatewayUrl: string;
  try { modelGatewayUrl = normalizeModelGatewayUrl(options.env.MAESTRO_MODEL_GATEWAY_URL); }
  catch (error) { return { kind: "setup-required", reason: error instanceof Error ? error.message : "MAESTRO_MODEL_GATEWAY_URL is invalid" }; }
  const fetch = options.fetch ?? globalThis.fetch;
  const secretStore = options.secretStore ?? defaultSecretStore();
  const commandRunner = options.runCommand ?? defaultRunCommand;
  const runCommand: LocalCommandRunner = (file, args, commandOptions) => {
    const effectiveOptions = options.signal === undefined ? commandOptions : { ...commandOptions, signal: options.signal };
    const operation = effectiveOptions === undefined ? commandRunner(file, args) : commandRunner(file, args, effectiveOptions);
    return abortableOperation(operation, options.signal);
  };
  const retryDelayMs = options.retryDelayMs ?? 500;
  let storedToken = secretStore.read();
  let bootstrapSecret: string | undefined;
  let bootstrapProjectId: string | undefined;
  const configuredOperatorId = options.env.MAESTRO_LOCAL_OPERATOR_ID?.trim();
  if (configuredOperatorId !== undefined && !isCanonicalUuid(configuredOperatorId)) {
    return { kind: "setup-required", reason: "MAESTRO_LOCAL_OPERATOR_ID must be a canonical UUID" };
  }
  const localOperatorId = configuredOperatorId || extractUuidCredentialId(storedToken) || randomUUID();
  let gatewayReady = false;
  let ownedGateway: LocalProcessHandle | undefined;
  let ownedControlPlane: LocalProcessHandle | undefined;
  let ownedDatabase: EmbeddedDatabaseHandle | undefined;
  const stopOwnedProcesses = async (): Promise<void> => {
    const controlPlane = ownedControlPlane;
    const gateway = ownedGateway;
    ownedControlPlane = undefined;
    ownedGateway = undefined;
    const database = ownedDatabase;
    ownedDatabase = undefined;
    await controlPlane?.stop().catch(() => undefined);
    await gateway?.stop().catch(() => undefined);
    await database?.stop().catch(() => undefined);
  };
  registerCleanup(stopOwnedProcesses);

  if (storedToken !== undefined) {
    const health = await ensureLocalControlPlane({ apiUrl, fetch, ...(options.signal === undefined ? {} : { signal: options.signal }) });
    throwIfAborted(options.signal);
    if (health.kind === "ready") {
      const localSecret = extractLocalSecret(storedToken);
      if (localSecret === undefined) {
        secretStore.clear();
        storedToken = undefined;
      } else {
        const gateway = await ensureLocalModelGatewayWithReporting({
          env: options.env,
          operatorId: localOperatorId,
          apiUrl: modelGatewayUrl,
          token: options.env.MAESTRO_MODEL_GATEWAY_TOKEN?.trim() || deriveModelGatewayToken(localSecret),
          fetch,
          retryDelayMs,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
          ...(options.onStep === undefined ? {} : { onStep: options.onStep }),
          ...(options.startModelGateway === undefined ? {} : { startModelGateway: options.startModelGateway }),
        });
        if (gateway.kind !== "ready") {
          throwIfAborted(options.signal);
          return { kind: "setup-required", reason: gateway.reason };
        }
        ownedGateway = gateway.process;
        throwIfAborted(options.signal);
        gatewayReady = true;
        const validation = await validateLocalToken(apiUrl, storedToken, fetch, options.signal);
        if (validation.kind === "valid") {
          const projectId = options.includeProjectId ? validation.projectId : undefined;
          return { kind: "configured", apiUrl, token: storedToken, ...(projectId === undefined ? {} : { projectId }) };
        }
        if (validation.kind === "unavailable") {
          reportSetupStep(options.onStep, "control-plane-up", "failed", validation.reason);
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

  const configuredDatabaseUrl = options.env.MAESTRO_LOCAL_DATABASE_URL?.trim();
  const databaseSelection = await ensureLocalDatabase({
    env: options.env,
    databaseUrl: configuredDatabaseUrl,
    dataDir: options.env.MAESTRO_LOCAL_DATA_DIR?.trim() || join(homedir(), ".local", "share", "maestro"),
    runCommand,
    retryDelayMs,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.startEmbeddedDatabase === undefined ? {} : { startEmbeddedDatabase: options.startEmbeddedDatabase }),
    ...(options.onStep === undefined ? {} : { onStep: options.onStep }),
  });
  if (databaseSelection.kind === "unavailable") {
    throwIfAborted(options.signal);
    return { kind: "setup-required", reason: databaseSelection.reason };
  }
  const databaseUrl = databaseSelection.databaseUrl;
  ownedDatabase = databaseSelection.process;
  throwIfAborted(options.signal);

  const initialHealth = await ensureLocalControlPlane({ apiUrl, fetch, ...(options.signal === undefined ? {} : { signal: options.signal }) });
  throwIfAborted(options.signal);
  let bootstrap: Awaited<ReturnType<typeof runBootstrapHelper>> | undefined;

  // The bootstrap helper is the parent-visible migration operation. Run it
  // before starting either service so the callback reflects the real setup
  // order instead of inferring migrations from a later health poll.
  if (storedToken === undefined) {
    const entry = resolveControlPlaneEntry(options.env);
    if (initialHealth.kind !== "ready" && entry === undefined) {
      const reason = "Local Control Plane is not running and its executable was not found; set MAESTRO_CONTROL_PLANE_ENTRY or configure MAESTRO_API_URL and MAESTRO_API_TOKEN";
      reportSetupStep(options.onStep, "control-plane-up", "failed", reason);
      await stopOwnedProcesses();
      return { kind: "setup-required", reason };
    }
    bootstrapSecret = bootstrapSecret ?? randomBytes(32).toString("base64url");
    const projectId = randomUUID();
    reportSetupStep(options.onStep, "migrations", "started");
    bootstrap = await runBootstrapHelper({ env: options.env, databaseUrl, secret: bootstrapSecret, projectId, operatorId: localOperatorId, runCommand, ...(options.signal === undefined ? {} : { signal: options.signal }) });
    if (bootstrap.kind === "unavailable") {
      reportSetupStep(options.onStep, "migrations", "failed", bootstrap.reason);
      await stopOwnedProcesses();
      return { kind: "setup-required", reason: bootstrap.reason };
    }
    reportSetupStep(options.onStep, "migrations", "completed");
    bootstrapProjectId = options.includeProjectId ? bootstrap.projectId : undefined;
  }

  if (initialHealth.kind !== "ready") {
    const entry = resolveControlPlaneEntry(options.env);
    if (entry === undefined) {
      const reason = "Local Control Plane is not running and its executable was not found; set MAESTRO_CONTROL_PLANE_ENTRY or configure MAESTRO_API_URL and MAESTRO_API_TOKEN";
      reportSetupStep(options.onStep, "control-plane-up", "failed", reason);
      await stopOwnedProcesses();
      return { kind: "setup-required", reason };
    }
    bootstrapSecret = bootstrapSecret ?? extractLocalSecret(storedToken) ?? randomBytes(32).toString("base64url");
    const modelGatewayToken = options.env.MAESTRO_MODEL_GATEWAY_TOKEN?.trim() || deriveModelGatewayToken(bootstrapSecret);
    const modelGatewayOperatorId = options.env.MAESTRO_MODEL_GATEWAY_OPERATOR_ID?.trim() || localOperatorId;
    const dataDir = options.env.MAESTRO_LOCAL_DATA_DIR?.trim() || join(homedir(), ".local", "share", "maestro");
    try {
      await makeLocalDataDirectories(dataDir);
      reportSetupStep(options.onStep, "control-plane-up", "started");
      ownedControlPlane = await startOwnedProcessWithCancellation(
        () => (options.startControlPlane ?? defaultStartControlPlane)({ entry, databaseUrl, dataDir, apiUrl, modelGatewayUrl, modelGatewayToken, modelGatewayOperatorId }),
        options.signal,
      ) ?? undefined;
    } catch (error) {
      if (options.signal?.aborted) throw error;
      const reason = "Local Control Plane could not be started; check its executable and local data directory permissions";
      reportSetupStep(options.onStep, "control-plane-up", "failed", reason);
      await stopOwnedProcesses();
      return { kind: "setup-required", reason };
    }
    // Fresh PostgreSQL migrations and a cold Node process can take several
    // seconds. Retry failed connections, not just hanging requests, while
    // keeping the whole startup window bounded.
    const started = await waitForLocalControlPlane({ apiUrl, fetch, retryDelayMs, ...(options.signal === undefined ? {} : { signal: options.signal }) });
    throwIfAborted(options.signal);
    if (started.kind !== "ready") {
      const reason = `Local Control Plane startup failed: ${started.reason}`;
      reportSetupStep(options.onStep, "control-plane-up", "failed", reason);
      await stopOwnedProcesses();
      return { kind: "setup-required", reason };
    }
    reportSetupStep(options.onStep, "control-plane-up", "completed");
  }

  if (!gatewayReady) {
    bootstrapSecret = bootstrapSecret ?? extractLocalSecret(storedToken) ?? randomBytes(32).toString("base64url");
    const modelGatewayToken = options.env.MAESTRO_MODEL_GATEWAY_TOKEN?.trim() || deriveModelGatewayToken(bootstrapSecret);
    const gateway = await ensureLocalModelGatewayWithReporting({
      env: options.env,
      operatorId: localOperatorId,
      apiUrl: modelGatewayUrl,
      token: modelGatewayToken,
      fetch,
      retryDelayMs,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.onStep === undefined ? {} : { onStep: options.onStep }),
      ...(options.startModelGateway === undefined ? {} : { startModelGateway: options.startModelGateway }),
    });
    if (gateway.kind !== "ready") {
      throwIfAborted(options.signal);
      await stopOwnedProcesses();
      return { kind: "setup-required", reason: gateway.reason };
    }
    ownedGateway = gateway.process;
    throwIfAborted(options.signal);
    gatewayReady = true;
  }

  // A keychain token may have been valid before a restart even though the
  // Control Plane was temporarily down. Reuse it after the local process is
  // back instead of issuing another credential on every launch.
  if (storedToken !== undefined) {
    const validation = await validateLocalToken(apiUrl, storedToken, fetch, options.signal);
    if (validation.kind === "valid") {
      const projectId = options.includeProjectId ? validation.projectId : undefined;
      return { kind: "configured", apiUrl, token: storedToken, ...(projectId === undefined ? {} : { projectId }) };
    }
    if (validation.kind === "unavailable") {
      reportSetupStep(options.onStep, "control-plane-up", "failed", validation.reason);
      await stopOwnedProcesses();
      return { kind: "setup-required", reason: validation.reason };
    }
    bootstrapSecret = extractLocalSecret(storedToken);
    secretStore.clear();
    storedToken = undefined;
  }

  if (bootstrap === undefined) {
    const secret = bootstrapSecret ?? randomBytes(32).toString("base64url");
    const projectId = randomUUID();
    reportSetupStep(options.onStep, "migrations", "started");
    bootstrap = await runBootstrapHelper({ env: options.env, databaseUrl, secret, projectId, operatorId: localOperatorId, runCommand, ...(options.signal === undefined ? {} : { signal: options.signal }) });
    if (bootstrap.kind === "unavailable") {
      reportSetupStep(options.onStep, "migrations", "failed", bootstrap.reason);
      await stopOwnedProcesses();
      return { kind: "setup-required", reason: bootstrap.reason };
    }
    reportSetupStep(options.onStep, "migrations", "completed");
    bootstrapSecret = secret;
    bootstrapProjectId = options.includeProjectId ? bootstrap.projectId : undefined;
  }
  const secret = bootstrapSecret!;
  if (bootstrap === undefined || bootstrap.kind !== "ready") {
    const reason = "Local operator bootstrap returned no credential";
    reportSetupStep(options.onStep, "migrations", "failed", reason);
    await stopOwnedProcesses();
    return { kind: "setup-required", reason };
  }
  const token = `${bootstrap.credentialId}.${secret}`;
  try {
    secretStore.write(token);
  } catch {
    const reason = "Local operator was created, but the OS keychain is unavailable; set MAESTRO_API_TOKEN explicitly or enable a system keychain";
    reportSetupStep(options.onStep, "control-plane-up", "failed", reason);
    await stopOwnedProcesses();
    return { kind: "setup-required", reason };
  }

  const validation = await validateLocalToken(apiUrl, token, fetch, options.signal);
  if (validation.kind !== "valid") {
    const reason = validation.kind === "unavailable" ? validation.reason : "Local operator bootstrap completed but Control Plane authentication failed";
    reportSetupStep(options.onStep, "control-plane-up", "failed", reason);
    await stopOwnedProcesses();
    secretStore.clear();
    return { kind: "setup-required", reason };
  }
  return { kind: "configured", apiUrl, token, ...(bootstrapProjectId === undefined ? {} : { projectId: bootstrapProjectId }) };
}

type LocalTokenValidation =
  | { kind: "valid"; projectId?: string }
  | { kind: "invalid" }
  | { kind: "unavailable"; reason: string };

async function validateLocalToken(apiUrl: string, token: string, fetch: typeof globalThis.fetch, signal?: AbortSignal): Promise<LocalTokenValidation> {
  throwIfAborted(signal);
  try {
    const client = createApiClient({ baseUrl: apiUrl, token, fetch, ...(signal === undefined ? {} : { signal }) });
    const projects = (await client.listProjects()).projects;
    throwIfAborted(signal);
    if (projects.length === 0) return { kind: "invalid" };
    const projectId = projects.length === 1 ? projects[0] : undefined;
    // A healthy Control Plane alone is not enough for conversations or login:
    // this authenticated read proves its model-gateway composition is usable.
    await client.listModels();
    throwIfAborted(signal);
    if (projects.length !== 1) return { kind: "valid", ...(projectId === undefined ? {} : { projectId }) };
    const singleProjectId = projects[0]!;
    const goals = (await client.listGoals(singleProjectId)).goals;
    throwIfAborted(signal);
    if (goals.length === 0) {
      await client.createGoal({ projectId: singleProjectId }, randomUUID());
      throwIfAborted(signal);
    }
    return { kind: "valid", ...(projectId === undefined ? {} : { projectId }) };
  } catch (error) {
    if (signal?.aborted) throw error;
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
  signal?: AbortSignal;
}): Promise<Response | undefined> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abort = () => controller.abort();
  if (options.signal?.aborted) return undefined;
  options.signal?.addEventListener("abort", abort, { once: true });
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
    options.signal?.removeEventListener("abort", abort);
  }
}

async function probeLocalModelGateway(options: {
  apiUrl: string;
  token: string;
  fetch: typeof globalThis.fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<LocalModelGatewayProbe> {
  throwIfAborted(options.signal);
  const timeoutMs = options.timeoutMs ?? 1_000;
  const health = await requestLocalModelGateway({ url: `${options.apiUrl}/healthz`, fetch: options.fetch, timeoutMs, ...(options.signal === undefined ? {} : { signal: options.signal }) });
  if (health === undefined) return { kind: "unavailable", reason: "Model gateway is not reachable", reachable: false };
  if (!health.ok) return { kind: "unavailable", reason: "Model gateway is running but not ready", reachable: true };
  const authorized = await requestLocalModelGateway({
    url: `${options.apiUrl}/v1/models`,
    fetch: options.fetch,
    headers: { authorization: `Bearer ${options.token}` },
    timeoutMs,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  if (authorized === undefined) return { kind: "unavailable", reason: "Model gateway authorization check timed out", reachable: true };
  if (authorized.status === 401 || authorized.status === 403) return { kind: "unauthorized" };
  if (!authorized.ok) return { kind: "unavailable", reason: "Model gateway authorization check failed", reachable: true };
  return { kind: "ready" };
}

async function ensureLocalModelGatewayWithReporting(
  options: Parameters<typeof ensureLocalModelGatewayForBootstrap>[0] & { onStep?: LocalBootstrapOptions["onStep"] },
): Promise<Awaited<ReturnType<typeof ensureLocalModelGatewayForBootstrap>>> {
  reportSetupStep(options.onStep, "model-gateway-up", "started");
  const { onStep: _onStep, ...gatewayOptions } = options;
  const result = await ensureLocalModelGatewayForBootstrap(gatewayOptions);
  if (result.kind === "ready") reportSetupStep(options.onStep, "model-gateway-up", "completed");
  else reportSetupStep(options.onStep, "model-gateway-up", "failed", result.reason);
  return result;
}

async function ensureLocalModelGatewayForBootstrap(options: {
  env: ConnectionEnvironment;
  operatorId: string;
  apiUrl: string;
  token: string;
  fetch: typeof globalThis.fetch;
  retryDelayMs: number;
  signal?: AbortSignal;
  startModelGateway?: (options: LocalModelGatewayLaunchOptions) => Promise<LocalProcessHandle | void>;
  startEmbeddedDatabase?: (options: { dataDir: string; detached?: boolean }) => Promise<EmbeddedDatabaseHandle>;
}): Promise<{ kind: "ready"; process?: LocalProcessHandle } | { kind: "setup-required"; reason: string }> {
  throwIfAborted(options.signal);
  let current = await probeLocalModelGateway({ apiUrl: options.apiUrl, token: options.token, fetch: options.fetch, ...(options.signal === undefined ? {} : { signal: options.signal }) });
  throwIfAborted(options.signal);
  if (current.kind === "ready") return current;
  if (current.kind === "unauthorized") return { kind: "setup-required", reason: "A local model gateway is already running with a different service credential; stop it or set MAESTRO_MODEL_GATEWAY_TOKEN to its credential" };
  if (current.reachable) {
    current = await waitForLocalModelGateway({ apiUrl: options.apiUrl, token: options.token, fetch: options.fetch, retryDelayMs: options.retryDelayMs, ...(options.signal === undefined ? {} : { signal: options.signal }) });
    if (current.kind === "ready") return current;
    if (current.kind === "unauthorized") return { kind: "setup-required", reason: "A local model gateway is already running with a different service credential; stop it or set MAESTRO_MODEL_GATEWAY_TOKEN to its credential" };
    return { kind: "setup-required", reason: `Local model gateway is already running but did not become ready: ${current.reason}` };
  }
  const entry = resolveModelGatewayEntry(options.env);
  if (entry === undefined) return { kind: "setup-required", reason: "Local model gateway is not running and its executable was not found; set MAESTRO_MODEL_GATEWAY_ENTRY or configure the gateway separately" };
  const operatorId = options.env.MAESTRO_MODEL_GATEWAY_OPERATOR_ID?.trim() || options.env.MAESTRO_LOCAL_OPERATOR_ID?.trim() || options.operatorId;
  const codexCommand = resolveCodexAppServerCommand(options.env.MAESTRO_CODEX_APP_SERVER_COMMAND);
  let startedProcess: LocalProcessHandle | undefined;
  try {
    startedProcess = await startOwnedProcessWithCancellation(
      () => (options.startModelGateway ?? defaultStartModelGateway)({
        entry,
        apiUrl: options.apiUrl,
        token: options.token,
        operatorId,
        ...(codexCommand === undefined ? {} : { codexCommand }),
        ...(options.env.MAESTRO_CODEX_MODELS?.trim() ? { codexModels: options.env.MAESTRO_CODEX_MODELS.trim() } : {}),
      }),
      options.signal,
    ) ?? undefined;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return { kind: "setup-required", reason: "Local model gateway could not be started; check its executable and local configuration" };
  }
  try {
    current = await waitForLocalModelGateway({ apiUrl: options.apiUrl, token: options.token, fetch: options.fetch, retryDelayMs: options.retryDelayMs, ...(options.signal === undefined ? {} : { signal: options.signal }) });
    throwIfAborted(options.signal);
  } catch (error) {
    await startedProcess?.stop().catch(() => undefined);
    throw error;
  }
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
  signal?: AbortSignal;
}): Promise<LocalModelGatewayProbe> {
  throwIfAborted(options.signal);
  let last = await probeLocalModelGateway({ apiUrl: options.apiUrl, token: options.token, fetch: options.fetch, ...(options.signal === undefined ? {} : { signal: options.signal }) });
  for (let attempt = 1; attempt < 120 && last.kind === "unavailable"; attempt += 1) {
    await delay(Math.max(options.retryDelayMs, 1), options.signal);
    last = await probeLocalModelGateway({ apiUrl: options.apiUrl, token: options.token, fetch: options.fetch, ...(options.signal === undefined ? {} : { signal: options.signal }) });
  }
  return last;
}

async function waitForLocalControlPlane(options: {
  apiUrl: string;
  fetch: typeof globalThis.fetch;
  retryDelayMs: number;
  signal?: AbortSignal;
}): Promise<Awaited<ReturnType<typeof ensureLocalControlPlane>>> {
  throwIfAborted(options.signal);
  let last = await ensureLocalControlPlane({ apiUrl: options.apiUrl, fetch: options.fetch, timeoutMs: 1_000, ...(options.signal === undefined ? {} : { signal: options.signal }) });
  for (let attempt = 1; attempt < 120 && last.kind !== "ready"; attempt += 1) {
    await delay(Math.max(options.retryDelayMs, 1), options.signal);
    last = await ensureLocalControlPlane({ apiUrl: options.apiUrl, fetch: options.fetch, timeoutMs: 1_000, ...(options.signal === undefined ? {} : { signal: options.signal }) });
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
  signal?: AbortSignal;
}): Promise<{ kind: "ready"; credentialId: string; projectId?: string } | { kind: "unavailable"; reason: string }> {
  const entry = resolveControlPlaneEntry(options.env);
  if (entry === undefined) return { kind: "unavailable", reason: "Local bootstrap helper was not found; set MAESTRO_CONTROL_PLANE_ENTRY or configure MAESTRO_API_URL and MAESTRO_API_TOKEN" };
  const result = await options.runCommand(process.execPath, [join(dirname(entry), "local-bootstrap.js")], {
    env: localHelperEnvironment(options),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  throwIfAborted(options.signal);
  if (result.code !== 0) return { kind: "unavailable", reason: "Local operator bootstrap failed; check PostgreSQL and Control Plane logs" };
  try {
    const parsed = JSON.parse(result.stdout) as { credentialId?: unknown; projectId?: unknown };
    if (typeof parsed.credentialId !== "string" || !isCanonicalUuid(parsed.credentialId)) throw new Error("invalid credential");
    const projectId = typeof parsed.projectId === "string" && isCanonicalUuid(parsed.projectId) ? parsed.projectId : undefined;
    return { kind: "ready", credentialId: parsed.credentialId, ...(projectId === undefined ? {} : { projectId }) };
  } catch {
    return { kind: "unavailable", reason: "Local operator bootstrap returned an invalid result" };
  }
}

async function ensureLocalDatabase(options: {
  env: ConnectionEnvironment;
  databaseUrl: string | undefined;
  dataDir: string;
  runCommand: LocalCommandRunner;
  retryDelayMs: number;
  signal?: AbortSignal;
  startEmbeddedDatabase?: (options: { dataDir: string; detached?: boolean }) => Promise<EmbeddedDatabaseHandle>;
  onStep?: (event: LocalBootstrapStepEvent) => void;
}): Promise<{ kind: "ready"; databaseUrl: string; process?: EmbeddedDatabaseHandle } | { kind: "unavailable"; reason: string }> {
  const engine = options.env.MAESTRO_LOCAL_DB_ENGINE?.trim().toLowerCase();
  if (options.databaseUrl !== undefined && options.databaseUrl !== "") return { kind: "ready", databaseUrl: options.databaseUrl };
  if (engine === "docker") return ensureDockerDatabase({ databaseUrl: DOCKER_LOCAL_DATABASE_URL, runCommand: options.runCommand, retryDelayMs: options.retryDelayMs, ...(options.signal === undefined ? {} : { signal: options.signal }), ...(options.onStep === undefined ? {} : { onStep: options.onStep }) });
  if (engine !== undefined && engine !== "embedded") return { kind: "unavailable", reason: "MAESTRO_LOCAL_DB_ENGINE must be embedded or docker" };

  reportSetupStep(options.onStep, "postgres-ready", "started", "Starting embedded PostgreSQL-compatible database");
  try {
    const process = await startOwnedProcessWithCancellation(
      () => (options.startEmbeddedDatabase ?? startEmbeddedDatabase)({ dataDir: options.dataDir, detached: options.startEmbeddedDatabase === undefined }),
      options.signal,
    );
    if (process === undefined) throw new Error("embedded database did not return a process");
    reportSetupStep(options.onStep, "postgres-ready", "completed", "Embedded PostgreSQL-compatible database is ready");
    return { kind: "ready", databaseUrl: process.databaseUrl, process };
  } catch (error) {
    const reason = `Embedded PostgreSQL-compatible database could not be started: ${error instanceof Error ? error.message : "unknown error"}`;
    reportSetupStep(options.onStep, "postgres-ready", "failed", reason);
    return { kind: "unavailable", reason };
  }
}

async function ensureDockerDatabase(options: {
  databaseUrl: string;
  runCommand: LocalCommandRunner;
  retryDelayMs: number;
  signal?: AbortSignal;
  onStep?: (event: LocalBootstrapStepEvent) => void;
}): Promise<{ kind: "ready"; databaseUrl: string } | { kind: "unavailable"; reason: string }> {
  throwIfAborted(options.signal);
  const commandOptions = options.signal === undefined ? undefined : { signal: options.signal };
  const runDockerCommand = (args: readonly string[]): Promise<LocalCommandResult> =>
    commandOptions === undefined ? options.runCommand("docker", args) : options.runCommand("docker", args, commandOptions);
  reportSetupStep(options.onStep, "docker-check", "started");
  const inspect = await runDockerCommand(["inspect", "--format", "{{.State.Running}}", LOCAL_POSTGRES_CONTAINER]);
  if (inspect.code !== 0) {
    const started = await runDockerCommand([
      "run", "-d", "--name", LOCAL_POSTGRES_CONTAINER, "--restart", "unless-stopped",
      "-e", "POSTGRES_USER=maestro", "-e", "POSTGRES_DB=maestro_local", "-e", "POSTGRES_HOST_AUTH_METHOD=trust",
      "-p", "127.0.0.1:55432:5432", "-v", "maestro-local-postgres-data:/var/lib/postgresql/data", "postgres:17-alpine",
    ]);
    if (started.code !== 0) {
      const reason = dockerUnavailableReason(started.stderr || inspect.stderr);
      reportSetupStep(options.onStep, "docker-check", "failed", reason);
      return { kind: "unavailable", reason };
    }
  } else if (inspect.stdout.trim() !== "true") {
    const started = await runDockerCommand(["start", LOCAL_POSTGRES_CONTAINER]);
    if (started.code !== 0) {
      const reason = "Docker PostgreSQL exists but could not be started; run `docker logs maestro-local-postgres`";
      reportSetupStep(options.onStep, "docker-check", "failed", reason);
      return { kind: "unavailable", reason };
    }
  }
  reportSetupStep(options.onStep, "docker-check", "completed");
  reportSetupStep(options.onStep, "postgres-ready", "started");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const ready = await runDockerCommand(["exec", LOCAL_POSTGRES_CONTAINER, "pg_isready", "-U", "maestro", "-d", "maestro_local"]);
    if (ready.code === 0) {
      reportSetupStep(options.onStep, "postgres-ready", "completed");
      return { kind: "ready", databaseUrl: options.databaseUrl };
    }
    if (options.retryDelayMs > 0) await delay(options.retryDelayMs, options.signal);
  }
  const reason = "Docker PostgreSQL started but did not become ready; run `docker logs maestro-local-postgres`";
  reportSetupStep(options.onStep, "postgres-ready", "failed", reason);
  return { kind: "unavailable", reason };
}

function dockerUnavailableReason(detail: string): string {
  if (/not found|cannot connect|is the docker daemon running/i.test(detail)) return "Docker is required for local automatic setup but is not available; install/start Docker or set MAESTRO_LOCAL_DATABASE_URL";
  return "Docker PostgreSQL could not be started; run `docker ps -a` and check the maestro-local-postgres container";
}

export function resolveCodexAppServerCommand(configuredCommand?: string, pathValue = process.env.PATH): string | undefined {
  const explicit = configuredCommand?.trim();
  if (explicit !== undefined && explicit !== "") return explicit;
  const pathEntries = pathValue?.split(delimiter) ?? [];
  const commandNames = process.platform === "win32" ? ["codex.exe", "codex.cmd", "codex.bat", "codex"] : ["codex"];
  for (const entry of pathEntries) {
    for (const name of commandNames) {
      const candidate = join(entry === "" ? "." : entry, name);
      try {
        if (!statSync(candidate).isFile()) continue;
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Continue searching the remaining PATH entries.
      }
    }
  }
  return undefined;
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

export function resolveInstalledControlPlaneEntry(moduleDirectory = dirname(fileURLToPath(import.meta.url))): string {
  return resolve(moduleDirectory, "../../../control-plane/dist/main.js");
}

function resolveControlPlaneEntry(env: ConnectionEnvironment): string | undefined {
  const explicit = env.MAESTRO_CONTROL_PLANE_ENTRY?.trim();
  if (explicit !== undefined && explicit !== "") return resolve(explicit);
  const cwdCandidate = resolve(process.cwd(), "apps", "control-plane", "dist", "main.js");
  try { if (requireFile(cwdCandidate)) return cwdCandidate; } catch { /* Continue to the installed-layout candidate. */ }
  const installedCandidate = resolveInstalledControlPlaneEntry();
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

function createAbortError(): Error {
  const error = new Error("Local bootstrap cancelled");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw createAbortError();
}

function abortableOperation<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation;
  if (signal.aborted) {
    void operation.catch(() => undefined);
    return Promise.reject(createAbortError());
  }
  let onAbort: (() => void) | undefined;
  const cancellation = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(createAbortError());
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([operation, cancellation]).finally(() => {
    if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
  });
}

function startOwnedProcessWithCancellation<T extends LocalProcessHandle | EmbeddedDatabaseHandle>(
  start: () => Promise<T | void>,
  signal?: AbortSignal,
): Promise<T | void> {
  const operation = start();
  void operation.then((process) => {
    if (signal?.aborted) void process?.stop().catch(() => undefined);
  }, () => undefined);
  return abortableOperation(operation, signal);
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(createAbortError());
  return new Promise((resolveDelay, rejectDelay) => {
    const abort = () => {
      clearTimeout(timer);
      rejectDelay(Object.assign(new Error("Local bootstrap cancelled"), { name: "AbortError" }));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolveDelay();
    }, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
