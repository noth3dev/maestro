import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
      const result = JSON.parse(await readFile(state, "utf8")) as { lastStep: number; provider: string; events: Array<{ name: string }> };
      expect(result.lastStep).toBe(14);
      expect(result.provider).toBe("fake");
      expect(result.events.map(({ name }) => name)).toEqual(["ceo_request", "contract_intake", "launch_confirmed", "necessary_heads", "department_plan", "native_execution", "metronome_observation", "unsupported_assertion", "quality_failed", "quality_certified", "restart_reconciled", "ambiguous_action", "forbidden_effect", "evidence_dump"]);
    } finally {
      await rm(worktreeRoot, { recursive: true, force: true });
    }
  });
});
