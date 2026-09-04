import { describe, expect, it } from "vitest";
import { detectMissingEvidenceFindings, detectMissingPlanItemFindings, detectStaleWorkerFindings } from "./metronome.js";

describe("Metronome deterministic rule catalog", () => {
  it("flags a worker spawned against a superseded plan version and stays silent on the current version", () => {
    const currentVersions = new Map([["product", 2]]);
    const workers = [
      { workerId: "w1", departmentId: "product", planVersion: 1, itemId: "item-1" },
      { workerId: "w2", departmentId: "product", planVersion: 2, itemId: "item-1" },
    ];
    const findings = detectStaleWorkerFindings("goal-1", currentVersions, workers);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.evidenceIdentity).toBe("w1");
    expect(findings[0]!.ruleId).toBe("stale_worker_superseded_plan");
  });

  it("flags a worker whose item was removed from the current plan version and stays silent on a valid item", () => {
    const currentItems = new Map([["product", { version: 1, itemIds: new Set(["item-1"]) }]]);
    const workers = [
      { workerId: "w1", departmentId: "product", planVersion: 1, itemId: "item-removed" },
      { workerId: "w2", departmentId: "product", planVersion: 1, itemId: "item-1" },
    ];
    const findings = detectMissingPlanItemFindings("goal-1", currentItems, workers);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.evidenceIdentity).toBe("w1");
  });

  it("does not flag a stale worker's item against a plan version other than the current one", () => {
    const currentItems = new Map([["product", { version: 2, itemIds: new Set(["item-2"]) }]]);
    const workers = [{ workerId: "w1", departmentId: "product", planVersion: 1, itemId: "item-1" }];
    expect(detectMissingPlanItemFindings("goal-1", currentItems, workers)).toHaveLength(0);
  });

  it("flags a referenced evidence id that is not durable and stays silent on a real one, deduplicating repeats", () => {
    const durable = new Set(["real-evidence"]);
    const findings = detectMissingEvidenceFindings("goal-1", 1, ["real-evidence", "fake-evidence", "fake-evidence", ""], durable);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.evidenceIdentity).toBe("fake-evidence");
  });
});
