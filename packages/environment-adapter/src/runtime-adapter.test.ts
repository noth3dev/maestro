import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { basename } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AuthorityDecision, AuthorityRepository } from "@maestro/authority";
import { AuthorizedEffectExecutor } from "@maestro/authority";
import type { EnvironmentRecord } from "@maestro/domain";
import {
  EnvironmentAuthorizationError,
  EnvironmentBoundaryError,
  EnvironmentExecutionError,
  createContainerSandboxAdapter,
  createLocalRuntimeAdapter,
  type SpawnedProcess,
} from "./runtime-adapter.js";

class FakeProcess extends EventEmitter implements SpawnedProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kills: string[] = [];

  kill(signal = "SIGTERM"): boolean {
    this.kills.push(signal);
    return true;
  }

  finish(code: number | null = 0, signal: string | null = null): void {
    this.emit("close", code, signal);
  }
}

function makeEnvironment(overrides: Partial<EnvironmentRecord> = {}): EnvironmentRecord {
  return {
    environmentId: "environment-1",
    recipeVersion: 1,
    goalId: "goal-1",
    departmentId: "engineering",
    workerId: "worker-1",
    projectId: "project-1",
    missionId: "mission-1",
    type: "local_worktree",
    recipe: { runtime: "node", environmentAllowlist: ["NODE_ENV"] },
    resolvedInputs: { lockfile: "sha256:lock" },
    capabilities: [{ name: "node", version: "24" }],
    boundaries: {
      network: ["none"],
      filesystem: ["/workspace/project"],
      processes: ["node"],
      browsers: [],
      devices: [],
    },
    secretsReferences: ["vault://project/token"],
    resources: {
      cpuMillis: 1000,
      memoryMb: 512,
      diskMb: 1024,
      processCount: 2,
      durationSeconds: 30,
    },
    expiresAt: "2030-01-01T00:00:00.000Z",
    state: "ready",
    setupLog: [],
    health: { status: "healthy", checkedAt: "2029-01-01T00:00:00.000Z", summary: "ok" },
    contentIdentity: "a".repeat(64),
    cleanup: {
      status: "not_scheduled",
      scheduledAt: null,
      completedAt: null,
      ownedResources: [],
      retainedEvidence: [],
    },
    ...overrides,
  };
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    commandId: "command-1",
    actorId: "worker-1",
    action: "project.test.run",
    target: "/workspace/project",
    policyVersion: 1,
    budgetEffectCents: 0,
    controlEpoch: "1",
    argv: [process.execPath, "-e", "process.stdout.write('ok')"],
    cwd: "/workspace/project",
    environment: { NODE_ENV: "test" },
    ...overrides,
  };
}

async function waitForTerminal(handle: { observe(): Promise<{ status: string }> }): Promise<Awaited<ReturnType<typeof handle.observe>>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await handle.observe();
    if (result.status !== "running") return result;
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("process did not reach a terminal state");
}

function permissiveAuthority() {
  const calls: string[] = [];
  const authority = {
    execute: vi.fn(async (request: Parameters<AuthorizedEffectExecutor["execute"]>[0], effect: () => Promise<unknown>): Promise<AuthorityDecision> => {
      calls.push(request.action);
      await effect();
      return { effect: "allow", reason: "exact_grant", classification: "ordinary", request };
    }),
  };
  return { authority, calls };
}

function realAuthority(allow: boolean) {
  const repository: AuthorityRepository = {
    load: async () => allow ? [{
      recordId: "grant-1", kind: "grant", commandId: null, projectId: "project-1", actorId: "worker-1",
      goalId: "goal-1", action: "project.test.run", target: "/workspace/project", policyVersion: 1,
      budgetEffectCents: 0, expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    }] : [],
    appendDecision: async () => undefined,
    recheckControl: async () => ({ effect: "allow" }),
  };
  return new AuthorizedEffectExecutor(repository, () => new Date("2029-01-01T00:00:00.000Z"));
}

