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
} from "./project-membership.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("project membership (Phase 1 re-patch item 8)", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  beforeAll(async () => { await applyAllMigrations(pool); });
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
});
