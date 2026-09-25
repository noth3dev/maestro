import { describe, expect, it, vi } from "vitest";
import { ensureLocalDatabase, summarizeEmbeddedDatabaseError } from "./database.js";
import { DOCKER_LOCAL_DATABASE_URL } from "./constants.js";
import type { LocalCommandRunner } from "./types.js";

const embeddedHandle = { databaseUrl: "postgresql://maestro@127.0.0.1:55433/maestro_local", stop: async () => undefined };

function dockerRunner(state: { container: "running" | "stopped" | "missing"; daemon?: boolean }): LocalCommandRunner {
  return vi.fn(async (file: string, args: readonly string[]) => {
    if (file !== "docker") throw new Error(`unexpected command ${file}`);
    if (state.daemon === false) return { code: 127, stdout: "", stderr: "docker: command not found" };
    if (args[0] === "inspect") {
      return state.container === "missing"
        ? { code: 1, stdout: "", stderr: "Error: No such object: maestro-local-postgres" }
        : { code: 0, stdout: state.container === "running" ? "true" : "false", stderr: "" };
    }
    if (args[0] === "version") return { code: 0, stdout: "27.0.0", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  });
}

describe("ensureLocalDatabase engine auto-selection", () => {
  it("reuses an existing Maestro Docker PostgreSQL container when no engine is configured", async () => {
    const startEmbeddedDatabase = vi.fn(async () => embeddedHandle);
    const result = await ensureLocalDatabase({
      env: {},
      databaseUrl: undefined,
      dataDir: "/tmp/unused",
      runCommand: dockerRunner({ container: "running" }),
      retryDelayMs: 0,
      startEmbeddedDatabase,
    });
    expect(result).toEqual({ kind: "ready", databaseUrl: DOCKER_LOCAL_DATABASE_URL });
    expect(startEmbeddedDatabase).not.toHaveBeenCalled();
  });

  it("uses the embedded database when no Maestro container exists", async () => {
    const runCommand = dockerRunner({ container: "missing" });
    const result = await ensureLocalDatabase({
      env: {},
      databaseUrl: undefined,
      dataDir: "/tmp/unused",
      runCommand,
      retryDelayMs: 0,
      startEmbeddedDatabase: async () => embeddedHandle,
    });
    expect(result).toMatchObject({ kind: "ready", databaseUrl: embeddedHandle.databaseUrl });
    expect(runCommand).not.toHaveBeenCalledWith("docker", expect.arrayContaining(["run"]));
  });

  it("falls back to Docker PostgreSQL when the embedded database cannot start and Docker is available", async () => {
    const runCommand = dockerRunner({ container: "missing" });
    const result = await ensureLocalDatabase({
      env: {},
      databaseUrl: undefined,
      dataDir: "/tmp/unused",
      runCommand,
      retryDelayMs: 0,
      startEmbeddedDatabase: async () => { throw new Error("RuntimeError: Aborted()"); },
    });
    expect(result).toEqual({ kind: "ready", databaseUrl: DOCKER_LOCAL_DATABASE_URL });
    expect(runCommand).toHaveBeenCalledWith("docker", expect.arrayContaining(["run"]));
  });

  it("reports a bounded embedded failure when Docker is unavailable", async () => {
    const minifiedSource = `file:///x/pglite/dist/index.js:1\n${"import{a as b}from'./c.js';".repeat(5_000)}\n\nRuntimeError: Aborted(). Build with -sASSERTIONS for more info.\n    at abort (file:///x/index.js:1:1)`;
    const result = await ensureLocalDatabase({
      env: {},
      databaseUrl: undefined,
      dataDir: "/tmp/unused",
      runCommand: dockerRunner({ container: "missing", daemon: false }),
      retryDelayMs: 0,
      startEmbeddedDatabase: async () => { throw new Error(minifiedSource); },
    });
    expect(result.kind).toBe("unavailable");
    if (result.kind !== "unavailable") return;
    expect(result.reason).toContain("RuntimeError: Aborted()");
    expect(result.reason.length).toBeLessThan(600);
  });

  it("keeps an explicit embedded engine on the embedded path without probing Docker", async () => {
    const runCommand = dockerRunner({ container: "running" });
    const result = await ensureLocalDatabase({
      env: { MAESTRO_LOCAL_DB_ENGINE: "embedded" },
      databaseUrl: undefined,
      dataDir: "/tmp/unused",
      runCommand,
      retryDelayMs: 0,
      startEmbeddedDatabase: async () => embeddedHandle,
    });
    expect(result).toMatchObject({ kind: "ready", databaseUrl: embeddedHandle.databaseUrl });
    expect(runCommand).not.toHaveBeenCalled();
  });
});

describe("summarizeEmbeddedDatabaseError", () => {
  it("prefers the named error line over echoed source", () => {
    expect(summarizeEmbeddedDatabaseError("file:///a.js:1\nimport{x}from'y';\n\nError: port in use\n    at z")).toBe("Error: port in use");
  });

  it("truncates messages without a recognizable error line", () => {
    expect(summarizeEmbeddedDatabaseError("x".repeat(2_000)).length).toBeLessThanOrEqual(301);
  });
});
