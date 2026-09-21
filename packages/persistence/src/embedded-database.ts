import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { PGLiteSocketHandler, PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { Pool } from "pg";
import { runMigrations } from "./migrate.js";

export interface EmbeddedDatabaseOptions {
  readonly dataDir: string;
  readonly host?: string;
  readonly port?: number;
  readonly maxConnections?: number;
  /** Keep the embedded server alive after the caller exits. */
  readonly detached?: boolean;
}

export interface EmbeddedDatabaseHandle {
  readonly databaseUrl: string;
  stop(): Promise<void>;
}

export function buildEmbeddedDatabaseChildEnvironment(
  options: EmbeddedDatabaseOptions,
  inheritedEnvironment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment = { ...inheritedEnvironment };
  environment.MAESTRO_EMBEDDED_DATABASE_DIR = options.dataDir;
  environment.MAESTRO_EMBEDDED_DATABASE_MARKER = join(options.dataDir, "embedded-postgres", "server.json");
  if (options.host !== undefined) environment.MAESTRO_EMBEDDED_DATABASE_HOST = options.host;
  if (options.port === undefined) delete environment.MAESTRO_EMBEDDED_DATABASE_PORT;
  else environment.MAESTRO_EMBEDDED_DATABASE_PORT = String(options.port);
  if (options.maxConnections !== undefined) environment.MAESTRO_EMBEDDED_DATABASE_MAX_CONNECTIONS = String(options.maxConnections);
  return environment;
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
): Promise<EmbeddedDatabaseHandle | undefined> {
  let marker: { pid?: unknown; databaseUrl?: unknown };
  try {
    marker = JSON.parse(await readFile(markerPath, "utf8")) as { pid?: unknown; databaseUrl?: unknown };
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
    try {
      const commandLine = await readFile(`/proc/${marker.pid}/cmdline`, "utf8");
      if (!commandLine.includes("embedded-database-server")) return undefined;
    } catch {
      // Platforms without /proc still get PID liveness plus endpoint proof.
    }
  } catch {
    return undefined;
  }
  const pool = new Pool({ connectionString: marker.databaseUrl, max: 1 });
  try {
    await pool.query("SELECT 1");
    return { databaseUrl: marker.databaseUrl, stop: async () => undefined };
  } catch {
    return undefined;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export async function startEmbeddedDatabase(options: EmbeddedDatabaseOptions): Promise<EmbeddedDatabaseHandle> {
  if (options.detached !== true) return openEmbeddedDatabase(options);
  const markerPath = join(options.dataDir, "embedded-postgres", "server.json");
  const existing = await readOwnedEmbeddedDatabase(options, markerPath);
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
    ready = await new Promise<string>((resolve, reject) => {
      let buffer = "";
      const onData = (chunk: Buffer | string): void => {
        buffer += String(chunk);
        const newline = buffer.indexOf("\n");
        if (newline < 0) return;
        const line = buffer.slice(0, newline).trim();
        if (line.startsWith("READY ")) resolve(line.slice("READY ".length));
        else reject(new Error(line || "Embedded database child failed to start"));
      };
      output?.setEncoding("utf8");
      output?.on("data", onData);
      errorOutput?.setEncoding("utf8");
      errorOutput?.on("data", (chunk) => {
        if (String(chunk).trim() !== "") reject(new Error(String(chunk).trim()));
      });
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code !== 0) reject(new Error(`Embedded database child exited with code ${code ?? "unknown"}`));
      });
    });
  } catch (error) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already exited */
    }
    await waitForChildExit(child);
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
