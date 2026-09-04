import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { applyAllMigrations } from "./test-migrations.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrapPermanentOrganization } from "./organization.js";
import { bootstrapLocalOperator } from "./auth.js";
import {
  grantProjectMembership,
  listProjectMemberships,
  ProjectMembershipRequiredError,
  revokeProjectMembership,
  assertProjectMembership,
  assertProjectRole,
  grantProjectRole,
  ProjectRoleRequiredError,
  ProjectAccessAdminRequiredError,
  ProjectAccessRoleNotFoundError,
  ProjectAccessTargetNotFoundError,
  provisionProjectAccess,
} from "./project-membership.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("project membership (Phase 1 re-patch item 8)", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  beforeAll(async () => { await applyAllMigrations(pool); await bootstrapPermanentOrganization(pool); });
  beforeEach(async () => {
    await pool.query("TRUNCATE operator_project_memberships, local_operator_credentials, local_operators CASCADE");
  });
  afterAll(async () => { await pool.end(); });

  it("fails closed for an operator with no membership at all", async () => {
    const { operatorId } = await bootstrapLocalOperator(pool, { secret: "no-membership" });
    await expect(assertProjectMembership(pool, operatorId, randomUUID())).rejects.toBeInstanceOf(ProjectMembershipRequiredError);
  });

  it("allows an operator once granted membership, and lists it", async () => {
    const { operatorId } = await bootstrapLocalOperator(pool, { secret: "granted" });
    const projectId = randomUUID();
    await grantProjectMembership(pool, operatorId, projectId);

    await expect(assertProjectMembership(pool, operatorId, projectId)).resolves.toBeUndefined();
    await expect(listProjectMemberships(pool, operatorId)).resolves.toEqual([projectId]);
    // A different project the operator was never granted is still rejected.
    await expect(assertProjectMembership(pool, operatorId, randomUUID())).rejects.toBeInstanceOf(ProjectMembershipRequiredError);
  });

  it("requires an active project role in addition to membership", async () => {
    const { operatorId } = await bootstrapLocalOperator(pool, { secret: "role-bound" });
    const projectId = randomUUID();
    await grantProjectMembership(pool, operatorId, projectId);

    await expect(assertProjectRole(pool, operatorId, projectId, "engineering")).rejects.toBeInstanceOf(ProjectRoleRequiredError);
    await grantProjectRole(pool, operatorId, projectId, "engineering");
    await expect(assertProjectRole(pool, operatorId, projectId, "engineering")).resolves.toBeUndefined();
    await expect(assertProjectRole(pool, operatorId, projectId, "security")).rejects.toBeInstanceOf(ProjectRoleRequiredError);
  });

  it("granting an already-active membership again is an idempotent no-op", async () => {
    const { operatorId } = await bootstrapLocalOperator(pool, { secret: "idempotent-grant" });
    const projectId = randomUUID();
    await grantProjectMembership(pool, operatorId, projectId);
    await grantProjectMembership(pool, operatorId, projectId);
    await expect(listProjectMemberships(pool, operatorId)).resolves.toEqual([projectId]);
  });

  it("revokes membership one-way; a revoked membership rejects and cannot be reactivated", async () => {
    const { operatorId } = await bootstrapLocalOperator(pool, { secret: "revoked" });
    const projectId = randomUUID();
    await grantProjectMembership(pool, operatorId, projectId);
    await revokeProjectMembership(pool, operatorId, projectId);

    await expect(assertProjectMembership(pool, operatorId, projectId)).rejects.toBeInstanceOf(ProjectMembershipRequiredError);
    await expect(
      pool.query("UPDATE operator_project_memberships SET active = true, revoked_at = NULL WHERE operator_id = $1 AND project_id = $2", [operatorId, projectId]),
    ).rejects.toThrow(/cannot be reactivated/);

    // Revoking an already-revoked membership is a safe no-op (no error, no state change).
    await revokeProjectMembership(pool, operatorId, projectId);
    await expect(assertProjectMembership(pool, operatorId, projectId)).rejects.toBeInstanceOf(ProjectMembershipRequiredError);
  });

  it("revoking a nonexistent membership is a safe no-op", async () => {
    const { operatorId } = await bootstrapLocalOperator(pool, { secret: "no-op-revoke" });
    await expect(revokeProjectMembership(pool, operatorId, randomUUID())).resolves.toBeUndefined();
  });

  it("regranting after a revoke creates a genuinely new membership", async () => {
    const { operatorId } = await bootstrapLocalOperator(pool, { secret: "regrant" });
    const projectId = randomUUID();
    await grantProjectMembership(pool, operatorId, projectId);
    await revokeProjectMembership(pool, operatorId, projectId);
    await grantProjectMembership(pool, operatorId, projectId);

    await expect(assertProjectMembership(pool, operatorId, projectId)).resolves.toBeUndefined();
  });


  it("atomically provisions an active operator with exact standing roles", async () => {
    const { operatorId: adminOperatorId } = await bootstrapLocalOperator(pool, { secret: "provision-admin" });
    const { operatorId: targetOperatorId } = await bootstrapLocalOperator(pool, { secret: "provision-target" });
    const projectId = randomUUID();
    const result = await provisionProjectAccess(pool, adminOperatorId, { operatorId: targetOperatorId, projectId, roles: ["concertmaster", "head-product"] }, { adminOperatorId });

    expect(result).toEqual({ operatorId: targetOperatorId, projectId, roles: ["concertmaster", "head-product"] });
    await expect(assertProjectMembership(pool, targetOperatorId, projectId)).resolves.toBeUndefined();
    const roles = await pool.query<{ role_id: string }>("SELECT role_id FROM operator_project_roles WHERE operator_id = $1 AND project_id = $2 AND active = true ORDER BY role_id", [targetOperatorId, projectId]);
    expect(roles.rows.map((row) => row.role_id)).toEqual(["concertmaster", "head-product"]);
  });

  it("rejects non-admin callers before writing any access rows", async () => {
    const { operatorId: callerOperatorId } = await bootstrapLocalOperator(pool, { secret: "provision-caller" });
    const { operatorId: targetOperatorId } = await bootstrapLocalOperator(pool, { secret: "provision-target-2" });
    const projectId = randomUUID();
    await expect(provisionProjectAccess(pool, callerOperatorId, { operatorId: targetOperatorId, projectId, roles: ["concertmaster"] }, { adminOperatorId: randomUUID() })).rejects.toBeInstanceOf(ProjectAccessAdminRequiredError);
    await expect(assertProjectMembership(pool, targetOperatorId, projectId)).rejects.toBeInstanceOf(ProjectMembershipRequiredError);
  });

  it("rejects an unknown role and rolls back membership plus all roles", async () => {
    const { operatorId: adminOperatorId } = await bootstrapLocalOperator(pool, { secret: "provision-admin-2" });
    const { operatorId: targetOperatorId } = await bootstrapLocalOperator(pool, { secret: "provision-target-3" });
    const projectId = randomUUID();
    await expect(provisionProjectAccess(pool, adminOperatorId, { operatorId: targetOperatorId, projectId, roles: ["concertmaster", "not-a-permanent-role"] }, { adminOperatorId })).rejects.toBeInstanceOf(ProjectAccessRoleNotFoundError);
    await expect(assertProjectMembership(pool, targetOperatorId, projectId)).rejects.toBeInstanceOf(ProjectMembershipRequiredError);
    const grants = await pool.query("SELECT 1 FROM operator_project_roles WHERE operator_id = $1 AND project_id = $2", [targetOperatorId, projectId]);
    expect(grants.rowCount).toBe(0);
  });

  it("rejects an inactive target operator", async () => {
    const { operatorId: adminOperatorId } = await bootstrapLocalOperator(pool, { secret: "provision-admin-3" });
    const { operatorId: targetOperatorId } = await bootstrapLocalOperator(pool, { secret: "provision-target-4" });
    await pool.query("UPDATE local_operators SET active = false WHERE operator_id = $1", [targetOperatorId]);
    await expect(provisionProjectAccess(pool, adminOperatorId, { operatorId: targetOperatorId, projectId: randomUUID(), roles: ["concertmaster"] }, { adminOperatorId })).rejects.toBeInstanceOf(ProjectAccessTargetNotFoundError);
  });

});
