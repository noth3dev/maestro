import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createReleaseScenarioFixture } from "./fixture.mjs";

const execFile = promisify(execFileCallback);

describe("release scenario fake-provider harness", () => {
  it("runs all fourteen steps through a fake provider without a remote", async () => {
    const worktreeRoot = await mkdtemp(join(tmpdir(), "maestro-release-scenario-fake-provider-"));
    const root = join(worktreeRoot, "target");
    const state = join(worktreeRoot, "fake-state.json");
    try {
      await createReleaseScenarioFixture({ root, worktreeRoot });
      for (let step = 1; step <= 14; step += 1) {
        await execFile("node", ["test/release-scenario/run-fake-scenario.mjs", "--step", String(step), "--target", root, "--state", state], { cwd: process.cwd() });
      }
      const result = JSON.parse(await readFile(state, "utf8")) as { lastStep: number; provider: string; providerCalls: number; events: Array<{ name: string; modelIdentities?: string[]; integratedRevision?: string; modeResults?: Array<{ mode: string; status: string; networkInvoked: boolean }>; duplicateWrites?: number; bundleReportMatch?: boolean; workerStatus?: string; executionRef?: string; invocationRef?: string; workerStatusBefore?: string; workerStatusAfter?: string; sameExecution?: boolean; sameInvocation?: boolean }>; certifications: Array<{ verdict: string; revision: string | null }>; lastEvidence: { bundle: { bundleId: string; goalId: string; content: { provider: { calls: unknown[]; remoteAttempts: unknown[]; modeChanges: string[] } } }; report: { evidenceBundleId: string; goalId: string } }; processPids: number[] };
      expect(result.lastStep).toBe(14);
      expect(result.provider).toBe("fake");
      expect(result.providerCalls).toBeGreaterThan(0);
      expect(new Set(result.processPids).size).toBeGreaterThan(1);
      expect(result.events.map(({ name }) => name)).toEqual(["ceo_request", "contract_intake", "launch_confirmed", "necessary_heads", "department_plan", "native_execution", "metronome_observation", "unsupported_assertion", "quality_failed", "repair_requested_through_maestro", "quality_certified", "restart_reconciled", "ambiguous_action", "forbidden_effect", "evidence_dump"]);
      expect(result.events.find(({ name }) => name === "unsupported_assertion")?.modelIdentities).toEqual(["fake/provider-a", "fake/provider-b"]);
      expect(result.events.find(({ name }) => name === "quality_failed")).toMatchObject({ workerStatus: "awaiting_repair", executionRef: expect.any(String), invocationRef: expect.any(String) });
      expect(result.events.find(({ name }) => name === "repair_requested_through_maestro")).toMatchObject({ workerStatusBefore: "awaiting_repair", workerStatusAfter: "running", sameExecution: true, sameInvocation: true });
      const certified = result.certifications.find(({ verdict }) => verdict === "passed");
      expect(certified?.revision).toBe(result.events.find(({ name }) => name === "quality_certified")?.integratedRevision);
      expect(result.events.find(({ name }) => name === "restart_reconciled")).toMatchObject({ duplicateWrites: 0, boundary: "mid-execution", resumed: true });
      expect(result.events.find(({ name }) => name === "necessary_heads")?.activeHeads).toEqual(["engineering", "quality"]);
      expect(result.events.find(({ name }) => name === "department_plan")?.departments).toEqual(["engineering", "quality"]);
      expect(result.departmentPlans).toEqual(expect.arrayContaining([
        expect.objectContaining({ departmentId: "engineering", planVersion: 1 }),
        expect.objectContaining({ departmentId: "quality", planVersion: 1 }),
      ]));
      expect(result.events.find(({ name }) => name === "forbidden_effect")?.modeResults).toEqual([
        { mode: "retain_intermediate_approvals", status: "blocked", networkInvoked: false },
        { mode: "skip_intermediate_approvals", status: "blocked", networkInvoked: false },
      ]);
      expect(result.lastEvidence.bundle.bundleId).toBe(result.lastEvidence.report.evidenceBundleId);
      expect(result.lastEvidence.bundle.goalId).toBe(result.lastEvidence.report.goalId);
      expect(result.lastEvidence.bundle.content.provider.calls.length).toBeGreaterThan(0);
      expect(result.lastEvidence.bundle.content.provider.remoteAttempts.length).toBeGreaterThan(0);
      expect(result.lastEvidence.bundle.content.provider.inFlight.status).toBe("resumed");
      expect(result.lastEvidence.bundle.content.provider.modeChanges).toEqual(["retain_intermediate_approvals", "skip_intermediate_approvals"]);
      expect(result.lastEvidence.bundle.content.provider.capabilitySessions).toHaveLength(2);
      expect(result.lastEvidence.bundle.content.provider.remoteAttempts.every((attempt: { sessionId: string | null }) => attempt.sessionId === null || typeof attempt.sessionId === "string")).toBe(true);
    } finally {
      await rm(worktreeRoot, { recursive: true, force: true });
    }
  });
  it("rejects duplicate persisted effects during successor reconciliation", async () => {
    const worktreeRoot = await mkdtemp(join(tmpdir(), "maestro-release-scenario-duplicate-"));
    const root = join(worktreeRoot, "target");
    const state = join(worktreeRoot, "fake-state.json");
    try {
      await createReleaseScenarioFixture({ root, worktreeRoot });
      for (let step = 1; step <= 10; step += 1) await execFile("node", ["test/release-scenario/run-fake-scenario.mjs", "--step", String(step), "--target", root, "--state", state], { cwd: process.cwd() });
      const persisted = JSON.parse(await readFile(state, "utf8")) as { effects: Array<{ id: string }> };
      persisted.effects.push({ id: "repair:1" });
      await writeFile(state, JSON.stringify(persisted, null, 2) + "\n");
      await expect(execFile("node", ["test/release-scenario/run-fake-scenario.mjs", "--step", "11", "--target", root, "--state", state], { cwd: process.cwd() })).rejects.toThrow();
    } finally {
      await rm(worktreeRoot, { recursive: true, force: true });
    }
  });

});
