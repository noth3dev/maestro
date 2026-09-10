import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("release scenario runbook", () => {
  it("enumerates all fourteen live steps and their observables", async () => {
    const runbook = await readFile(new URL("./RUNBOOK.md", import.meta.url), "utf8");
    const checklist = await readFile(new URL("./CHECKLIST.md", import.meta.url), "utf8");
    for (let step = 1; step <= 14; step += 1) {
      expect(runbook).toContain(`## Step ${step}`);
      expect(checklist).toContain(`- [ ] ${step}.`);
      expect(runbook).toContain(`run-fake-scenario.mjs" --step ${step}`);
      expect(runbook).toContain(`Observable:`);
    }
    expect(runbook).toContain("evidence dump");
    expect(runbook).toContain("Do not run live provider acceptance");
  });
});
