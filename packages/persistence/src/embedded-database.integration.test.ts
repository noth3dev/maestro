import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startEmbeddedDatabase, type EmbeddedDatabaseHandle } from "./embedded-database.js";

const childProcessTracker = vi.hoisted(() => ({ spawnCount: 0 }));
vi.mock("node:child_process", async (importOriginal) => {
  const childProcess = await importOriginal<typeof import("node:child_process")>();
  return {
    ...childProcess,
    spawn: (...args: Parameters<typeof childProcess.spawn>) => {
      childProcessTracker.spawnCount += 1;
      return childProcess.spawn(...args);
    },
  };
});

const handles: EmbeddedDatabaseHandle[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.stop();
});

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Could not allocate a local TCP port");
  await new Promise<void>((resolve, reject) => server.close((error) => (error === undefined ? resolve() : reject(error))));
  return address.port;
}

async function waitForEmbeddedDatabaseDirectory(dataDir: string): Promise<void> {
  const databaseDirectory = join(dataDir, "embedded-postgres");
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (existsSync(databaseDirectory)) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Embedded database child did not create its data directory before the test barrier");
}

describe("embedded PostgreSQL-compatible database", () => {
  it("applies every existing migration through the normal PostgreSQL wire protocol", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "maestro-embedded-db-"));
    try {
      const embedded = await startEmbeddedDatabase({ dataDir, port: 0 });
      handles.push(embedded);
      const pool = new Pool({ connectionString: embedded.databaseUrl, max: 1 });
      try {
        const result = await pool.query<{ table_name: string }>(
          "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
        );
        expect(result.rows.map((row) => row.table_name)).toContain("goals");
        await expect(pool.query("SELECT gen_random_uuid()")).resolves.toMatchObject({ rowCount: 1 });
      } finally {
        await pool.end();
      }
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  }, 120_000);

  it("reuses an already-running fixed-port embedded server for the same data directory", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "maestro-embedded-reuse-"));
    const port = await availablePort();
    let first: EmbeddedDatabaseHandle | undefined;
    let second: EmbeddedDatabaseHandle | undefined;
    try {
      first = await startEmbeddedDatabase({ dataDir, detached: true, port });
      second = await startEmbeddedDatabase({ dataDir, detached: true, port });
      expect(second.databaseUrl).toBe(first.databaseUrl);
      const pool = new Pool({ connectionString: first.databaseUrl, max: 1 });
      try {
        await expect(pool.query("SELECT 1")).resolves.toMatchObject({ rowCount: 1 });
      } finally {
        await pool.end();
      }
    } finally {
      await second?.stop();
      await first?.stop();
      await rm(dataDir, { recursive: true, force: true });
    }
  }, 120_000);

  it("rejects a live server marker copied from a different data directory", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "maestro-embedded-marker-source-"));
    const copiedDataDir = await mkdtemp(join(tmpdir(), "maestro-embedded-marker-copy-"));
    const port = await availablePort();
    let embedded: EmbeddedDatabaseHandle | undefined;
    try {
      embedded = await startEmbeddedDatabase({ dataDir, detached: true, port });
      const copiedMarkerDir = join(copiedDataDir, "embedded-postgres");
      await mkdir(copiedMarkerDir, { recursive: true });
      await copyFile(join(dataDir, "embedded-postgres", "server.json"), join(copiedMarkerDir, "server.json"));

      await expect(startEmbeddedDatabase({ dataDir: copiedDataDir, detached: true, port })).rejects.toThrow(
        /different or unverified data directory/i,
      );
    } finally {
      await embedded?.stop();
      await rm(dataDir, { recursive: true, force: true });
      await rm(copiedDataDir, { recursive: true, force: true });
    }
  }, 120_000);

  it("rejects a marker with a partial data-directory identity", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "maestro-embedded-partial-marker-"));
    const port = await availablePort();
    let embedded: EmbeddedDatabaseHandle | undefined;
    try {
      embedded = await startEmbeddedDatabase({ dataDir, detached: true, port });
      const markerPath = join(dataDir, "embedded-postgres", "server.json");
      const marker = JSON.parse(await readFile(markerPath, "utf8")) as Record<string, unknown>;
      delete marker.databaseDevice;
      await writeFile(markerPath, JSON.stringify(marker), { mode: 0o600 });

      await expect(startEmbeddedDatabase({ dataDir, detached: true, port })).rejects.toThrow(/different or unverified data directory/i);
    } finally {
      await embedded?.stop();
      await rm(dataDir, { recursive: true, force: true });
    }
  }, 120_000);

  it.skipIf(process.platform !== "linux")(
    "rejects a marker from a different Linux process generation",
    async () => {
      const dataDir = await mkdtemp(join(tmpdir(), "maestro-embedded-process-generation-"));
      const port = await availablePort();
      let embedded: EmbeddedDatabaseHandle | undefined;
      try {
        embedded = await startEmbeddedDatabase({ dataDir, detached: true, port });
        const markerPath = join(dataDir, "embedded-postgres", "server.json");
        const marker = JSON.parse(await readFile(markerPath, "utf8")) as Record<string, unknown>;
        marker.processIdentity = { bootId: "different-boot", startTime: "0" };
        await writeFile(markerPath, JSON.stringify(marker), { mode: 0o600 });

        await expect(startEmbeddedDatabase({ dataDir, detached: true, port })).rejects.toThrow(/different or unverified process identity/i);
      } finally {
        await embedded?.stop();
        await rm(dataDir, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it("persists and validates detached server connection limits", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "maestro-embedded-max-connections-"));
    const port = await availablePort();
    let first: EmbeddedDatabaseHandle | undefined;
    let same: EmbeddedDatabaseHandle | undefined;
    let pool: Pool | undefined;
    try {
      first = await startEmbeddedDatabase({ dataDir, detached: true, port, maxConnections: 3 });
      const marker = JSON.parse(await readFile(join(dataDir, "embedded-postgres", "server.json"), "utf8")) as Record<string, unknown>;
      expect(marker.maxConnections).toBe(3);
      same = await startEmbeddedDatabase({ dataDir, detached: true, port, maxConnections: 3 });
      expect(same.databaseUrl).toBe(first.databaseUrl);
      await expect(startEmbeddedDatabase({ dataDir, detached: true, port, maxConnections: 5 })).rejects.toThrow(
        /different connection options/i,
      );

      pool = new Pool({ connectionString: first.databaseUrl, max: 1 });
      await expect(pool.query("SELECT 1")).resolves.toMatchObject({ rowCount: 1 });
      await pool.end();
      pool = undefined;
    } finally {
      await pool?.end();
      await same?.stop();
      await first?.stop();
      await rm(dataDir, { recursive: true, force: true });
    }
  }, 120_000);

  it.skipIf(process.platform !== "linux")(
    "validates current and legacy limits against the live Linux process",
    async () => {
      const dataDir = await mkdtemp(join(tmpdir(), "maestro-embedded-linux-max-connections-"));
      const port = await availablePort();
      let first: EmbeddedDatabaseHandle | undefined;
      let legacySame: EmbeddedDatabaseHandle | undefined;
      try {
        first = await startEmbeddedDatabase({ dataDir, detached: true, port, maxConnections: 3 });
        const markerPath = join(dataDir, "embedded-postgres", "server.json");
        const marker = JSON.parse(await readFile(markerPath, "utf8")) as Record<string, unknown>;
        marker.maxConnections = 5;
        await writeFile(markerPath, JSON.stringify(marker), { mode: 0o600 });
        await expect(startEmbeddedDatabase({ dataDir, detached: true, port, maxConnections: 5 })).rejects.toThrow(
          /marker does not match the running server configuration/i,
        );

        marker.maxConnections = 3;
        await writeFile(markerPath, JSON.stringify(marker), { mode: 0o600 });
        delete marker.maxConnections;
        await writeFile(markerPath, JSON.stringify(marker), { mode: 0o600 });
        legacySame = await startEmbeddedDatabase({ dataDir, detached: true, port, maxConnections: 3 });
        expect(legacySame.databaseUrl).toBe(first.databaseUrl);
        await expect(startEmbeddedDatabase({ dataDir, detached: true, port, maxConnections: 5 })).rejects.toThrow(
          /different connection options/i,
        );
      } finally {
        await legacySame?.stop();
        await first?.stop();
        await rm(dataDir, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it("resolves inherited detached connection limits into the marker", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "maestro-embedded-inherited-max-"));
    const port = await availablePort();
    const variable = "MAESTRO_EMBEDDED_DATABASE_MAX_CONNECTIONS";
    const previousValue = process.env[variable];
    let embedded: EmbeddedDatabaseHandle | undefined;
    try {
      process.env[variable] = "6";
      embedded = await startEmbeddedDatabase({ dataDir, detached: true, port });
      const marker = JSON.parse(await readFile(join(dataDir, "embedded-postgres", "server.json"), "utf8")) as Record<string, unknown>;
      expect(marker.maxConnections).toBe(6);
    } finally {
      await embedded?.stop();
      if (previousValue === undefined) delete process.env[variable];
      else process.env[variable] = previousValue;
      await rm(dataDir, { recursive: true, force: true });
    }
  }, 120_000);

  it.skipIf(process.platform !== "linux")(
    "reuses a directory-identity marker without process-generation metadata only with live path proof",
    async () => {
      const dataDir = await mkdtemp(join(tmpdir(), "maestro-embedded-prior-marker-"));
      const port = await availablePort();
      let first: EmbeddedDatabaseHandle | undefined;
      let second: EmbeddedDatabaseHandle | undefined;
      try {
        first = await startEmbeddedDatabase({ dataDir, detached: true, port });
        const markerPath = join(dataDir, "embedded-postgres", "server.json");
        const marker = JSON.parse(await readFile(markerPath, "utf8")) as Record<string, unknown>;
        delete marker.processIdentity;
        await writeFile(markerPath, JSON.stringify(marker), { mode: 0o600 });

        second = await startEmbeddedDatabase({ dataDir, detached: true, port });
        expect(second.databaseUrl).toBe(first.databaseUrl);
      } finally {
        await second?.stop();
        await first?.stop();
        await rm(dataDir, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it.skipIf(process.platform !== "linux")(
    "rejects a stale marker after its data-directory symlink is retargeted",
    async () => {
      const rootDir = await mkdtemp(join(tmpdir(), "maestro-embedded-replaced-directory-"));
      const originalDataDir = join(rootDir, "database-original");
      const replacementDataDir = join(rootDir, "database-replacement");
      const dataDirLink = join(rootDir, "database-current");
      const port = await availablePort();
      let embedded: EmbeddedDatabaseHandle | undefined;
      try {
        await mkdir(originalDataDir, { recursive: true });
        await mkdir(replacementDataDir, { recursive: true });
        await symlink(originalDataDir, dataDirLink);
        embedded = await startEmbeddedDatabase({ dataDir: dataDirLink, detached: true, port });
        const originalMarker = join(originalDataDir, "embedded-postgres", "server.json");
        const replacementMarkerDir = join(replacementDataDir, "embedded-postgres");
        await mkdir(replacementMarkerDir, { recursive: true });
        await copyFile(originalMarker, join(replacementMarkerDir, "server.json"));
        await rm(dataDirLink);
        await symlink(replacementDataDir, dataDirLink);

        await expect(startEmbeddedDatabase({ dataDir: dataDirLink, detached: true, port })).rejects.toThrow(
          /different or unverified data directory/i,
        );
      } finally {
        await embedded?.stop();
        await rm(rootDir, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it("reuses a legacy marker only when the live child proves the same data directory", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "maestro-embedded-legacy-marker-"));
    const port = await availablePort();
    let first: EmbeddedDatabaseHandle | undefined;
    let second: EmbeddedDatabaseHandle | undefined;
    try {
      first = await startEmbeddedDatabase({ dataDir, detached: true, port });
      const markerPath = join(dataDir, "embedded-postgres", "server.json");
      const legacyMarker = JSON.parse(await readFile(markerPath, "utf8")) as Record<string, unknown>;
      delete legacyMarker.databasePath;
      delete legacyMarker.databaseDevice;
      delete legacyMarker.databaseInode;
      delete legacyMarker.processIdentity;
      await writeFile(markerPath, JSON.stringify(legacyMarker), { mode: 0o600 });

      if (process.platform === "linux") {
        second = await startEmbeddedDatabase({ dataDir, detached: true, port });
        expect(second.databaseUrl).toBe(first.databaseUrl);
      } else {
        await expect(startEmbeddedDatabase({ dataDir, detached: true, port })).rejects.toThrow(/different or unverified data directory/i);
      }
    } finally {
      await second?.stop();
      await first?.stop();
      await rm(dataDir, { recursive: true, force: true });
    }
  }, 120_000);

  it("coalesces concurrent detached starts for the same data directory", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "maestro-embedded-concurrent-"));
    const port = await availablePort();
    const opened: EmbeddedDatabaseHandle[] = [];
    try {
      childProcessTracker.spawnCount = 0;
      const results = await Promise.allSettled(Array.from({ length: 4 }, () => startEmbeddedDatabase({ dataDir, detached: true, port })));
      for (const result of results) {
        if (result.status === "fulfilled") opened.push(result.value);
      }
      const rejected = results.filter((result) => result.status === "rejected");
      expect(rejected.map((result) => (result.status === "rejected" ? String(result.reason) : ""))).toEqual([]);
      expect(opened).toHaveLength(4);
      expect(childProcessTracker.spawnCount).toBe(1);
      expect(new Set(opened.map((handle) => handle.databaseUrl)).size).toBe(1);
      const pool = new Pool({ connectionString: opened[0]!.databaseUrl, max: 1 });
      try {
        await expect(pool.query("SELECT 1")).resolves.toMatchObject({ rowCount: 1 });
      } finally {
        await pool.end();
      }
    } finally {
      for (const handle of opened) await handle.stop();
      await rm(dataDir, { recursive: true, force: true });
    }
  }, 120_000);

  it("rejects conflicting connection options and gives followers non-owning handles", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "maestro-embedded-shared-followers-"));
    const port = await availablePort();
    let ownerStart: Promise<EmbeddedDatabaseHandle> | undefined;
    let owner: EmbeddedDatabaseHandle | undefined;
    let follower: EmbeddedDatabaseHandle | undefined;
    let pool: Pool | undefined;
    try {
      ownerStart = startEmbeddedDatabase({ dataDir, detached: true, port, maxConnections: 3 });
      void ownerStart.catch(() => undefined);
      await waitForEmbeddedDatabaseDirectory(dataDir);
      await expect(startEmbeddedDatabase({ dataDir, detached: true, port, maxConnections: 9 })).rejects.toThrow(
        /different connection options/i,
      );
      follower = await startEmbeddedDatabase({ dataDir, detached: true, port, maxConnections: 3 });
      owner = await ownerStart;
      await follower.stop();
      pool = new Pool({ connectionString: owner.databaseUrl, max: 1 });
      await expect(pool.query("SELECT 1")).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await pool?.end();
      await follower?.stop();
      const ownerToStop = owner ?? (await ownerStart?.catch(() => undefined));
      await ownerToStop?.stop();
      await rm(dataDir, { recursive: true, force: true });
    }
  }, 120_000);

  it("rejects an unrelated port owner and allows a later retry", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "maestro-embedded-port-conflict-"));
    const listener = createServer();
    await new Promise<void>((resolve, reject) => {
      listener.once("error", reject);
      listener.listen(0, "127.0.0.1", resolve);
    });
    const address = listener.address();
    if (address === null || typeof address === "string") throw new Error("Could not inspect the occupied local port");
    const startedAt = Date.now();
    let listenerClosed = false;
    let recovered: EmbeddedDatabaseHandle | undefined;
    let pool: Pool | undefined;
    try {
      await expect(startEmbeddedDatabase({ dataDir, detached: true, port: address.port })).rejects.toThrow(
        /EADDRINUSE|address already in use/i,
      );
      expect(Date.now() - startedAt).toBeLessThan(25_000);
      expect(listener.listening).toBe(true);
      await new Promise<void>((resolve, reject) => listener.close((error) => (error === undefined ? resolve() : reject(error))));
      listenerClosed = true;

      recovered = await startEmbeddedDatabase({ dataDir, detached: true, port: address.port });
      pool = new Pool({ connectionString: recovered.databaseUrl, max: 1 });
      await expect(pool.query("SELECT 1")).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await pool?.end();
      await recovered?.stop();
      if (!listenerClosed) {
        await new Promise<void>((resolve, reject) => listener.close((error) => (error === undefined ? resolve() : reject(error))));
      }
      await rm(dataDir, { recursive: true, force: true });
    }
  }, 120_000);

  it("waits for active socket transaction cleanup before closing the database", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "maestro-embedded-shutdown-"));
    let embedded: EmbeddedDatabaseHandle | undefined;
    let pool: Pool | undefined;
    let client: PoolClient | undefined;
    try {
      embedded = await startEmbeddedDatabase({ dataDir, port: 0 });
      pool = new Pool({ connectionString: embedded.databaseUrl, max: 1 });
      client = await pool.connect();
      await client.query("BEGIN");
      client.release(true);
      client = undefined;
      await expect(embedded.stop()).resolves.toBeUndefined();
      embedded = undefined;
    } finally {
      client?.release(true);
      await pool?.end();
      await embedded?.stop();
      await rm(dataDir, { recursive: true, force: true });
    }
  }, 120_000);

  it("waits for a closed socket's asynchronous detach before closing the database", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "maestro-embedded-closed-socket-"));
    let embedded: EmbeddedDatabaseHandle | undefined;
    let pool: Pool | undefined;
    try {
      embedded = await startEmbeddedDatabase({ dataDir, port: 0 });
      pool = new Pool({ connectionString: embedded.databaseUrl, max: 1 });
      await expect(pool.query("SELECT 1")).resolves.toMatchObject({ rowCount: 1 });
      await pool.end();
      pool = undefined;
      await expect(embedded.stop()).resolves.toBeUndefined();
      embedded = undefined;
    } finally {
      await pool?.end();
      await embedded?.stop();
      await rm(dataDir, { recursive: true, force: true });
    }
  }, 120_000);

  it("preserves user data when the same embedded data directory restarts", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "maestro-embedded-restart-"));
    let first: EmbeddedDatabaseHandle | undefined;
    let second: EmbeddedDatabaseHandle | undefined;
    try {
      first = await startEmbeddedDatabase({ dataDir, port: 0 });
      const writer = new Pool({ connectionString: first.databaseUrl, max: 1 });
      await writer.query("CREATE TABLE restart_probe (value text NOT NULL)");
      await writer.query("INSERT INTO restart_probe (value) VALUES ('survives')");
      await writer.end();
      await first.stop();
      first = undefined;

      second = await startEmbeddedDatabase({ dataDir, port: 0 });
      const reader = new Pool({ connectionString: second.databaseUrl, max: 1 });
      try {
        await expect(reader.query("SELECT value FROM restart_probe")).resolves.toMatchObject({ rows: [{ value: "survives" }] });
      } finally {
        await reader.end();
      }
    } finally {
      await first?.stop();
      await second?.stop();
      await rm(dataDir, { recursive: true, force: true });
    }
  }, 120_000);
});
