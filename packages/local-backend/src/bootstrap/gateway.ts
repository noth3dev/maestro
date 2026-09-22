import { resolveCodexAppServerCommand } from "@maestro/model-provider-openai";
import type { EmbeddedDatabaseHandle } from "@maestro/persistence";
import type { ConnectionEnvironment } from "../connection.js";
import { resolveModelGatewayEntry } from "./entry.js";
import { defaultStartModelGateway, delay, startOwnedProcessWithCancellation, throwIfAborted } from "./process.js";
import { reportSetupStep } from "./steps.js";
import type { LocalBootstrapOptions, LocalModelGatewayLaunchOptions, LocalProcessHandle } from "./types.js";

export type LocalModelGatewayProbe =
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

export async function probeLocalModelGateway(options: {
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

export async function ensureLocalModelGatewayWithReporting(
  options: Parameters<typeof ensureLocalModelGatewayForBootstrap>[0] & { onStep?: LocalBootstrapOptions["onStep"] },
): Promise<Awaited<ReturnType<typeof ensureLocalModelGatewayForBootstrap>>> {
  reportSetupStep(options.onStep, "model-gateway-up", "started");
  const { onStep: _onStep, ...gatewayOptions } = options;
  const result = await ensureLocalModelGatewayForBootstrap(gatewayOptions);
  if (result.kind === "ready") reportSetupStep(options.onStep, "model-gateway-up", "completed");
  else reportSetupStep(options.onStep, "model-gateway-up", "failed", result.reason);
  return result;
}

export async function ensureLocalModelGatewayForBootstrap(options: {
  env: ConnectionEnvironment;
  operatorId: string;
  apiUrl: string;
  token: string;
  fetch: typeof globalThis.fetch;
  retryDelayMs: number;
  signal?: AbortSignal;
  startModelGateway?: (options: LocalModelGatewayLaunchOptions) => Promise<LocalProcessHandle | void>;
  startEmbeddedDatabase?: (options: { dataDir: string; detached?: boolean; port?: number }) => Promise<EmbeddedDatabaseHandle>;
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
