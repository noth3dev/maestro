import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const runbook = readFileSync(join(process.cwd(), "docs/operations/11-soak.md"), "utf8");

describe("Plan 8 §S8 soak runbook", () => {
  it("records the runnable report command and the fixture-only boundary", () => {
    expect(runbook).toContain("node scripts/run-soak.mjs");
    expect(runbook).toContain("Evidence:");
    expect(runbook).toContain("Status: **fixture evidence only**");
    expect(runbook).toContain("live=false");
    expect(runbook).toContain("Do not mark §S8 complete from the disposable fixture");
  });
});
