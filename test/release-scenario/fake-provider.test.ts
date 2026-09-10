import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createReleaseScenarioFixture } from "./fixture.mjs";

const execFile = promisify(execFileCallback);

async function runTargetTest(root: string): Promise<number> {
  try {
    await execFile("npm", ["test", "--prefix", root]);
    return 0;
  } catch (error) {
    return (error as { code?: number }).code ?? 1;
  }
}

describe("release scenario fake-provider harness", () => {
  it("runs the disposable defect/repair path without a provider or remote", async () => {
    const root = await mkdtemp(join(tmpdir(), "maestro-release-scenario-fake-provider-"));
    try {
      const fixture = await createReleaseScenarioFixture({ root });
      const calls: string[] = [];
      const fakeProvider = {
        async repair(target: string) {
          calls.push(target);
          await execFile("node", [join(target, "scripts", "repair-seeded-defect.mjs")]);
        },
      };

      await expect(runTargetTest(root)).resolves.toBeGreaterThan(0);
      await fakeProvider.repair(root);
      await expect(runTargetTest(root)).resolves.toBe(0);
      const pushAttempt = JSON.parse(await readFile(fixture.remotePushAttempt, "utf8")) as { networkInvoked: boolean };
      expect(calls).toEqual([root]);
      expect(pushAttempt.networkInvoked).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
