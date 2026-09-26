import { existsSync } from "node:fs";
import { mkdir, readFile, realpath } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getEmbeddedDatabaseIdentity,
  getLinuxProcessIdentity,
  readEmbeddedDatabaseProcessEnvironment,
} from "./embedded-database-identity.js";
import {
  abortableDelay,
  EMBEDDED_DATABASE_STARTUP_WAIT_MS,
  waitForEmbeddedDatabaseReady,
  waitForSharedStartup,
} from "./embedded-database-startup.js";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { PGLiteSocketHandler, PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { Pool } from "pg";
import { runMigrations } from "./migrate.js";
import { probeEmbeddedDatabase } from "./embedded-database-probe.js";

export interface EmbeddedDatabaseOptions {
  readonly dataDir: string;
  readonly host?: string;
  readonly port?: number;
  readonly maxConnections?: number;
  /** Cancels this caller's wait on detached startup; a spawned shared server may continue for reuse. */
  readonly signal?: AbortSignal;
  /** Keep the embedded server alive after the caller exits. */
  readonly detached?: boolean;
}

export interface EmbeddedDatabaseHandle {
  readonly databaseUrl: string;
  /** Detached servers may be reused by other bootstraps; do not stop them during caller-scoped cleanup. */
  readonly shared?: boolean;
  stop(): Promise<void>;
}

export function buildEmbeddedDatabaseChildEnvironment(
  options: EmbeddedDatabaseOptions,
  inheritedEnvironment: NodeJS.ProcessEnv = process.env,
  electronVersion: string | undefined = process.versions.electron,
): NodeJS.ProcessEnv {
  const environment = { ...inheritedEnvironment };
  if (electronVersion !== undefined) environment.ELECTRON_RUN_AS_NODE = "1";
  environment.MAESTRO_EMBEDDED_DATABASE_DIR = options.dataDir;
  environment.MAESTRO_EMBEDDED_DATABASE_MARKER = join(options.dataDir, "embedded-postgres", "server.json");
  if (options.host !== undefined) environment.MAESTRO_EMBEDDED_DATABASE_HOST = options.host;
  if (options.port === undefined) delete environment.MAESTRO_EMBEDDED_DATABASE_PORT;
  else environment.MAESTRO_EMBEDDED_DATABASE_PORT = String(options.port);
  if (options.maxConnections !== undefined) environment.MAESTRO_EMBEDDED_DATABASE_MAX_CONNECTIONS = String(options.maxConnections);
  return environment;
}

function resolveEffectiveMaxConnections(options: EmbeddedDatabaseOptions, environment: NodeJS.ProcessEnv): number {
  const configured = options.maxConnections ?? environment.MAESTRO_EMBEDDED_DATABASE_MAX_CONNECTIONS;
  const maxConnections = configured === undefined ? 8 : Number(configured);
  if (!Number.isSafeInteger(maxConnections) || maxConnections < 1) {
    throw new Error("Embedded database maxConnections must be a positive whole number");
  }
  return maxConnections;
}

function resolveDetachedConnectionOptions(options: EmbeddedDatabaseOptions): EmbeddedDatabaseOptions {
  const host = options.host ?? process.env.MAESTRO_EMBEDDED_DATABASE_HOST ?? "127.0.0.1";
  if (host.trim() === "") throw new Error("Embedded database host must not be empty");
  return {
    ...options,
    host,
    port: options.port ?? 55433,
    maxConnections: resolveEffectiveMaxConnections(options, process.env),
  };
}

type EmbeddedSocketHandler = PGLiteSocketHandler;
type EmbeddedSocketServerInternals = { handlers?: Set<EmbeddedSocketHandler> };

interface EmbeddedSocketDetachTracker {
  waitForQuiescence(): Promise<void>;
  restore(): void;
}

function trackEmbeddedSocketDetaches(server: PGLiteSocketServer): EmbeddedSocketDetachTracker {
  const internals = server as unknown as EmbeddedSocketServerInternals;
  const handlers = internals.handlers;
  if (handlers === undefined) throw new Error("PGLiteSocketServer handler set is unavailable");
  const originalAdd = handlers.add.bind(handlers);
  const pending = new Set<Promise<unknown>>();
  const wrapped = new WeakSet<EmbeddedSocketHandler>();
  const add = (handler: EmbeddedSocketHandler): Set<EmbeddedSocketHandler> => {
    if (!wrapped.has(handler)) {
      const detach = handler.detach.bind(handler);
      handler.detach = (close?: boolean): Promise<PGLiteSocketHandler> => {
        const operation = detach(close);
        pending.add(operation);
        void operation.then(
          () => pending.delete(operation),
          () => pending.delete(operation),
        );
        return operation;
      };
      wrapped.add(handler);
    }
    return originalAdd(handler);
  };
  handlers.add = add;
  return {
    async waitForQuiescence(): Promise<void> {
      for (;;) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        const operations = [...pending];
        if (operations.length === 0) return;
        await Promise.all(operations);
      }
    },
    restore(): void {
      handlers.add = originalAdd;
    },
  };
}

