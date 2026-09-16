import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createBlockedScenarioReport, runScenarioBundle } from "../../scripts/run-phase8-scenarios.mjs";
import { REPRESENTATIVE_SCENARIOS, validateScenarioReport } from "./scenario-catalog.mjs";

describe("Plan 8 §S9 scenario bundle runner", () => {
  it("creates an explicit blocked report instead of claiming live acceptance", () => {
    const report = createBlockedScenarioReport();
    expect(report.status).toBe("blocked");
    expect(report.scenarios).toHaveLength(REPRESENTATIVE_SCENARIOS.length);
    expect(report.scenarios.every((scenario) => scenario.status === "blocked" && scenario.live === false)).toBe(true);
    expect(report.limitations.join(" ")).toMatch(/not.*complete|pending/i);
    expect(() => validateScenarioReport(report)).not.toThrow();
  });

  it("does not remove a lock owned by another runner on contention", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maestro-phase8-s9-lock-"));
    const reportPath = join(directory, "scenario-report.json");
    const lockPath = `${reportPath}.lock`;
    await writeFile(lockPath, "other-runner", { mode: 0o600 });
    await expect(runScenarioBundle({ reportPath })).rejects.toMatchObject({ code: "EEXIST" });
    await expect(readFile(lockPath, "utf8")).resolves.toBe("other-runner");
  });

  it("rejects a report bound to a different checkpoint", () => {
    const report = createBlockedScenarioReport();
    expect(() => validateScenarioReport({ ...report, checkpointId: "phase8-s9-other-checkpoint" })).toThrow(/checkpoint/);
  });

  it("writes the blocked report atomically with private permissions and no lock residue", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maestro-phase8-s9-"));
    const reportPath = join(directory, "scenario-report.json");
    const result = await runScenarioBundle({ reportPath });
    expect(result.exitCode).toBe(2);
    expect((await stat(reportPath)).mode & 0o777).toBe(0o600);
    expect(await readFile(reportPath, "utf8")).toContain('"status": "blocked"');
    await expect(stat(`${reportPath}.lock`)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
