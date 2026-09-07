import { randomBytes, randomUUID } from "node:crypto";
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

export interface LocalControlPlaneLaunchOptions {
  entry: string;
  databaseUrl: string;
  dataDir: string;
  apiUrl: string;
}

export interface LocalBootstrapOptions {
  env: ConnectionEnvironment;
  fetch?: typeof globalThis.fetch;
  secretStore?: LocalSecretStore;
  runCommand?: LocalCommandRunner;
  startControlPlane?: (options: LocalControlPlaneLaunchOptions) => Promise<void>;
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

const defaultStartControlPlane = async (options: LocalControlPlaneLaunchOptions): Promise<void> => {
  const child = spawn(process.execPath, [options.entry], {
    cwd: dirname(options.entry),
    env: localControlPlaneEnvironment(options),
    detached: true,
    stdio: "ignore",
  });
  child.unref();
};

/**
 * Resolve a local connection without putting a bearer secret in a file. The
 * first run creates the local operator through the Control Plane bootstrap
 * helper, then stores only the bearer in the platform keychain.
 */
export async function resolveLocalConnection(options: LocalBootstrapOptions): Promise<ConnectionState> {
  const apiUrl = normalizeApiUrl(options.env.MAESTRO_API_URL);
  const fetch = options.fetch ?? globalThis.fetch;
  const secretStore = options.secretStore ?? defaultSecretStore();
  const runCommand = options.runCommand ?? defaultRunCommand;
  const retryDelayMs = options.retryDelayMs ?? 500;
  let storedToken = secretStore.read();

  if (storedToken !== undefined) {
    const health = await ensureLocalControlPlane({ apiUrl, fetch });
    if (health.kind === "ready") {
      const validation = await validateLocalToken(apiUrl, storedToken, fetch);
      if (validation.kind === "valid") return { kind: "configured", apiUrl, token: storedToken };
      if (validation.kind === "unavailable") return { kind: "setup-required", reason: validation.reason };
      secretStore.clear();
      storedToken = undefined;
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
    const dataDir = options.env.MAESTRO_LOCAL_DATA_DIR?.trim() || join(homedir(), ".local", "share", "maestro");
    try {
      await makeLocalDataDirectories(dataDir);
      await (options.startControlPlane ?? defaultStartControlPlane)({ entry, databaseUrl, dataDir, apiUrl });
    } catch {
      return { kind: "setup-required", reason: "Local Control Plane could not be started; check its executable and local data directory permissions" };
    }
    // Fresh PostgreSQL migrations and a cold Node process can take several
    // seconds. Retry failed connections, not just hanging requests, while
    // keeping the whole startup window bounded.
    const started = await waitForLocalControlPlane({ apiUrl, fetch, retryDelayMs });
    if (started.kind !== "ready") return { kind: "setup-required", reason: `Local Control Plane startup failed: ${started.reason}` };
  }

  // A keychain token may have been valid before a restart even though the
  // Control Plane was temporarily down. Reuse it after the local process is
  // back instead of issuing another credential on every launch.
  if (storedToken !== undefined) {
    const validation = await validateLocalToken(apiUrl, storedToken, fetch);
    if (validation.kind === "valid") return { kind: "configured", apiUrl, token: storedToken };
    if (validation.kind === "unavailable") return { kind: "setup-required", reason: validation.reason };
    secretStore.clear();
    storedToken = undefined;
  }

  const secret = randomBytes(32).toString("base64url");
  const projectId = randomUUID();
  const bootstrap = await runBootstrapHelper({ env: options.env, databaseUrl, secret, projectId, runCommand });
  if (bootstrap.kind === "unavailable") return { kind: "setup-required", reason: bootstrap.reason };
  const token = `${bootstrap.credentialId}.${secret}`;
  try {
    secretStore.write(token);
  } catch {
    return { kind: "setup-required", reason: "Local operator was created, but the OS keychain is unavailable; set MAESTRO_API_TOKEN explicitly or enable a system keychain" };
  }

  const validation = await validateLocalToken(apiUrl, token, fetch);
  if (validation.kind !== "valid") {
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

async function waitForLocalControlPlane(options: {
  apiUrl: string;
  fetch: typeof globalThis.fetch;
  retryDelayMs: number;
}): Promise<Awaited<ReturnType<typeof ensureLocalControlPlane>>> {
  let last = await ensureLocalControlPlane({ apiUrl: options.apiUrl, fetch: options.fetch, timeoutMs: 1_000 });
  for (let attempt = 1; attempt < 120 && last.kind !== "ready"; attempt += 1) {
    if (options.retryDelayMs > 0) await delay(options.retryDelayMs);
    last = await ensureLocalControlPlane({ apiUrl: options.apiUrl, fetch: options.fetch, timeoutMs: 1_000 });
  }
  return last;
}

async function runBootstrapHelper(options: {
  env: ConnectionEnvironment;
  databaseUrl: string;
  secret: string;
  projectId: string;
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
    if (typeof parsed.credentialId !== "string" || parsed.credentialId.trim() === "") throw new Error("missing credential");
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

function localHelperEnvironment(options: { env: ConnectionEnvironment; databaseUrl: string; secret: string; projectId: string }): Record<string, string | undefined> {
  const entry = options.env.MAESTRO_CONTROL_PLANE_ENTRY;
  return cleanEnvironment({
    ...(entry === undefined ? {} : { MAESTRO_CONTROL_PLANE_ENTRY: entry }),
    DATABASE_URL: options.databaseUrl,
    MAESTRO_LOCAL_BOOTSTRAP_SECRET: options.secret,
    // Keep the first-run operator identity aligned with the local gateway's
    // default internal binding. It is a server-side identity, not a secret.
    MAESTRO_LOCAL_OPERATOR_ID: options.env.MAESTRO_LOCAL_OPERATOR_ID ?? "local-operator",
    MAESTRO_LOCAL_PROJECT_ID: options.projectId,
  });
}

function localControlPlaneEnvironment(options: LocalControlPlaneLaunchOptions): Record<string, string | undefined> {
  return cleanEnvironment({
    DATABASE_URL: options.databaseUrl,
    MAESTRO_EVIDENCE_DIR: join(options.dataDir, "evidence"),
    MAESTRO_WORKTREE_ROOT: join(options.dataDir, "workspaces"),
    MAESTRO_HOST: "127.0.0.1",
    MAESTRO_PORT: "4310",
    MAESTRO_ACTOR_ID: "maestro-control-plane",
    MAESTRO_INSTANCE_ID: "maestro-local-control-plane",
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

function normalizeApiUrl(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? DEFAULT_LOCAL_API_URL : trimmed.replace(/\/$/, "");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
