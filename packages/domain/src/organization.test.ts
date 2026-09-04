import { describe, expect, it } from "vitest";
import {
  PERMANENT_DEPARTMENTS, PERMANENT_GROUPS, PERMANENT_ROLES, PHASE2_ROLE_REVIEW_VERSION,
  SANE_ROLE, parseRoleCapabilityBoundary, parseRoleProvenance,
} from "./organization.js";
import { parsePersonaProfile } from "./persona.js";

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


describe("durable role catalog", () => {
  it("defines one reviewed Department Head for every permanent Department", () => {
    const heads = PERMANENT_ROLES.filter((role) => role.roleKind === "department_head");

    expect(heads).toHaveLength(PERMANENT_DEPARTMENTS.length);
    expect(heads.map((role) => role.departmentId).sort()).toEqual(
      PERMANENT_DEPARTMENTS.map((department) => department.departmentId).sort(),
    );
    expect(heads.every((role) => role.departmentId !== null)).toBe(true);
  });

  it("keeps Sane and oversight identities outside Departments", () => {
    expect(SANE_ROLE.roleKind).toBe("sane");
    expect(SANE_ROLE.departmentId).toBeNull();

    const sentinel = PERMANENT_ROLES.filter((role) => role.roleKind === "sentinel");
    const council = PERMANENT_ROLES.filter((role) => role.roleKind === "encore_council");
    expect(sentinel).toHaveLength(1);
    expect(council.length).toBeGreaterThanOrEqual(3);
    expect([...sentinel, ...council].every((role) => role.departmentId === null)).toBe(true);
  });

  it("gives every standing role a reviewed charter, capability boundary, provenance, and normalized baseline", () => {
    expect(PERMANENT_ROLES.every((role) => role.status === "standing")).toBe(true);
    for (const role of PERMANENT_ROLES) {
      expect(role.charter.trim()).not.toBe("");
      expect(role.capabilityBoundary.allowed.length).toBeGreaterThan(0);
      expect(role.capabilityBoundary.forbidden.length).toBeGreaterThan(0);
      expect(role.provenance.source).toContain("plan/phase2.md");
      expect(role.provenance.reviewVersion).toBe(PHASE2_ROLE_REVIEW_VERSION);
      expect(parsePersonaProfile(role.persona)).toEqual(role.persona);
    }
  });

  it("validates capability and provenance metadata as strict durable shapes", () => {
    expect(parseRoleCapabilityBoundary({ allowed: ["inspect"], forbidden: ["mutate"] })).toEqual({
      allowed: ["inspect"], forbidden: ["mutate"],
    });
    expect(() => parseRoleCapabilityBoundary({ allowed: [], forbidden: ["mutate"], extra: true })).toThrow();

    const provenance = SANE_ROLE.provenance;
    expect(parseRoleProvenance(provenance)).toEqual(provenance);
    expect(() => parseRoleProvenance({ ...provenance, reviewVersion: "" })).toThrow();
  });

  it("deep-freezes the catalog so a role-to-department mapping cannot change in memory", () => {
    const head = PERMANENT_ROLES.find((role) => role.roleKind === "department_head");
    expect(head).toBeDefined();
    expect(Object.isFrozen(head)).toBe(true);
    expect(() => {
      (head as { departmentId: string | null }).departmentId = null;
    }).toThrow();
  });
});
