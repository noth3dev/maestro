import { describe, expect, it } from "vitest";
import { PERMANENT_DEPARTMENTS, PERMANENT_GROUPS, SANE_ROLE } from "./organization.js";

describe("permanent organization taxonomy", () => {
  it("contains the planned groups and departments, all sleeping without a Goal session", () => {
    expect(PERMANENT_GROUPS.map((group) => group.displayName)).toEqual([
      "Product Group", "Tech Group", "Intelligence Group", "Assurance Group", "Operations Group",
    ]);
    expect(PERMANENT_DEPARTMENTS).toHaveLength(10);
    expect(PERMANENT_DEPARTMENTS.every((department) => department.status === "sleeping" && department.activeSessionId === null && department.goalContext === null)).toBe(true);
  });

  it("defines Sane as a durable role record, not a running Goal session", () => {
    expect(SANE_ROLE).toMatchObject({ roleId: "sane", displayName: "Sane", status: "standing", activeSessionId: null, goalContext: null });
  });
});