describe("local runtime environment adapter", () => {
  it("executes a real local child without inheriting the host environment", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "maestro-runtime-test-"));
    try {
      const environment = makeEnvironment({ boundaries: { ...makeEnvironment().boundaries, filesystem: [cwd] } });
      const { authority } = permissiveAuthority();
      const adapter = createLocalRuntimeAdapter(environment, authority, { clock: () => new Date("2029-01-01T00:00:00.000Z") });
      const handle = await adapter.start(command({
        cwd,
        target: cwd,
        environment: { NODE_ENV: "test" },
        argv: [process.execPath, "-e", "process.stdout.write(process.env.HOST_SECRET ?? 'missing')"],
      }));

      await expect(waitForTerminal(handle)).resolves.toMatchObject({ status: "succeeded", stdout: "missing", stderr: "" });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("runs only an explicitly argv-shaped command in the bound ready environment", async () => {
    const childProcess = new FakeProcess();
    const spawn = vi.fn(() => childProcess);
    const { authority, calls } = permissiveAuthority();
    const adapter = createLocalRuntimeAdapter(makeEnvironment(), authority, { spawn });

    const handle = await adapter.start(command());

    expect(spawn).toHaveBeenCalledWith(process.execPath, ["-e", "process.stdout.write('ok')"], expect.objectContaining({
      cwd: "/workspace/project",
      env: { NODE_ENV: "test" },
      shell: false,
    }));
    expect(calls).toEqual(["project.test.run"]);
    await expect(handle.observe()).resolves.toMatchObject({ invocationId: handle.invocationId, status: "running" });

    childProcess.stdout.write("ok");
    childProcess.finish(0);
    await expect(handle.observe()).resolves.toMatchObject({ status: "succeeded", exitCode: 0, stdout: "ok" });
  });

  it("denies a command outside the filesystem, process, or environment allowlists before authority or spawn", async () => {
    const spawn = vi.fn(() => new FakeProcess());
    const { authority } = permissiveAuthority();
    const adapter = createLocalRuntimeAdapter(makeEnvironment(), authority, { spawn });

    await expect(adapter.start(command({ cwd: "/workspace/other" }))).rejects.toBeInstanceOf(EnvironmentBoundaryError);
    await expect(adapter.start(command({ argv: ["bash", "-lc", "echo unsafe"] }))).rejects.toBeInstanceOf(EnvironmentBoundaryError);
    await expect(adapter.start(command({ environment: { HOME: "/tmp" } }))).rejects.toBeInstanceOf(EnvironmentBoundaryError);
    expect(authority.execute).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("denies an actor that is not the environment worker", async () => {
    const spawn = vi.fn(() => new FakeProcess());
    const { authority } = permissiveAuthority();
    const adapter = createLocalRuntimeAdapter(makeEnvironment(), authority, { spawn });

    await expect(adapter.start(command({ actorId: "another-worker" }))).rejects.toBeInstanceOf(EnvironmentBoundaryError);
    expect(authority.execute).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("denies a cwd that is a symlink escaping the filesystem allowlist", async () => {
    const { symlinkSync } = await import("node:fs");
    const root = mkdtempSync(join(tmpdir(), "maestro-runtime-symlink-"));
    const allowed = join(root, "allowed");
    const outside = join(root, "outside");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(allowed);
    mkdirSync(outside);
    const escape = join(allowed, "escape");
    symlinkSync(outside, escape);
    try {
      const spawn = vi.fn(() => new FakeProcess());
      const { authority } = permissiveAuthority();
      const environment = makeEnvironment({ boundaries: { ...makeEnvironment().boundaries, filesystem: [allowed] } });
      const adapter = createLocalRuntimeAdapter(environment, authority, { spawn });

      await expect(adapter.start(command({ cwd: escape, target: escape }))).rejects.toBeInstanceOf(EnvironmentBoundaryError);
      expect(authority.execute).not.toHaveBeenCalled();
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("denies an absolute project target outside the filesystem allowlist", async () => {
    const spawn = vi.fn(() => new FakeProcess());
    const { authority } = permissiveAuthority();
    const adapter = createLocalRuntimeAdapter(makeEnvironment(), authority, { spawn });

    await expect(adapter.start(command({ target: "/workspace/other" }))).rejects.toBeInstanceOf(EnvironmentBoundaryError);
    expect(authority.execute).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("fails closed with a typed boundary error for a malformed command object", async () => {
    const spawn = vi.fn(() => new FakeProcess());
    const { authority } = permissiveAuthority();
    const adapter = createLocalRuntimeAdapter(makeEnvironment(), authority, { spawn });

    await expect(adapter.start(null as never)).rejects.toBeInstanceOf(EnvironmentBoundaryError);
    await expect(adapter.start(command({ cwd: null }))).rejects.toBeInstanceOf(EnvironmentBoundaryError);
    await expect(adapter.start(command({ environment: null }))).rejects.toBeInstanceOf(EnvironmentBoundaryError);
    expect(authority.execute).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("fails closed with a typed boundary error for malformed persisted limits", async () => {
    const spawn = vi.fn(() => new FakeProcess());
    const { authority } = permissiveAuthority();
    const malformed = createLocalRuntimeAdapter(makeEnvironment({
      boundaries: undefined as unknown as EnvironmentRecord["boundaries"],
    }), authority, { spawn });

    await expect(malformed.start(command())).rejects.toBeInstanceOf(EnvironmentExecutionError);
    expect(authority.execute).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("rejects expired or over-ceiling commands before asking the authority gateway", async () => {
    const spawn = vi.fn(() => new FakeProcess());
    const { authority } = permissiveAuthority();
    const expired = createLocalRuntimeAdapter(makeEnvironment({ expiresAt: "2028-01-01T00:00:00.000Z" }), authority, {
      spawn,
      clock: () => new Date("2029-01-01T00:00:00.000Z"),
    });
    await expect(expired.start(command())).rejects.toBeInstanceOf(EnvironmentExecutionError);

    const overCeiling = createLocalRuntimeAdapter(makeEnvironment(), authority, {
      spawn,
      clock: () => new Date("2029-01-01T00:00:00.000Z"),
    });
    await expect(overCeiling.start(command({ timeoutMs: 31_000 }))).rejects.toBeInstanceOf(EnvironmentBoundaryError);
    expect(authority.execute).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("wraps a provider spawn failure as a typed environment execution error", async () => {
    const { authority } = permissiveAuthority();
    const adapter = createLocalRuntimeAdapter(makeEnvironment(), authority, {
      spawn: () => { throw new Error("spawn failed"); },
    });

    await expect(adapter.start(command())).rejects.toMatchObject({ name: "EnvironmentExecutionError" });
  });

  it("rejects a durable reread whose immutable environment binding changed", async () => {
    const { authority } = permissiveAuthority();
    const adapter = createLocalRuntimeAdapter(makeEnvironment(), authority, {
      spawn: vi.fn(() => new FakeProcess()),
      readEnvironment: async () => makeEnvironment({ contentIdentity: "b".repeat(64) }),
    });

    await expect(adapter.start(command())).rejects.toBeInstanceOf(EnvironmentExecutionError);
    expect(authority.execute).not.toHaveBeenCalled();
  });

  it("does not invoke the process when the durable authority gateway denies the exact request", async () => {
    const spawn = vi.fn(() => new FakeProcess());
    const adapter = createLocalRuntimeAdapter(makeEnvironment(), realAuthority(false), { spawn });

    await expect(adapter.start(command())).rejects.toMatchObject({
      name: "EnvironmentAuthorizationError",
      decision: { effect: "deny", reason: "no_grant" },
    } satisfies Partial<EnvironmentAuthorizationError>);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("rejects a changed execution boundary during the authority effect", async () => {
    let current = makeEnvironment();
    const spawn = vi.fn(() => new FakeProcess());
    const authority = {
      execute: vi.fn(async (request: Parameters<AuthorizedEffectExecutor["execute"]>[0], effect: () => Promise<unknown>): Promise<AuthorityDecision> => {
        current = makeEnvironment({ boundaries: { ...current.boundaries, filesystem: ["/workspace"] } });
        await effect();
        return { effect: "allow", reason: "exact_grant", classification: "ordinary", request };
      }),
    };
    const adapter = createLocalRuntimeAdapter(makeEnvironment(), authority, {
      spawn,
      readEnvironment: async () => current,
    });

    await expect(adapter.start(command())).rejects.toBeInstanceOf(EnvironmentExecutionError);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("revalidates the bound environment inside the authorized effect to close the state TOCTOU", async () => {
    let current = makeEnvironment();
    const spawn = vi.fn(() => new FakeProcess());
    const authority = {
      execute: vi.fn(async (request: Parameters<AuthorizedEffectExecutor["execute"]>[0], effect: () => Promise<unknown>): Promise<AuthorityDecision> => {
        current = makeEnvironment({ state: "expired" });
        await effect();
        return { effect: "allow", reason: "exact_grant", classification: "ordinary", request };
      }),
    };
    const adapter = createLocalRuntimeAdapter(makeEnvironment(), authority, {
      spawn,
      readEnvironment: async () => current,
    });

    await expect(adapter.start(command())).rejects.toBeInstanceOf(EnvironmentExecutionError);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("kills a process and marks the result when output exceeds the byte cap", async () => {
    const childProcess = new FakeProcess();
    const { authority } = permissiveAuthority();
    const adapter = createLocalRuntimeAdapter(makeEnvironment(), authority, { spawn: vi.fn(() => childProcess) });
    const handle = await adapter.start(command({ outputCapBytes: 3 }));

    childProcess.stdout.write("abcd");
    expect(childProcess.kills).toEqual(["SIGTERM"]);
    childProcess.finish(null, "SIGTERM");
    await expect(handle.observe()).resolves.toMatchObject({
      status: "output_limit_exceeded",
      stdout: "abc",
      outputTruncated: true,
    });
  });

  it("kills a process when its command timeout expires", async () => {
    vi.useFakeTimers();
    try {
      const childProcess = new FakeProcess();
      const { authority } = permissiveAuthority();
      const adapter = createLocalRuntimeAdapter(makeEnvironment(), authority, { spawn: vi.fn(() => childProcess) });
      const handle = await adapter.start(command({ timeoutMs: 10 }));

      await vi.advanceTimersByTimeAsync(10);
      expect(childProcess.kills).toEqual(["SIGTERM"]);
      childProcess.finish(null, "SIGTERM");
      await expect(handle.observe()).resolves.toMatchObject({ status: "timed_out", signal: "SIGTERM" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not exceed the environment process ceiling and releases it after close", async () => {
    const firstProcess = new FakeProcess();
    const secondProcess = new FakeProcess();
    const spawn = vi.fn().mockReturnValueOnce(firstProcess).mockReturnValueOnce(secondProcess);
    const { authority } = permissiveAuthority();
    const adapter = createLocalRuntimeAdapter(makeEnvironment({ resources: { ...makeEnvironment().resources, processCount: 1 } }), authority, { spawn });

    const first = await adapter.start(command());
    await expect(adapter.start(command({ commandId: "command-2" }))).rejects.toBeInstanceOf(EnvironmentBoundaryError);
    firstProcess.finish(0);
    await expect(first.observe()).resolves.toMatchObject({ status: "succeeded" });
    await expect(adapter.start(command({ commandId: "command-3" }))).resolves.toBeDefined();
    secondProcess.finish(0);
  });

  it("cancels a running process and reports cancellation without allowing a second cancel", async () => {
    const childProcess = new FakeProcess();
    const { authority } = permissiveAuthority();
    const adapter = createLocalRuntimeAdapter(makeEnvironment(), authority, { spawn: vi.fn(() => childProcess) });
    const handle = await adapter.start(command());

    await expect(handle.cancel("operator stop")).resolves.toEqual({ cancelled: true });
    await expect(handle.cancel("retry")).resolves.toEqual({ cancelled: false });
    expect(childProcess.kills).toEqual(["SIGTERM"]);
    childProcess.finish(null, "SIGTERM");
    await expect(handle.observe()).resolves.toMatchObject({ status: "cancelled", signal: "SIGTERM" });
  });
});

describe("container sandbox environment adapter", () => {
  it("runs the capability through Docker with bounded resources and no host shell", async () => {
    const environment = makeEnvironment({
      type: "container_sandbox",
      recipe: { image: "node:24", environmentAllowlist: ["NODE_ENV"] },
    });
    const childProcess = new FakeProcess();
    const spawn = vi.fn(() => childProcess);
    const { authority } = permissiveAuthority();
    const adapter = createContainerSandboxAdapter(environment, authority, { spawn });

    const handle = await adapter.start(command());

    const [file, args, options] = spawn.mock.calls[0]!;
    expect(file).toBe("docker");
    expect(args).toEqual(expect.arrayContaining(["run", "--rm", "--network", "none", "--cpus", "1", "--memory", "512m", "--pids-limit", "2", "node:24", process.execPath, "-e", "process.stdout.write('ok')"]));
    expect(options).toMatchObject({ shell: false, cwd: "/workspace/project", env: { NODE_ENV: "test" } });
    childProcess.finish(0);
    await expect(handle.observe()).resolves.toMatchObject({ status: "succeeded" });
  });

  it("fails closed when the container recipe or network boundary cannot be enforced", async () => {
    const spawn = vi.fn(() => new FakeProcess());
    const { authority } = permissiveAuthority();
    await expect(createContainerSandboxAdapter(makeEnvironment({ type: "container_sandbox", recipe: {} }), authority, { spawn }).start(command())).rejects.toBeInstanceOf(EnvironmentBoundaryError);
    await expect(createContainerSandboxAdapter(makeEnvironment({ type: "container_sandbox", recipe: { image: "node:24" }, boundaries: { ...makeEnvironment().boundaries, network: ["internet"] } }), authority, { spawn }).start(command())).rejects.toBeInstanceOf(EnvironmentBoundaryError);
    expect(authority.execute).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });
});
