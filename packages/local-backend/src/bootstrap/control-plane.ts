import { dirname, join } from "node:path";
import { ApiError, createApiClient } from "@maestro/api-client";
import type { ConnectionEnvironment } from "../connection.js";
import { ensureLocalControlPlane } from "../local-control-plane.js";
import { resolveControlPlaneEntry } from "./entry.js";
import { isCanonicalUuid } from "./identity.js";
import { delay, localHelperEnvironment, throwIfAborted } from "./process.js";
import type { LocalCommandRunner } from "./types.js";

export type LocalTokenValidation =
  | { kind: "valid"; projectId?: string }
  | { kind: "invalid" }
  | { kind: "unavailable"; reason: string };

export async function validateLocalToken(apiUrl: string, token: string, fetch: typeof globalThis.fetch, signal?: AbortSignal): Promise<LocalTokenValidation> {
  throwIfAborted(signal);
  try {
    const client = createApiClient({ baseUrl: apiUrl, token, fetch, ...(signal === undefined ? {} : { signal }) });
    const projects = (await client.listProjects()).projects;
    throwIfAborted(signal);
    if (projects.length === 0) return { kind: "invalid" };
    // With several projects the default is the operator's Home (global workspace).
    const projectId = projects.length === 1 ? projects[0] : await homeProjectId(client, projects);
    // A healthy Control Plane alone is not enough for conversations or login:
    // this authenticated read proves its model-gateway composition is usable.
    await client.listModels();
    throwIfAborted(signal);
    return { kind: "valid", ...(projectId === undefined ? {} : { projectId }) };
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return { kind: "invalid" };
    return { kind: "unavailable", reason: `Local Control Plane authentication check failed: ${error instanceof Error ? error.message : "request unavailable"}` };
  }
}

export async function waitForLocalControlPlane(options: {
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

export async function runBootstrapHelper(options: {
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

async function homeProjectId(client: ReturnType<typeof createApiClient>, projects: readonly string[]): Promise<string | undefined> {
  try {
    const catalog = await client.listProjectCatalog();
    return catalog.projects.find((project) => project.kind === "home")?.projectId ?? projects[0];
  } catch {
    return projects[0];
  }
}