/** Start an embedded PostgreSQL-compatible server for the current process. */
export async function openEmbeddedDatabase(options: Omit<EmbeddedDatabaseOptions, "detached">): Promise<EmbeddedDatabaseHandle> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 55433;
  const databasePath = join(options.dataDir, "embedded-postgres");
  await mkdir(options.dataDir, { recursive: true, mode: 0o700 });
  const db = await PGlite.create(databasePath, { extensions: { pgcrypto } });
  const server = new PGLiteSocketServer({ db, host, port, maxConnections: options.maxConnections ?? 8 });
  let detachTracker: EmbeddedSocketDetachTracker | undefined;
  try {
    detachTracker = trackEmbeddedSocketDetaches(server);
    await server.start();
    const [serverHost, serverPort] = server.getServerConn().split(":");
    if (serverHost === undefined || serverPort === undefined || !/^\d+$/.test(serverPort))
      throw new Error("Embedded database did not expose a TCP address");
    const databaseUrl = `postgresql://maestro@${serverHost}:${serverPort}/maestro_local`;
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    try {
      await runMigrations(pool);
    } catch (error) {
      await pool.end().catch(() => undefined);
      throw error;
    }
    await pool.end();
    let stopped = false;
    return {
      databaseUrl,
      stop: async () => {
        if (stopped) return;
        stopped = true;
        // PGLiteSocketServer starts handler detaches without awaiting them.
        // The tracker covers both handlers still in the server Set and handlers
        // whose close event removed them before their async detach completed.
        await server.stop();
        try {
          await detachTracker!.waitForQuiescence();
        } finally {
          detachTracker!.restore();
        }
        await db.close();
      },
    };
  } catch (error) {
    await server.stop().catch(() => undefined);
    await detachTracker?.waitForQuiescence().catch(() => undefined);
    detachTracker?.restore();
    await db.close().catch(() => undefined);
    throw error;
  }
}

/**
 * Start the embedded server in a detached child so a one-shot `maestro`
 * command does not orphan its Control Plane from the local database.
 */
async function waitForChildExit(child: ReturnType<typeof spawn>, timeoutMs = 2_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      child.removeListener("exit", finish);
      resolve();
    };
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already exited */
      }
      finish();
    }, timeoutMs);
    child.once("exit", finish);
  });
}

