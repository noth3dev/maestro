import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { Pool } from "pg";
import { applyAllMigrations } from "./test-migrations.js";

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

/** Start an embedded PostgreSQL-compatible server for the current process. */
export async function openEmbeddedDatabase(options: Omit<EmbeddedDatabaseOptions, "detached">): Promise<EmbeddedDatabaseHandle> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const databasePath = join(options.dataDir, "embedded-postgres");
  await mkdir(options.dataDir, { recursive: true, mode: 0o700 });
  const db = await PGlite.create(databasePath, { extensions: { pgcrypto } });
  const server = new PGLiteSocketServer({ db, host, port, maxConnections: options.maxConnections ?? 8 });
  try {
    await server.start();
    const [serverHost, serverPort] = server.getServerConn().split(":");
    if (serverHost === undefined || serverPort === undefined || !/^\d+$/.test(serverPort))
      throw new Error("Embedded database did not expose a TCP address");
    const databaseUrl = `postgresql://maestro@${serverHost}:${serverPort}/maestro_local`;
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    try {
      await applyAllMigrations(pool);
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
        await server.stop();
        await db.close();
      },
    };
  } catch (error) {
    await server.stop().catch(() => undefined);
    await db.close().catch(() => undefined);
    throw error;
  }
}

/**
 * Start the embedded server in a detached child so a one-shot `maestro`
 * command does not orphan its Control Plane from the local database.
 */
export async function startEmbeddedDatabase(options: EmbeddedDatabaseOptions): Promise<EmbeddedDatabaseHandle> {
  if (options.detached !== true) return openEmbeddedDatabase(options);
  const sourceEntry = fileURLToPath(new URL("./embedded-database-server.js", import.meta.url));
  const entry = existsSync(sourceEntry) ? sourceEntry : fileURLToPath(new URL("../dist/embedded-database-server.js", import.meta.url));
  const child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      MAESTRO_EMBEDDED_DATABASE_DIR: options.dataDir,
      ...(options.host === undefined ? {} : { MAESTRO_EMBEDDED_DATABASE_HOST: options.host }),
      ...(options.port === undefined ? {} : { MAESTRO_EMBEDDED_DATABASE_PORT: String(options.port) }),
      ...(options.maxConnections === undefined ? {} : { MAESTRO_EMBEDDED_DATABASE_MAX_CONNECTIONS: String(options.maxConnections) }),
    },
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
    // A prior CLI/Carnegie process may already own the fixed local socket.
    // Reuse it after proving it is a live PostgreSQL endpoint, rather than
    // opening the same PGlite data directory twice.
    const host = options.host ?? "127.0.0.1";
    const port = options.port ?? 55433;
    const existingUrl = `postgresql://maestro@${host}:${port}/maestro_local`;
    const pool = new Pool({ connectionString: existingUrl, max: 1 });
    try {
      await pool.query("SELECT 1");
      ready = existingUrl;
    } catch {
      throw error;
    } finally {
      await pool.end().catch(() => undefined);
    }
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
      }
    },
  };
}
