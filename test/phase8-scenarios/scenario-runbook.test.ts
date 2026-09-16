import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REQUIRED_SCENARIO_IDS } from "./scenario-catalog.mjs";

const runbook = readFileSync(join(process.cwd(), "docs/operations/12-representative-scenarios.md"), "utf8");

describe("Plan 8 §S9 scenario runbook", () => {
  it("lists every canonical scenario and keeps the live gate explicit", () => {
    expect(runbook).toContain("node scripts/run-phase8-scenarios.mjs");
    expect(runbook).toContain("Blocked: inventory and report contract only");
    expect(runbook).toContain("does **not** close §S9 or G7");
    for (const scenarioId of REQUIRED_SCENARIO_IDS) expect(runbook).toContain(`\`${scenarioId}\``);
  });
});