async function readOwnedEmbeddedDatabase(
  options: EmbeddedDatabaseOptions,
  markerPath: string,
  timeoutMs = EMBEDDED_DATABASE_STARTUP_WAIT_MS,
  signal?: AbortSignal,
): Promise<EmbeddedDatabaseHandle | undefined> {
  throwIfAborted(signal);
  const probeDeadline = Date.now() + Math.max(1, timeoutMs);
  let marker: {
    pid?: unknown;
    databaseUrl?: unknown;
    databasePath?: unknown;
    databaseDevice?: unknown;
    databaseInode?: unknown;
    maxConnections?: unknown;
    processIdentity?: unknown;
  };
  try {
    marker = JSON.parse(await readFile(markerPath, "utf8")) as typeof marker;
  } catch {
    return undefined;
  }
  if (typeof marker.pid !== "number" || !Number.isInteger(marker.pid) || typeof marker.databaseUrl !== "string") return undefined;
  const expectedHost = options.host ?? "127.0.0.1";
  const expectedPort = options.port ?? 55433;
  let url: URL;
  try {
    url = new URL(marker.databaseUrl);
  } catch {
    return undefined;
  }
  if (url.hostname !== expectedHost || Number(url.port) !== expectedPort) return undefined;
  try {
    process.kill(marker.pid, 0);
  } catch {
    return undefined;
  }
  if (process.platform === "linux") {
    let commandLine: string;
    try {
      commandLine = await readFile(`/proc/${marker.pid}/cmdline`, "utf8");
    } catch {
      return undefined;
    }
    if (!commandLine.includes("embedded-database-server")) return undefined;
  }

  const identityFields = [marker.databasePath, marker.databaseDevice, marker.databaseInode];
  const isLegacyMarker = identityFields.every((field) => field === undefined) && marker.processIdentity === undefined;
  const hasCompleteIdentity = identityFields.every((field) => typeof field === "string" && field.trim() !== "");
  if (!isLegacyMarker && !hasCompleteIdentity) {
    throw new Error("The embedded database marker belongs to a different or unverified data directory");
  }
  const expectedIdentity = await getEmbeddedDatabaseIdentity(options.dataDir).catch(() => undefined);
  if (expectedIdentity === undefined) {
    throw new Error("The embedded database marker belongs to a different or unverified data directory");
  }
  const markerIdentityMatches =
    hasCompleteIdentity &&
    marker.databasePath === expectedIdentity.databasePath &&
    marker.databaseDevice === expectedIdentity.databaseDevice &&
    marker.databaseInode === expectedIdentity.databaseInode;
  if (!isLegacyMarker && !markerIdentityMatches) {
    throw new Error("The embedded database marker belongs to a different or unverified data directory");
  }

  let processIdentityBeforeProbe: { bootId: string; startTime: string } | undefined;
  let processEnvironment: Awaited<ReturnType<typeof readEmbeddedDatabaseProcessEnvironment>> = undefined;
  if (process.platform === "linux") {
    processEnvironment = await readEmbeddedDatabaseProcessEnvironment(marker.pid);
    processIdentityBeforeProbe = await getLinuxProcessIdentity(marker.pid);
    if (processIdentityBeforeProbe === undefined) {
      throw new Error("The embedded database marker belongs to a different or unverified process identity");
    }
    if (marker.processIdentity === undefined) {
      // Older markers lack process-generation metadata; require the live child path proof as a compatibility boundary.
      const serverDataDir = processEnvironment?.dataDir;
      const serverIdentity =
        serverDataDir === undefined ? undefined : await getEmbeddedDatabaseIdentity(serverDataDir).catch(() => undefined);
      if (
        serverIdentity === undefined ||
        serverIdentity.databasePath !== expectedIdentity.databasePath ||
        serverIdentity.databaseDevice !== expectedIdentity.databaseDevice ||
        serverIdentity.databaseInode !== expectedIdentity.databaseInode
      ) {
        throw new Error("The embedded database marker belongs to a different or unverified data directory");
      }
    } else {
      const processIdentity = marker.processIdentity;
      if (
        processIdentity === null ||
        typeof processIdentity !== "object" ||
        typeof (processIdentity as { bootId?: unknown }).bootId !== "string" ||
        typeof (processIdentity as { startTime?: unknown }).startTime !== "string"
      ) {
        throw new Error("The embedded database marker belongs to a different or unverified process identity");
      }
      const markerProcessIdentity = processIdentity as { bootId: string; startTime: string };
      if (
        processIdentityBeforeProbe.bootId !== markerProcessIdentity.bootId ||
        processIdentityBeforeProbe.startTime !== markerProcessIdentity.startTime
      ) {
        throw new Error("The embedded database marker belongs to a different or unverified process identity");
      }

      const serverDataDir = processEnvironment?.dataDir;
      if (serverDataDir !== undefined) {
        const serverIdentity = await getEmbeddedDatabaseIdentity(serverDataDir).catch(() => undefined);
        if (
          serverIdentity === undefined ||
          serverIdentity.databasePath !== expectedIdentity.databasePath ||
          serverIdentity.databaseDevice !== expectedIdentity.databaseDevice ||
          serverIdentity.databaseInode !== expectedIdentity.databaseInode
        ) {
          throw new Error("The embedded database marker belongs to a different or unverified data directory");
        }
      }
    }
  } else if (isLegacyMarker) {
    throw new Error("The embedded database marker belongs to a different or unverified data directory");
  }

  const expectedMaxConnections = options.maxConnections ?? resolveEffectiveMaxConnections(options, process.env);
  const maxConnectionsFromProcessEnvironment = (
    environment: Awaited<ReturnType<typeof readEmbeddedDatabaseProcessEnvironment>>,
  ): number | undefined => {
    if (environment === undefined) return undefined;
    const maxConnections = environment.maxConnections === undefined ? 8 : Number(environment.maxConnections);
    if (!Number.isSafeInteger(maxConnections) || maxConnections < 1) {
      throw new Error("The running embedded database has an unverified server configuration; restart it to write a current marker");
    }
    return maxConnections;
  };
  const liveMaxConnections = maxConnectionsFromProcessEnvironment(processEnvironment);
  // Without Linux /proc access, a current marker is the portable configuration evidence; legacy markers without a limit fail closed.
  let runningMaxConnections: number;
  if (typeof marker.maxConnections === "number" && Number.isSafeInteger(marker.maxConnections) && marker.maxConnections > 0) {
    runningMaxConnections = marker.maxConnections;
    if (process.platform === "linux" && liveMaxConnections !== undefined && liveMaxConnections !== runningMaxConnections) {
      throw new Error("The embedded database marker does not match the running server configuration");
    }
  } else if (marker.maxConnections !== undefined) {
    throw new Error("The embedded database marker has an invalid maxConnections setting");
  } else if (liveMaxConnections !== undefined) {
    // Legacy markers do not record the limit; Linux process environment is the only safe proof.
    runningMaxConnections = liveMaxConnections;
  } else {
    throw new Error("The running embedded database has an unverified server configuration; restart it to write a current marker");
  }
  if (runningMaxConnections !== expectedMaxConnections) {
    throw new Error(
      `The embedded database is already running with different connection options (maxConnections ${runningMaxConnections}; requested ${expectedMaxConnections})`,
    );
  }

  throwIfAborted(signal);
  const remainingProbeMs = probeDeadline - Date.now();
  if (remainingProbeMs <= 0) return undefined;
  const reachable = await probeEmbeddedDatabase(marker.databaseUrl, remainingProbeMs);
  throwIfAborted(signal);
  if (!reachable) return undefined;

  if (process.platform === "linux" && processIdentityBeforeProbe !== undefined) {
    const currentProcessIdentity = await getLinuxProcessIdentity(marker.pid);
    if (
      currentProcessIdentity === undefined ||
      currentProcessIdentity.bootId !== processIdentityBeforeProbe.bootId ||
      currentProcessIdentity.startTime !== processIdentityBeforeProbe.startTime
    ) {
      throw new Error("The embedded database marker belongs to a different or unverified process identity");
    }
    let commandLine: string;
    try {
      commandLine = await readFile(`/proc/${marker.pid}/cmdline`, "utf8");
    } catch {
      throw new Error("The embedded database marker belongs to a different or unverified process identity");
    }
    if (!commandLine.includes("embedded-database-server")) {
      throw new Error("The embedded database marker belongs to a different or unverified process identity");
    }

    const currentEnvironment = await readEmbeddedDatabaseProcessEnvironment(marker.pid);
    if (marker.processIdentity === undefined) {
      const serverDataDir = currentEnvironment?.dataDir;
      const serverIdentity =
        serverDataDir === undefined ? undefined : await getEmbeddedDatabaseIdentity(serverDataDir).catch(() => undefined);
      if (
        serverIdentity === undefined ||
        serverIdentity.databasePath !== expectedIdentity.databasePath ||
        serverIdentity.databaseDevice !== expectedIdentity.databaseDevice ||
        serverIdentity.databaseInode !== expectedIdentity.databaseInode
      ) {
        throw new Error("The embedded database marker belongs to a different or unverified data directory");
      }
    } else if (currentEnvironment?.dataDir !== undefined) {
      const serverIdentity = await getEmbeddedDatabaseIdentity(currentEnvironment.dataDir).catch(() => undefined);
      if (
        serverIdentity === undefined ||
        serverIdentity.databasePath !== expectedIdentity.databasePath ||
        serverIdentity.databaseDevice !== expectedIdentity.databaseDevice ||
        serverIdentity.databaseInode !== expectedIdentity.databaseInode
      ) {
        throw new Error("The embedded database marker belongs to a different or unverified data directory");
      }
    }
    const currentMaxConnections = maxConnectionsFromProcessEnvironment(currentEnvironment);
    if (currentMaxConnections === undefined && marker.processIdentity === undefined) {
      throw new Error("The running embedded database has an unverified server configuration; restart it to write a current marker");
    }
    if (currentMaxConnections !== undefined && currentMaxConnections !== expectedMaxConnections) {
      throw new Error("The embedded database marker does not match the running server configuration");
    }
  }
  return { databaseUrl: marker.databaseUrl, shared: true, stop: async () => undefined };
}

