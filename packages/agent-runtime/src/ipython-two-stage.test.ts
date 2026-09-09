import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { executeIpPythonBlockInTwoStages, type IpPythonHostRequest, type IpPythonPreparedEffect } from "./ipython-host.js";
import type { IpPythonExecutionRequest, IpPythonExecutionResult } from "./ipython-tool.js";

const request: IpPythonExecutionRequest = { sessionId: "session-1", code: "effects()" };
const ok = { state: "ok" as const, dataClass: "workspace" as const, content: "ok" };
const effect = (method: string, payload: unknown): IpPythonHostRequest => ({ requestId: "cell-1", hostRequestId: `host-${method}`, method, payload });
const transaction = (result: IpPythonExecutionResult = ok, commitResult: IpPythonExecutionResult = result): IpPythonPreparedEffect => ({ result, commit: async (lease) => { await lease.assertValid(); return commitResult; }, rollback: async () => {} });
const approve = (_effects: readonly IpPythonHostRequest[], blockDigest: string) => ({ approvalId: "approval-1", blockDigest, fencingToken: "1" });

function runner(blocks: { collect: readonly IpPythonHostRequest[]; execute: readonly IpPythonHostRequest[]; executeResult?: IpPythonExecutionResult }) {
  return async (_request: IpPythonExecutionRequest, mode: "collect" | "execute", hostRequest: (request: IpPythonHostRequest) => Promise<IpPythonExecutionResult>) => {
    const effects = blocks[mode];
    for (const item of effects) await hostRequest(item);
    return mode === "execute" ? (blocks.executeResult ?? ok) : ok;
  };
}

function options(overrides: Partial<Parameters<typeof executeIpPythonBlockInTwoStages>[0]> = {}) {
  return {
    request, fencingToken: "1", runBlock: runner({ collect: [], execute: [] }), approve, isFencingCurrent: () => true, isStopRequested: () => false,
    prepareEffect: async () => transaction(), recordEffectResult: async () => {}, recordStageBoundary: async () => {}, ...overrides,
  };
}

