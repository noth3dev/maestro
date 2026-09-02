import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PERMANENT_ROLES, PERSONA_AXES } from "@maestro/domain";
import { bootstrapPermanentOrganization, getPermanentRole, listPermanentRoles } from "./organization.js";

describe("permanent role persistence", () => {
  it("bootstraps every reviewed role and all ten baseline axes", async () => {
    const queries: Array<{ text: string; values: readonly unknown[] | undefined }> = [];
    const client = {
      query: async (text: string, values?: readonly unknown[]) => {
        queries.push({ text, values });
        return { rowCount: 0, rows: [] };
      },
      release: () => undefined,
    };
    const pool = { connect: async () => client } as never;

    await bootstrapPermanentOrganization(pool);

    const roleInserts = queries.filter(({ text }) => text.includes("INSERT INTO permanent_roles"));
    expect(roleInserts).toHaveLength(PERMANENT_ROLES.length);
    expect(new Set(roleInserts.map(({ values }) => values?.[0]))).toEqual(
      new Set(PERMANENT_ROLES.map((role) => role.roleId)),
    );

    const axisInserts = queries.filter(({ text }) => text.includes("INSERT INTO role_persona_axes"));
    expect(axisInserts).toHaveLength(PERMANENT_ROLES.length * 10);
  });

  it("hydrates a role with its immutable Department mapping and reviewed metadata", async () => {
    const expected = PERMANENT_ROLES.find((role) => role.roleKind === "department_head")!;
    const pool = {
      query: async (text: string) => {
        if (text.includes("FROM permanent_roles")) {
          return {
            rowCount: 1,
            rows: [{
              role_id: expected.roleId, display_name: expected.displayName, status: expected.status,
              role_kind: expected.roleKind, department_id: expected.departmentId, role_charter: expected.charter,
              capability_boundary: expected.capabilityBoundary, provenance: expected.provenance,
            }],
          };
        }
        return {
          rowCount: PERSONA_AXES.length,
          rows: PERSONA_AXES.map((axis) => ({ axis, value: String(expected.persona[axis]) })),
        };
      },
    } as never;

    const hydrated = await getPermanentRole(pool, expected.roleId);
    expect(hydrated).toEqual(expected);
    expect(Object.isFrozen(hydrated)).toBe(true);
    expect(() => {
      (hydrated as unknown as { departmentId: string | null }).departmentId = null;
    }).toThrow();
  });

  it("lists durable roles with each complete persona and identity boundary", async () => {
    const expected = [
      PERMANENT_ROLES[0]!,
      PERMANENT_ROLES.find((role) => role.roleKind === "sentinel")!,
    ];
    const pool = {
      query: async (text: string, values?: readonly unknown[]) => {
        if (text.includes("FROM permanent_roles")) {
          return {
            rowCount: expected.length,
            rows: expected.map((role) => ({
              role_id: role.roleId, display_name: role.displayName, status: role.status, role_kind: role.roleKind,
              department_id: role.departmentId, role_charter: role.charter, capability_boundary: role.capabilityBoundary,
              provenance: role.provenance,
            })),
          };
        }
        const role = expected.find((candidate) => candidate.roleId === values?.[0]);
        return {
          rowCount: PERSONA_AXES.length,
          rows: PERSONA_AXES.map((axis) => ({ axis, value: String(role!.persona[axis]) })),
        };
      },
    } as never;

    await expect(listPermanentRoles(pool)).resolves.toEqual(expected);
  });
});

it("publishes a durable composite role-department key for later Head references", async () => {
  const migration = await readFile(fileURLToPath(new URL("../migrations/0018_role_identity_hardening.sql", import.meta.url)), "utf8");

  expect(migration).toContain("UNIQUE (role_id, department_id)");
  expect(migration).toContain("role_kind text");
  expect(migration).toContain("role_charter text");
  expect(migration).toContain("capability_boundary jsonb");
  expect(migration).toContain("provenance jsonb");
  expect(migration).toContain("permanent_role_department_immutable");
  expect(migration).toContain("permanent_role_identity_immutable");
  expect(migration).toContain("role_kind = 'department_head'");
});
