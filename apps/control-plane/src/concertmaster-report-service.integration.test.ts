import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConcertmasterFinalReport } from "@maestro/contracts";
import { applyAllMigrations, bootstrapLocalOperator, type GoalLeaseProof } from "@maestro/persistence";

const { mockGenerate } = vi.hoisted(() => ({ mockGenerate: vi.fn() }));
vi.mock("@maestro/persistence", async (importOriginal) => ({ ...await importOriginal<typeof import("@maestro/persistence")>(), generateConcertmasterFinalReport: mockGenerate }));
import { grantProjectMembership, grantProjectRole } from "@maestro/persistence/testing";
import { createConcertmasterReportService } from "./concertmaster-report-service.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const report = (goalId: string): ConcertmasterFinalReport => ({
  reportId: randomUUID(), goalId, success: true, blockers: [], ceoRequest: "repair",
  whatChanged: "fixed", userVisibleBehaviorPassed: true, participatingDepartments: ["quality"],
  keyDecisions: [], dissent: [], independentValidation: ["quality: passed"], costCents: 0,
  budgetCents: 1, incidents: [], knownLimitations: [], criticalActionAwaitingApproval: false,
  evidenceBundleId: randomUUID(),
});

describeDatabase("Concertmaster report command idempotency", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  beforeAll(async () => { await applyAllMigrations(pool); });
  beforeEach(async () => {
    await pool.query("TRUNCATE command_receipts, goals, goal_controls, operator_project_roles, operator_project_memberships, local_operator_credentials, local_operators CASCADE");
  });
  afterAll(async () => { await pool.end(); });

  it("records and replays the exact report command, rejecting changed reuse", async () => {
    const projectId = randomUUID();
    const goalId = randomUUID();
    const commandId = randomUUID();
    const { operatorId } = await bootstrapLocalOperator(pool, { secret: "report-command-secret" });
    await grantProjectMembership(pool, operatorId, projectId);
    await grantProjectRole(pool, operatorId, projectId, "concertmaster");
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
    const generated = report(goalId);
    mockGenerate.mockResolvedValue(generated);
    const withGoalLease = async <T>(_id: string, operation: (proof: GoalLeaseProof) => Promise<T>): Promise<T> => operation({ goalId, ownerId: "report-test", fencingToken: "1" });
    const service = createConcertmasterReportService({ pool, withGoalLease });

    const first = await service.generate(goalId, projectId, commandId, { operatorId, credentialId: randomUUID() });
    const replay = await service.generate(goalId, projectId, commandId, { operatorId, credentialId: randomUUID() });
    expect(replay).toEqual(first);
    expect((await pool.query("SELECT command_id, outcome, result FROM command_receipts WHERE command_id = $1", [commandId])).rows).toHaveLength(1);
    const otherProjectId = randomUUID();
    await grantProjectMembership(pool, operatorId, otherProjectId);
    await grantProjectRole(pool, operatorId, otherProjectId, "concertmaster");
    await expect(service.generate(goalId, otherProjectId, commandId, { operatorId, credentialId: randomUUID() })).rejects.toThrow(/reused|mismatch/i);
  });
});