const EMBEDDED_DATABASE_STARTUP_POLL_MS = 100;

function isEmbeddedDatabaseDataDirectoryConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\bEEXIST\b|\bmutex\b|ErrnoError\s*\{[^}]*\berrno:\s*20\b/i.test(message);
}

function isEmbeddedDatabasePortConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\bEADDRINUSE\b|address already in use/i.test(message);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  throw error;
}

async function waitForExistingEmbeddedDatabase(
  options: EmbeddedDatabaseOptions,
  markerPath: string,
  signal?: AbortSignal,
): Promise<EmbeddedDatabaseHandle | undefined> {
  const deadline = Date.now() + EMBEDDED_DATABASE_STARTUP_WAIT_MS;
  while (true) {
    throwIfAborted(signal);
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return undefined;
    const existing = await readOwnedEmbeddedDatabase(options, markerPath, remainingMs, signal);
    throwIfAborted(signal);
    if (existing !== undefined) return existing;
    const remainingAfterProbeMs = deadline - Date.now();
    if (remainingAfterProbeMs <= 0) return undefined;
    await abortableDelay(Math.min(EMBEDDED_DATABASE_STARTUP_POLL_MS, remainingAfterProbeMs), signal);
  }
}

interface PendingDetachedDatabaseStart {
  readonly optionsKey: string;
  readonly controller: AbortController;
  readonly promise: Promise<EmbeddedDatabaseHandle>;
  waiters: number;
  settled: boolean;
}

