import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { abortableDelay, waitForEmbeddedDatabaseReady, waitForSharedStartup } from "./embedded-database-startup.js";

afterEach(() => {
  vi.useRealTimers();
});

function createChild(): ChildProcess & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> } {
  const child = new EventEmitter();
  Object.assign(child, {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: vi.fn(() => true),
  });
  return child as unknown as ChildProcess & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> };
}

describe("embedded database startup delay", () => {
  it("clears its timer and rejects promptly when the caller aborts", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const delay = abortableDelay(30_000, controller.signal);
    expect(vi.getTimerCount()).toBe(1);

    controller.abort();

    await expect(delay).rejects.toMatchObject({ name: "AbortError" });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("shared startup waits", () => {
  it("lets one caller cancel without stopping the shared detached child", async () => {
    const controller = new AbortController();
    const child = createChild();
    const operation = waitForEmbeddedDatabaseReady(child, 30_000);
    const cancelledWait = waitForSharedStartup(operation, controller.signal);
    const remainingWait = waitForSharedStartup(operation);

    controller.abort();

    await expect(cancelledWait).rejects.toMatchObject({ name: "AbortError" });
    expect(child.kill).not.toHaveBeenCalled();
    child.stdout.write("READY postgresql://127.0.0.1:55433/maestro\n");
    await expect(remainingWait).resolves.toBe("postgresql://127.0.0.1:55433/maestro");
    expect(child.kill).not.toHaveBeenCalled();
    child.stdout.destroy();
    child.stderr.destroy();
  });
});

describe("embedded database READY handshake", () => {
  it("parses READY when the line arrives across stdout chunks", async () => {
    vi.useFakeTimers();
    const child = createChild();
    const ready = waitForEmbeddedDatabaseReady(child, 30_000);

    child.stdout.write("diagnostic\nREAD");
    child.stdout.write("Y postgresql://127.0.0.1:55433/maestro\n");

    await expect(ready).resolves.toBe("postgresql://127.0.0.1:55433/maestro");
    expect(vi.getTimerCount()).toBe(0);
    expect(child.listenerCount("close")).toBe(0);
    expect(child.stdout.listenerCount("data")).toBe(0);
    child.stdout.destroy();
    child.stderr.destroy();
  });

  it("kills a child that does not become ready before the deadline", async () => {
    vi.useFakeTimers();
    const child = createChild();
    const ready = waitForEmbeddedDatabaseReady(child, 25);
    const rejected = expect(ready).rejects.toThrow(/did not become ready within 25 ms/i);

    await vi.advanceTimersByTimeAsync(25);
    await rejected;

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(child.listenerCount("close")).toBe(0);
    expect(child.stdout.listenerCount("data")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    child.stdout.destroy();
    child.stderr.destroy();
  });

  it("caps captured stdout and stderr diagnostics when the child exits early", async () => {
    const child = createChild();
    const ready = waitForEmbeddedDatabaseReady(child, 30_000, 64);
    child.stdout.write("O".repeat(1000));
    child.stderr.write("E".repeat(1000));
    child.emit("close", 1, null);

    const error = await ready.catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message.length).toBeLessThan(200);
    expect((error as Error).message).toContain("O".repeat(20));
    expect((error as Error).message).toContain("E".repeat(20));
    child.stdout.destroy();
    child.stderr.destroy();
  });
});
