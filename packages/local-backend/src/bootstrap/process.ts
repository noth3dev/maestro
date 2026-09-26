import { execFile, spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import type { EmbeddedDatabaseHandle } from "@maestro/persistence";
import type { ConnectionEnvironment } from "../connection.js";
import type {
  LocalCommandRunner,
  LocalControlPlaneLaunchOptions,
  LocalModelGatewayLaunchOptions,
  LocalProcessHandle,
} from "./types.js";

export const defaultRunCommand: LocalCommandRunner = (file, args, options) => new Promise((resolveResult) => {
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

export const defaultStartModelGateway = async (options: LocalModelGatewayLaunchOptions): Promise<LocalProcessHandle> => {
  const child = spawn(process.execPath, [options.entry], {
    cwd: dirname(options.entry),
    env: buildLocalModelGatewayEnvironment(options),
    detached: true,
    stdio: "ignore",
  });
  return detachProcess(child);
};

export const defaultStartControlPlane = async (options: LocalControlPlaneLaunchOptions): Promise<LocalProcessHandle> => {
  // Background work (Heads, meetings) reports failures on stderr; keep it.
  mkdirSync(join(options.dataDir, "logs"), { recursive: true });
  const log = openSync(join(options.dataDir, "logs", "control-plane.log"), "a");
  const child = spawn(process.execPath, [options.entry], {
    cwd: dirname(options.entry),
    env: buildLocalControlPlaneEnvironment(options),
    detached: true,
    stdio: ["ignore", log, log],
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

export function localHelperEnvironment(options: { env: ConnectionEnvironment; databaseUrl: string; secret: string; projectId: string; operatorId: string }): Record<string, string | undefined> {
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
    // Launched contracts start their Goal (Heads wake and plan) without extra setup.
    MAESTRO_START_GOAL_OUTBOX_INTERVAL_MS: "2000",
    MAESTRO_MODEL_GATEWAY_URL: options.modelGatewayUrl,
    MAESTRO_MODEL_GATEWAY_TOKEN: options.modelGatewayToken,
    MAESTRO_MODEL_GATEWAY_OPERATOR_ID: options.modelGatewayOperatorId,
    ...(options.modelRoutingMode === undefined ? {} : { MAESTRO_MODEL_ROUTING_MODE: options.modelRoutingMode }),
    ...(options.nativeModelRef === undefined ? {} : { MAESTRO_NATIVE_MODEL: options.nativeModelRef }),
    ...(options.ensembleCandidateCatalogPath === undefined ? {} : { MAESTRO_ENSEMBLE_CANDIDATE_CATALOG: options.ensembleCandidateCatalogPath }),
    ...(options.modelAccountRefs === undefined ? {} : { MAESTRO_MODEL_ACCOUNT_REFS: options.modelAccountRefs }),
    ...(options.modelMapPath === undefined ? {} : { MAESTRO_MODEL_MAP: options.modelMapPath }),
  });
}

export function buildNodeChildEnvironment(
  inheritedEnvironment: NodeJS.ProcessEnv = process.env,
  electronVersion: string | undefined = process.versions.electron,
): NodeJS.ProcessEnv {
  const environment = { ...inheritedEnvironment };
  if (electronVersion !== undefined) environment.ELECTRON_RUN_AS_NODE = "1";
  return environment;
}

function cleanEnvironment(values: Record<string, string | undefined>): Record<string, string | undefined> {
  const safe = buildNodeChildEnvironment({}, process.versions.electron);
  for (const name of ["PATH", "HOME", "LANG", "NODE_OPTIONS"]) {
    const value = process.env[name];
    if (value !== undefined) safe[name] = value;
  }
  return { ...safe, ...values };
}

export function createAbortError(): Error {
  const error = new Error("Local bootstrap cancelled");
  error.name = "AbortError";
  return error;
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw createAbortError();
}

export function abortableOperation<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
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

export function startOwnedProcessWithCancellation<T extends LocalProcessHandle | EmbeddedDatabaseHandle>(
  start: () => Promise<T | void>,
  signal?: AbortSignal,
): Promise<T | void> {
  const operation = start();
  void operation.then((process) => {
    if (signal?.aborted) void process?.stop().catch(() => undefined);
  }, () => undefined);
  return abortableOperation(operation, signal);
}

export function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
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
