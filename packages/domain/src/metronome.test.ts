import { describe, expect, it } from "vitest";
import { detectDeviceCommandUnknownOutcomeFindings, detectMissingEvidenceFindings, detectMissingPlanItemFindings, detectStaleWorkerFindings } from "./metronome.js";

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

  it("flags every device command left in an unresolved (unknown) outcome state, one finding per command", () => {
    const findings = detectDeviceCommandUnknownOutcomeFindings("goal-1", 0, [
      { commandId: "cmd-1", deviceId: "device-1", grantId: "grant-1" },
      { commandId: "cmd-2", deviceId: "device-2", grantId: "grant-2" },
    ]);
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({ ruleId: "device_command_unknown_outcome", evidenceIdentity: "cmd-1", details: { deviceId: "device-1", grantId: "grant-1" } });
  });

  it("stays silent when no device command is unresolved", () => {
    expect(detectDeviceCommandUnknownOutcomeFindings("goal-1", 0, [])).toHaveLength(0);
  });
});
