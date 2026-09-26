import { EventEmitter, getEventListeners } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

const spawnState = vi.hoisted(() => ({ count: 0, children: [] as unknown[] }));
vi.mock("node:child_process", async (importOriginal) => {
  const childProcess = await importOriginal<typeof import("node:child_process")>();
  const { EventEmitter } = await import("node:events");
  const { PassThrough } = await import("node:stream");

  class ControlledChild extends EventEmitter {
    readonly pid = 45_678;
    exitCode: number | null = null;
    signalCode: NodeJS.Signals | null = null;
    readonly stdout = new PassThrough();
    readonly stderr = new PassThrough();
    killed = false;

    unref(): void {}

    kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
      if (this.killed) return false;
      this.killed = true;
      this.signalCode = signal;
      this.exitCode = signal === "SIGKILL" ? 1 : 0;
      queueMicrotask(() => {
        this.emit("exit", this.exitCode, signal);
        this.emit("close", this.exitCode, signal);
      });
      return true;
    }
  }

  return {
    ...childProcess,
    spawn: (..._args: Parameters<typeof childProcess.spawn>) => {
      const child = new ControlledChild();
      spawnState.count += 1;
      spawnState.children.push(child);
      return child as unknown as ReturnType<typeof childProcess.spawn>;
    },
  };
});

import { startEmbeddedDatabase, type EmbeddedDatabaseHandle } from "./embedded-database.js";

interface ControlledChildLike extends EventEmitter {
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  killed: boolean;
  kill(signal?: NodeJS.Signals): boolean;
}

async function waitForCallerToJoin(signal: AbortSignal): Promise<void> {
  await vi.waitFor(() => expect(getEventListeners(signal, "abort")).toHaveLength(1), { timeout: 5_000, interval: 10 });
}

async function waitForSpawnedChild(): Promise<ControlledChildLike> {
  await vi.waitFor(() => expect(spawnState.count).toBeGreaterThan(0), { timeout: 5_000, interval: 10 });
  return spawnState.children[0] as ControlledChildLike;
}

function resetSpawnState(): void {
  spawnState.count = 0;
  spawnState.children.length = 0;
}

describe("embedded database detached startup single-flight", () => {
  it("keeps a spawned server reusable after its only caller cancels", async () => {
    resetSpawnState();
    const dataDir = await mkdtemp(join(tmpdir(), "maestro-embedded-cancelled-owner-"));
    const ownerController = new AbortController();
    const followerController = new AbortController();
    let ownerStart: Promise<EmbeddedDatabaseHandle> | undefined;
    let followerStart: Promise<EmbeddedDatabaseHandle> | undefined;
    let child: ControlledChildLike | undefined;
    try {
      ownerStart = startEmbeddedDatabase({ dataDir, detached: true, port: 55433, signal: ownerController.signal });
      child = await waitForSpawnedChild();
      await waitForCallerToJoin(ownerController.signal);
      ownerController.abort();
      await expect(ownerStart).rejects.toMatchObject({ name: "AbortError" });
      expect(child.killed).toBe(false);

      followerStart = startEmbeddedDatabase({ dataDir, detached: true, port: 55433, signal: followerController.signal });
      await waitForCallerToJoin(followerController.signal);
      expect(spawnState.count).toBe(1);
      child.stdout.write("READY postgresql://127.0.0.1:55433/maestro\n");
      const follower = await followerStart;
      expect(follower.databaseUrl).toBe("postgresql://127.0.0.1:55433/maestro");
      await follower.stop();
      expect(child.killed).toBe(false);
    } finally {
      child?.kill("SIGTERM");
      await Promise.allSettled(
        [ownerStart, followerStart].filter((start): start is Promise<EmbeddedDatabaseHandle> => start !== undefined),
      );
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("joins every concurrent caller before releasing the shared READY gate", async () => {
    resetSpawnState();
    const dataDir = await mkdtemp(join(tmpdir(), "maestro-embedded-ready-gate-"));
    const controllers = Array.from({ length: 4 }, () => new AbortController());
    let starts: Promise<EmbeddedDatabaseHandle>[] = [];
    let child: ControlledChildLike | undefined;
    try {
      starts = controllers.map((controller) => startEmbeddedDatabase({ dataDir, detached: true, port: 55433, signal: controller.signal }));
      child = await waitForSpawnedChild();
      await Promise.all(controllers.map((controller) => waitForCallerToJoin(controller.signal)));
      expect(spawnState.count).toBe(1);
      child.stdout.write("READY postgresql://127.0.0.1:55433/maestro\n");
      const handles = await Promise.all(starts);
      expect(handles.every((handle) => handle.databaseUrl === "postgresql://127.0.0.1:55433/maestro")).toBe(true);
      await Promise.all(handles.map((handle) => handle.stop()));
      expect(spawnState.count).toBe(1);
    } finally {
      child?.kill("SIGTERM");
      await Promise.allSettled(starts);
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
