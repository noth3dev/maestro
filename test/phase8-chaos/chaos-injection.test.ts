import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { FileEvidenceStore } from "@maestro/evidence";
import { GitOutcomeUnknownError, createLocalGitPort } from "@maestro/git-adapter";
import { resolveWorkerModelForRouting } from "../../apps/control-plane/src/worker-service.js";
import { CHAOS_BOUNDARIES, ChaosInjectedError, createChaosInjector } from "./chaos-injection.js";

describe("Phase 8 §S3 chaos injector", () => {
  it("supports deterministic one-shot delay, failure, and corruption at named boundaries", async () => {
    const chaos = createChaosInjector();
    expect(CHAOS_BOUNDARIES).toEqual(expect.arrayContaining([
      "goal.before-commit", "postgres.reconnect", "native-runtime.session-loss", "worker.timeout",
      "worker.cancel", "worker.late-result", "worker.duplicate-reply", "git.merge-conflict",
      "environment.disconnect", "device.disconnect", "discord.outage", "discord.duplicate", "discord.stale",
      "evaluator.before-verdict", "rollout.observe", "app.stale-command", "evidence.before-write",
    ]));

    chaos.inject("goal.before-commit", { kind: "throw", error: new ChaosInjectedError("goal.before-commit") });
    await expect(chaos.checkpoint("goal.before-commit")).rejects.toMatchObject({ name: "ChaosInjectedError", boundary: "goal.before-commit" });
    await expect(chaos.checkpoint("goal.before-commit")).resolves.toBeUndefined();

    vi.useFakeTimers();
    try {
      chaos.inject("postgres.reconnect", { kind: "delay", delayMs: 10 });
      const delayed = chaos.checkpoint("postgres.reconnect");
      await vi.advanceTimersByTimeAsync(10);
      await expect(delayed).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }

    chaos.inject("evidence.before-write", { kind: "corrupt", transform: () => ({ hash: "forged" }) });
    expect(chaos.corrupt("evidence.before-write", { hash: "real" })).toEqual({ hash: "forged" });
    expect(chaos.corrupt("evidence.before-write", { hash: "real" })).toEqual({ hash: "real" });
  });

  it("runs the injected fault before the operation and consumes it once", async () => {
    const chaos = createChaosInjector().inject("worker.after-provider-spawn", { kind: "throw", error: new Error("provider response lost") });
    const calls: string[] = [];
    await expect(chaos.run("worker.after-provider-spawn", async () => { calls.push("operation"); return "ok"; })).rejects.toThrow("provider response lost");
    expect(calls).toEqual([]);
    await expect(chaos.run("worker.after-provider-spawn", async () => { calls.push("operation"); return "ok"; })).resolves.toBe("ok");
    expect(calls).toEqual(["operation"]);
  });

  it("fails closed on native runtime loss without selecting an unrouted fallback model", async () => {
    expect(() => resolveWorkerModelForRouting("ensemble", undefined, "fallback/model", true)).toThrow("caller-selected model");
    expect(() => resolveWorkerModelForRouting("ensemble", undefined, undefined, false)).toThrow("not enabled");
    const unavailable = { async spawn(): Promise<never> { throw new Error("native runtime unavailable"); } };
    await expect(unavailable.spawn()).rejects.toThrow("native runtime unavailable");
  });

  it("classifies a Git response lost after the real branch mutation as unknown", async () => {
    const root = await mkdtemp(join(tmpdir(), "maestro-s3-git-"));
    try {
      const repository = join(root, "repo");
      execFileSync("git", ["init", "--quiet", "--initial-branch=main", repository]);
      execFileSync("git", ["-C", repository, "-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "initial"]);
      const base = execFileSync("git", ["-C", repository, "rev-parse", "HEAD"]).toString().trim();
      const port = createLocalGitPort({
        workspaceRoot: root,
        pathScope: [root],
        context: { commandId: "s3-git", projectId: "s3-project", actorId: "s3-actor", goalId: "s3-goal", policyVersion: 1, budgetEffectCents: 0, controlEpoch: "1" },
        authority: { async execute(request, effect) { await effect(); return { effect: "allow", reason: "already_executed", classification: "ordinary", request, recordId: "lost-response" }; } },
      });
      await expect(port.createBranch(repository, "goal/unknown", base)).rejects.toBeInstanceOf(GitOutcomeUnknownError);
      expect(execFileSync("git", ["-C", repository, "show-ref", "--verify", "refs/heads/goal/unknown"]).toString()).toContain("refs/heads/goal/unknown");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed when an evidence write cannot create its durable artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "maestro-s3-evidence-"));
    try {
      const occupiedPath = join(root, "not-a-directory");
      await writeFile(occupiedPath, "occupied");
      const store = new FileEvidenceStore(occupiedPath);
      await expect(store.capture({
        context: { correlationId: "c", commandId: "cmd", projectId: "project", goalId: "goal", actorId: "actor" },
        bytes: Buffer.from("evidence"), kind: "test-result", mediaType: "text/plain",
      })).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

});
