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
    expect(runbook).toContain("goal create --project-id \"$PROJECT_ID\" --contract-id \"$CONTRACT_ID\"");
    expect(runbook).not.toContain("certification.out || true");
    expect(runbook).toContain('export MAESTRO_API_URL="http://127.0.0.1:$MAESTRO_PORT"');
    expect(runbook).toContain("attempt-remote-push.mjs");
    expect(runbook).toContain("git goal-branch");
    expect(runbook).toContain("git department-branch");
    const inputWriter = await readFile(new URL("./write-input.mjs", import.meta.url), "utf8");
    expect(inputWriter).toContain("contractId: parsed.values.contract");
  });
});
