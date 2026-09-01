import { describe, expect, it } from "vitest";
import {
  assertValidDepartmentPlanItem,
  assertValidDepartmentPlanSubstance,
  decisionPacketContentHash,
  departmentPlanSubstanceContentHash,
  InvalidDepartmentPlanError,
  type DepartmentPlanSubstance,
} from "./department-plan.js";
import type { DecisionPacket } from "./council.js";

interface TestPlanItem {
  itemId: string; kind: "scout" | "execution"; objective: string; dependsOn: readonly string[];
  scoutQuestion: string; workerAssignment: string; evidenceReferences: readonly string[];
}
const item = (overrides: Partial<TestPlanItem> = {}): TestPlanItem => ({
  itemId: "item-1", kind: "scout", objective: "gather evidence", dependsOn: [], scoutQuestion: "what changed?", workerAssignment: "", evidenceReferences: [],
  ...overrides,
});

const substance = (overrides: Partial<DepartmentPlanSubstance> = {}): DepartmentPlanSubstance => ({
  contribution: "own the API slice", nonGoals: ["UI"], items: [item()], requiredHandoffs: [],
  budgetCeiling: "50 USD", expectedTime: "2 days", maxRetries: 2, maxWorkers: 1,
  gitRepository: "repo", gitBranch: "phase2/dept-x", integrationPath: "packages/x",
  risks: ["scope creep"], safePausePoints: ["after scout"], escalationTriggers: ["budget exceeded"],
  evidenceReferences: [], validationCriteria: ["tests pass"],
  ...overrides,
});

describe("Department Plan", () => {
  it("accepts a valid substance and hashes it canonically regardless of key order", () => {
    const value = substance();
    expect(() => assertValidDepartmentPlanSubstance(value)).not.toThrow();
    const reordered = { ...value, contribution: value.contribution };
    expect(departmentPlanSubstanceContentHash(value)).toBe(departmentPlanSubstanceContentHash(reordered));
  });

  it("rejects an unknown field", () => {
    expect(() => assertValidDepartmentPlanSubstance({ ...substance(), extra: "nope" })).toThrow(InvalidDepartmentPlanError);
  });

  it("rejects a blank contribution", () => {
    expect(() => assertValidDepartmentPlanSubstance(substance({ contribution: "" }))).toThrow(InvalidDepartmentPlanError);
  });

  it("rejects empty items", () => {
    expect(() => assertValidDepartmentPlanSubstance(substance({ items: [] }))).toThrow(InvalidDepartmentPlanError);
  });

  it("rejects a duplicate item id", () => {
    expect(() => assertValidDepartmentPlanSubstance(substance({ items: [item(), item()] }))).toThrow(InvalidDepartmentPlanError);
  });

  it("rejects a dependency on an unknown item", () => {
    expect(() => assertValidDepartmentPlanSubstance(substance({ items: [item({ dependsOn: ["missing"] })] }))).toThrow(InvalidDepartmentPlanError);
  });

  it("rejects a dependency cycle", () => {
    const a = item({ itemId: "a", dependsOn: ["b"] });
    const b = item({ itemId: "b", dependsOn: ["a"] });
    expect(() => assertValidDepartmentPlanSubstance(substance({ items: [a, b] }))).toThrow(InvalidDepartmentPlanError);
  });

  it("rejects a scout item without a scout question", () => {
    expect(() => assertValidDepartmentPlanSubstance(substance({ items: [item({ scoutQuestion: "" })] }))).toThrow(InvalidDepartmentPlanError);
  });

  it("rejects an execution item without a worker assignment", () => {
    expect(() => assertValidDepartmentPlanSubstance(substance({ items: [item({ kind: "execution", scoutQuestion: "", workerAssignment: "" })] }))).toThrow(InvalidDepartmentPlanError);
  });

  it("accepts a valid execution item", () => {
    expect(() => assertValidDepartmentPlanSubstance(substance({ items: [item({ kind: "execution", scoutQuestion: "", workerAssignment: "implement X" })] }))).not.toThrow();
  });

  it("rejects negative or non-integer ceilings", () => {
    expect(() => assertValidDepartmentPlanSubstance(substance({ maxRetries: -1 }))).toThrow(InvalidDepartmentPlanError);
    expect(() => assertValidDepartmentPlanSubstance(substance({ maxWorkers: 1.5 }))).toThrow(InvalidDepartmentPlanError);
  });

  it("hashes a decision packet canonically", () => {
    const packet: DecisionPacket = {
      outcome: "decided", executionDisposition: "executable", selectedDirection: "proceed",
      rejectedAlternatives: [], departmentOwnership: [], workerPlan: [], completionCriteria: ["done"],
      failureCriteria: ["fail"], dissent: [], uncertainty: [], criticalActions: [], unresolvedConflicts: [], evidenceReferences: [],
    };
    expect(decisionPacketContentHash(packet)).toBe(decisionPacketContentHash({ ...packet }));
    expect(/^[0-9a-f]{64}$/.test(decisionPacketContentHash(packet))).toBe(true);
  });
});
