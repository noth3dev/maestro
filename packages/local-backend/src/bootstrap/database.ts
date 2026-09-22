import { join } from "node:path";
import { startEmbeddedDatabase, type EmbeddedDatabaseHandle } from "@maestro/persistence";
import type { ConnectionEnvironment } from "../connection.js";
import { DOCKER_LOCAL_DATABASE_URL, LOCAL_POSTGRES_CONTAINER } from "./constants.js";
import { delay, startOwnedProcessWithCancellation, throwIfAborted } from "./process.js";
import { reportSetupStep } from "./steps.js";
import type { LocalBootstrapStepEvent, LocalCommandResult, LocalCommandRunner } from "./types.js";

export function configuredEmbeddedDatabasePort(value: string | undefined): number | undefined {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed === "" || !/^\d+$/.test(trimmed)) return undefined;
  const port = Number(trimmed);
  // Detached startup needs a stable marker/reuse port; zero is only safe for
  // in-process ephemeral servers and therefore is not a local override.
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : undefined;
}

export async function makeLocalDataDirectories(dataDir: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(dataDir, "evidence"), { recursive: true, mode: 0o700 });
  await mkdir(join(dataDir, "workspaces"), { recursive: true, mode: 0o700 });
}

export async function ensureLocalDatabase(options: {
  env: ConnectionEnvironment;
  databaseUrl: string | undefined;
  dataDir: string;
  runCommand: LocalCommandRunner;
  retryDelayMs: number;
  signal?: AbortSignal;
  startEmbeddedDatabase?: (options: { dataDir: string; detached?: boolean; port?: number }) => Promise<EmbeddedDatabaseHandle>;
  onStep?: (event: LocalBootstrapStepEvent) => void;
}): Promise<{ kind: "ready"; databaseUrl: string; process?: EmbeddedDatabaseHandle } | { kind: "unavailable"; reason: string }> {
  const engine = options.env.MAESTRO_LOCAL_DB_ENGINE?.trim().toLowerCase();
  const rawPort = options.env.MAESTRO_EMBEDDED_DATABASE_PORT;
  const trimmedPort = rawPort?.trim();
  const port = configuredEmbeddedDatabasePort(rawPort);
  if (options.databaseUrl !== undefined && options.databaseUrl !== "") return { kind: "ready", databaseUrl: options.databaseUrl };
  if (engine === "docker") return ensureDockerDatabase({ databaseUrl: DOCKER_LOCAL_DATABASE_URL, runCommand: options.runCommand, retryDelayMs: options.retryDelayMs, ...(options.signal === undefined ? {} : { signal: options.signal }), ...(options.onStep === undefined ? {} : { onStep: options.onStep }) });
  if (engine !== undefined && engine !== "embedded") return { kind: "unavailable", reason: "MAESTRO_LOCAL_DB_ENGINE must be embedded or docker" };
  if (trimmedPort !== undefined && trimmedPort !== "" && port === undefined) return { kind: "unavailable", reason: "MAESTRO_EMBEDDED_DATABASE_PORT must be an integer from 1 to 65535" };

  reportSetupStep(options.onStep, "postgres-ready", "started", "Starting embedded PostgreSQL-compatible database");
  try {
    const process = await startOwnedProcessWithCancellation(
      () => (options.startEmbeddedDatabase ?? startEmbeddedDatabase)({
        dataDir: options.dataDir,
        detached: options.startEmbeddedDatabase === undefined,
        ...(port === undefined ? {} : { port }),
      }),
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
