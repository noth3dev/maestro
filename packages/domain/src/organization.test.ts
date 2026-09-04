import { describe, expect, it } from "vitest";
import {
  PERMANENT_DEPARTMENTS, PERMANENT_GROUPS, PERMANENT_ROLES, PHASE2_ROLE_REVIEW_VERSION,
  CONCERTMASTER_ROLE, parseRoleCapabilityBoundary, parseRoleProvenance,
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

  it("defines Concertmaster as a durable role record, not a running Goal session", () => {
    expect(CONCERTMASTER_ROLE).toMatchObject({ roleId: "concertmaster", displayName: "Concertmaster", status: "standing", activeSessionId: null, goalContext: null });
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

  it("keeps Concertmaster and oversight identities outside Departments", () => {
    expect(CONCERTMASTER_ROLE.roleKind).toBe("concertmaster");
    expect(CONCERTMASTER_ROLE.departmentId).toBeNull();

    const metronome = PERMANENT_ROLES.filter((role) => role.roleKind === "metronome");
    const council = PERMANENT_ROLES.filter((role) => role.roleKind === "encore_council");
    expect(metronome).toHaveLength(1);
    expect(council.length).toBeGreaterThanOrEqual(3);
    expect([...metronome, ...council].every((role) => role.departmentId === null)).toBe(true);
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

    const provenance = CONCERTMASTER_ROLE.provenance;
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