const pendingDetachedDatabaseStarts = new Map<string, PendingDetachedDatabaseStart>();

function detachedDatabaseOptionsKey(options: EmbeddedDatabaseOptions): string {
  return JSON.stringify({
    host: options.host ?? "127.0.0.1",
    port: options.port ?? 55433,
    maxConnections: options.maxConnections ?? 8,
  });
}

async function joinPendingDetachedStart(
  dataDir: string,
  optionsKey: string,
  options: EmbeddedDatabaseOptions,
): Promise<EmbeddedDatabaseHandle> {
  let pending = pendingDetachedDatabaseStarts.get(dataDir);
  const isOwner = pending === undefined;
  if (pending !== undefined && pending.optionsKey !== optionsKey) {
    throw new Error("The embedded database is already starting for this data directory with different connection options");
  }
  if (pending === undefined) {
    const controller = new AbortController();
    const startOptions = { ...options, dataDir, signal: controller.signal };
    pending = {
      optionsKey,
      controller,
      promise: Promise.resolve().then(() => startDetachedEmbeddedDatabase(startOptions)),
      waiters: 0,
      settled: false,
    };
    pendingDetachedDatabaseStarts.set(dataDir, pending);
    const created = pending;
    void created.promise.then(
      () => {
        created.settled = true;
        if (pendingDetachedDatabaseStarts.get(dataDir) === created) pendingDetachedDatabaseStarts.delete(dataDir);
      },
      () => {
        created.settled = true;
        if (pendingDetachedDatabaseStarts.get(dataDir) === created) pendingDetachedDatabaseStarts.delete(dataDir);
      },
    );
  }
  pending.waiters += 1;
  try {
    const handle = await waitForSharedStartup(pending.promise, options.signal);
    return isOwner ? handle : { databaseUrl: handle.databaseUrl, shared: true, stop: async () => undefined };
  } finally {
    pending.waiters -= 1;
    if (pending.waiters === 0 && !pending.settled) pending.controller.abort();
  }
}