describe("IPython two-stage block execution", () => {
  it("collects a block without changing filesystem or Git bytes", async () => {
    const directory = mkdtempSync(join(tmpdir(), "maestro-ipython-two-stage-"));
    const file = join(directory, "a.txt");
    writeFileSync(file, "before\n");
    execFileSync("git", ["init", "--quiet"], { cwd: directory });
    const beforeFile = readFileSync(file);
    const beforeGit = execFileSync("git", ["status", "--porcelain=v1"], { cwd: directory });
    let committed = false;
    const boundaries: string[] = [];
    const result = await executeIpPythonBlockInTwoStages(options({
      runBlock: async (_request, mode, hostRequest) => {
        await hostRequest(effect("write_file", { path: "a.txt", content: "after\n" }));
        if (mode === "collect") {
          expect(readFileSync(file)).toEqual(beforeFile);
          expect(execFileSync("git", ["status", "--porcelain=v1"], { cwd: directory })).toEqual(beforeGit);
        }
        return mode === "execute" ? { ...ok, content: "" } : ok;
      },
      prepareEffect: async () => ({
        result: ok,
        commit: async (lease) => { await lease.assertValid(); committed = true; writeFileSync(file, "after\n"); return { ...ok, content: "committed" }; },
        rollback: async () => {},
      }),
      recordEffectResult: async () => {},
      recordStageBoundary: async (boundary) => { boundaries.push(`${boundary.stage}:${boundary.outcome}`); },
    }));
    expect(result.state).toBe("ok");
    expect(boundaries).toEqual(["collect:completed", "approval:completed", "execute:completed", "commit:completed"]);
    expect(committed).toBe(true);
    expect(readFileSync(file).toString()).toBe("after\n");
  });

  it("performs zero effects when approval rejects the collected block", async () => {
    const directory = mkdtempSync(join(tmpdir(), "maestro-ipython-approval-"));
    const file = join(directory, "a.txt");
    writeFileSync(file, "before\n");
    execFileSync("git", ["init", "--quiet"], { cwd: directory });
    const beforeFile = readFileSync(file);
    const beforeGit = execFileSync("git", ["status", "--porcelain=v1"], { cwd: directory });
    let prepared = 0;
    const result = await executeIpPythonBlockInTwoStages(options({
      runBlock: runner({ collect: [effect("write_file", { path: "a" })], execute: [effect("write_file", { path: "a" })] }),
      approve: async () => false, prepareEffect: async () => { prepared += 1; return transaction(); },
    }));
    expect(result).toMatchObject({ state: "error", reason: "approval_rejected" });
    expect(prepared).toBe(0);
    expect(readFileSync(file)).toEqual(beforeFile);
    expect(execFileSync("git", ["status", "--porcelain=v1"], { cwd: directory })).toEqual(beforeGit);
  });

  it("fails closed on a malformed approval response", async () => {
    const result = await executeIpPythonBlockInTwoStages(options({
      runBlock: runner({ collect: [effect("write_file", { path: "a" })], execute: [] }),
      approve: async () => null as never,
    }));
    expect(result).toMatchObject({ state: "error", reason: "approval_rejected" });
  });

  it("rejects stage divergence before committing any prepared effect", async () => {
    const directory = mkdtempSync(join(tmpdir(), "maestro-ipython-divergence-"));
    const file = join(directory, "a.txt");
    writeFileSync(file, "before\n");
    execFileSync("git", ["init", "--quiet"], { cwd: directory });
    const beforeFile = readFileSync(file);
    const beforeGit = execFileSync("git", ["status", "--porcelain=v1"], { cwd: directory });
    let committed = 0;
    const result = await executeIpPythonBlockInTwoStages(options({
      runBlock: runner({ collect: [effect("write_file", { path: "a" })], execute: [effect("write_file", { path: "a" }), effect("git_commit", { ref: "HEAD" })] }),
      prepareEffect: async () => ({ result: ok, commit: async (lease) => { await lease.assertValid(); committed += 1; return ok; }, rollback: async () => {} }),
      recordEffectResult: async () => {},
    }));
    expect(result).toMatchObject({ state: "error", reason: "stage_divergence" });
    expect(committed).toBe(0);
    expect(readFileSync(file)).toEqual(beforeFile);
    expect(execFileSync("git", ["status", "--porcelain=v1"], { cwd: directory })).toEqual(beforeGit);
  });

  it("leaves no effect when stage one is stopped and records queue-boundary outcomes", async () => {
    const result = await executeIpPythonBlockInTwoStages(options({
      runBlock: async (_request, mode) => mode === "collect" ? { state: "cancelled", dataClass: "workspace", content: "stopped", reason: "user_stop" } : ok,
    }));
    expect(result).toMatchObject({ state: "cancelled", reason: "user_stop" });
  });

  it("stops stage two at the queue boundary and records skipped effects", async () => {
    const records: Array<{ index: number; reason?: string; state: string }> = [];
    let committed = 0;
    const result = await executeIpPythonBlockInTwoStages(options({
      runBlock: async (_request, mode, hostRequest) => {
        if (mode === "collect") { await hostRequest(effect("write_file", { path: "a" })); return ok; }
        await hostRequest(effect("write_file", { path: "a" }));
        await hostRequest(effect("git_commit", { ref: "HEAD" }));
        return { state: "cancelled", dataClass: "workspace", content: "stopped", reason: "user_stop" };
      },
      prepareEffect: async () => ({ result: ok, commit: async (lease) => { await lease.assertValid(); committed += 1; return ok; }, rollback: async () => {} }),
      recordEffectResult: async (index, _effect, outcome) => { records.push({ index, state: outcome.state, ...(outcome.reason === undefined ? {} : { reason: outcome.reason }) }); },
    }));
    expect(result).toMatchObject({ state: "cancelled", reason: "user_stop" });
    expect(committed).toBe(0);
    expect(records).toEqual([{ index: 0, state: "unknown", reason: "user_stop" }, { index: 1, state: "unknown", reason: "user_stop" }]);
  });

  it("aborts after stage two when the fencing token becomes stale before commit", async () => {
    let checks = 0;
    let prepared = 0;
    let committed = 0;
    const result = await executeIpPythonBlockInTwoStages(options({
      runBlock: runner({ collect: [effect("write_file", { path: "a" })], execute: [effect("write_file", { path: "a" })] }),
      isFencingCurrent: () => { checks += 1; return checks < 4; },
      prepareEffect: async () => { prepared += 1; return { result: ok, commit: async (lease) => { await lease.assertValid(); committed += 1; return ok; }, rollback: async () => {} }; },
    }));
    expect(result).toMatchObject({ state: "unknown", reason: "stale_fencing_token" });
    expect(prepared).toBe(1);
    expect(committed).toBe(0);
  });

  it("aborts before stage two when its fencing token is stale", async () => {
    let executeRuns = 0;
    let prepared = 0;
    const result = await executeIpPythonBlockInTwoStages(options({
      runBlock: async (_request, mode, hostRequest) => { if (mode === "execute") executeRuns += 1; await hostRequest(effect("write_file", { path: "a" })); return ok; },
      isFencingCurrent: () => false, prepareEffect: async () => { prepared += 1; return transaction(); },
    }));
    expect(result).toMatchObject({ state: "unknown", reason: "stale_fencing_token" });
    expect(executeRuns).toBe(0);
    expect(prepared).toBe(0);
  });

  it("fails closed and records a durable boundary when preparation or journaling fails", async () => {
    const boundaries: string[] = [];
    const preparedFailure = await executeIpPythonBlockInTwoStages(options({
      runBlock: runner({ collect: [effect("write_file", { path: "a" })], execute: [effect("write_file", { path: "a" })] }),
      prepareEffect: async () => { throw new Error("prepare failed"); },
      recordStageBoundary: async (boundary) => { boundaries.push(`${boundary.stage}:${boundary.outcome}`); },
    }));
    expect(preparedFailure).toMatchObject({ state: "unknown", reason: "stage_two_failed" });
    expect(boundaries).toContain("execute:failed");

    let commits = 0;
    const journalFailure = await executeIpPythonBlockInTwoStages(options({
      runBlock: runner({ collect: [effect("write_file", { path: "a" }), effect("write_file", { path: "b" })], execute: [effect("write_file", { path: "a" }), effect("write_file", { path: "b" })] }),
      prepareEffect: async () => ({ result: ok, commit: async () => { commits += 1; return ok; }, rollback: async () => {} }),
      recordEffectResult: async () => { throw new Error("journal failed"); },
    }));
    expect(journalFailure).toMatchObject({ state: "unknown", reason: "journal_failed" });
    expect(commits).toBe(1);
  });

  it("stops the commit queue when the stop signal arrives between effects", async () => {
    let checks = 0;
    let committed = 0;
    const result = await executeIpPythonBlockInTwoStages(options({
      runBlock: runner({ collect: [effect("write_file", { path: "a" }), effect("write_file", { path: "b" })], execute: [effect("write_file", { path: "a" }), effect("write_file", { path: "b" })] }),
      isStopRequested: () => { checks += 1; return checks >= 4; },
      prepareEffect: async () => transaction(),
      recordEffectResult: async (_index, _effect, outcome) => { if (outcome.state === "ok") committed += 1; },
    }));
    expect(result).toMatchObject({ state: "unknown", reason: "stop_requested" });
    expect(committed).toBeLessThan(2);
  });
});
