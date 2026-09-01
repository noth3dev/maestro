import { describe, expect, it } from "vitest";
import { canonicalHeadRoleId, markHeadParticipationActive, sleepHeadParticipation, type GoalHeadParticipation } from "./head-participation.js";

const starting: GoalHeadParticipation = { goalId: "goal", departmentId: "product", headRoleId: "head:product", contractId: null, contextId: null, status: "starting", activeSessionRef: null };
describe("canonical HeadRoleId identity", () => {
  it("derives the stable role key from the Department identity", () => {
    expect(canonicalHeadRoleId("product")).toBe("head:product");
    expect(() => canonicalHeadRoleId("")).toThrow("department");
  });
});

describe("Goal-scoped Head participation", () => {
  it("has a separate lifecycle and clears its opaque reference when sleeping", () => {
    const active = markHeadParticipationActive(starting, "session:opaque-id");
    expect(active).toMatchObject({ status: "active", activeSessionRef: "session:opaque-id" });
    expect(sleepHeadParticipation(active)).toMatchObject({ status: "sleeping", activeSessionRef: null });
  });
  it("does not permit activation without a starting reservation", () => {
    expect(() => markHeadParticipationActive({ ...starting, status: "sleeping" }, "x")).toThrow("starting");
  });
});