export async function startEmbeddedDatabase(options: EmbeddedDatabaseOptions): Promise<EmbeddedDatabaseHandle> {
  throwIfAborted(options.signal);
  if (options.detached !== true) return openEmbeddedDatabase(options);
  const effectiveOptions = resolveDetachedConnectionOptions(options);
  await mkdir(effectiveOptions.dataDir, { recursive: true, mode: 0o700 });
  const dataDir = await realpath(effectiveOptions.dataDir);
  throwIfAborted(options.signal);
  const canonicalOptions = { ...effectiveOptions, dataDir };
  return joinPendingDetachedStart(dataDir, detachedDatabaseOptionsKey(canonicalOptions), canonicalOptions);
}

async function startDetachedEmbeddedDatabase(options: EmbeddedDatabaseOptions): Promise<EmbeddedDatabaseHandle> {
  throwIfAborted(options.signal);
  const markerPath = join(options.dataDir, "embedded-postgres", "server.json");
  const existing = await readOwnedEmbeddedDatabase(options, markerPath, EMBEDDED_DATABASE_STARTUP_WAIT_MS, options.signal);
  throwIfAborted(options.signal);
  if (existing !== undefined) return existing;

  const sourceEntry = fileURLToPath(new URL("./embedded-database-server.js", import.meta.url));
  const entry = existsSync(sourceEntry) ? sourceEntry : fileURLToPath(new URL("../dist/embedded-database-server.js", import.meta.url));
  const child = spawn(process.execPath, [entry], {
    env: buildEmbeddedDatabaseChildEnvironment(options),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = child.stdout;
  const errorOutput = child.stderr;
  let ready: string;
  try {
    ready = await waitForEmbeddedDatabaseReady(child, EMBEDDED_DATABASE_STARTUP_WAIT_MS);
  } catch (error) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already exited */
    }
    await waitForChildExit(child);
    if (isEmbeddedDatabasePortConflict(error)) {
      const existingAfterConflict = await readOwnedEmbeddedDatabase(options, markerPath, EMBEDDED_DATABASE_STARTUP_WAIT_MS, options.signal);
      if (existingAfterConflict !== undefined) return existingAfterConflict;
    } else if (isEmbeddedDatabaseDataDirectoryConflict(error)) {
      const existingAfterConflict = await waitForExistingEmbeddedDatabase(options, markerPath, options.signal);
      if (existingAfterConflict !== undefined) return existingAfterConflict;
    }
    throw error;
  } finally {
    output?.removeAllListeners();
    output?.destroy();
    errorOutput?.removeAllListeners();
    errorOutput?.destroy();
  }
  child.unref();
  let stopped = false;
  return {
    databaseUrl: ready,
    shared: true,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      if (child.exitCode === null && child.signalCode === null) {
        try {
          child.kill("SIGTERM");
        } catch {
          /* already exited */
        }
        await waitForChildExit(child);
      }
    },
  };
}
