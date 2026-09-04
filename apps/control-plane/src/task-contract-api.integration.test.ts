import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyAllMigrations, bootstrapLocalOperator, grantProjectMembership } from "@maestro/persistence";
import { createControlPlane } from "./main.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const substance = (projectId: string) => ({
  desiredOutcome: "Ship the feature", userVisibleBehavior: ["Users can use it"], successCriteria: ["The check passes"], liveEvidence: ["A live request"],
  scope: ["The feature"], nonGoals: ["Unrelated work"], priorities: ["Safety"], acceptableTradeoffs: ["Slower launch"], constraints: ["Local only"], knownEdgeCases: ["Retry"],
  project: { projectId, repository: "/repo", immutableBaseRevision: "abc123", dataBoundary: "repository files only" }, evidenceReferences: ["docs/spec.md"], approvedPreviewReferences: [],
  expectedGroups: ["Product Group"], expectedDepartments: ["Product Department"], criticalActionExpectations: ["Exact confirmation"], forbiddenEffects: ["Deploy"], environmentAssumptions: ["PostgreSQL"], externalServiceAssumptions: ["None"],
  budget: { ceiling: "100 USD", reportingExpectations: ["Report spend"], stoppingConditions: ["Stop at ceiling"] },
});

describeDatabase("Task Contract control-plane API", () => {
  const schema = `task_contract_api_${randomUUID().replaceAll("-", "")}`;
  const basePool = new Pool({ connectionString: databaseUrl });
  const scopedUrl = databaseUrl === undefined ? "postgresql://127.0.0.1/maestro_test" : (() => { const url = new URL(databaseUrl); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })();
  let setupPool: Pool;

  beforeAll(async () => { await basePool.query(`CREATE SCHEMA ${schema}`); setupPool = new Pool({ connectionString: scopedUrl }); await applyAllMigrations(setupPool); });
  beforeEach(async () => { await setupPool.query("TRUNCATE task_contract_confirmations, task_contract_decisions, task_contracts, reconciler_leader_lease, local_operator_credentials, local_operators, operator_project_memberships CASCADE"); });
  afterAll(async () => { await setupPool.end(); await basePool.query(`DROP SCHEMA ${schema} CASCADE`); await basePool.end(); });

  it("drives create, amend, role selection, exact confirmation, launch, and retry through HTTP", async () => {
    const secret = `task-contract-secret-${randomUUID()}`;
    const { credentialId, operatorId } = await bootstrapLocalOperator(setupPool, { secret });
    const projectId = randomUUID();
    const contractId = randomUUID();
    await grantProjectMembership(setupPool, operatorId, projectId);
    const controlPlane = createControlPlane({ databaseUrl: scopedUrl, evidenceDir: "/tmp/maestro-evidence", host: "127.0.0.1", port: 0, primeAgentVersion: "0.8.0", actorId: "maestro-control-plane", leaseOwnerId: `task-contract-${randomUUID()}` });
    try {
      await controlPlane.listen();
      const address = controlPlane.app.server.address();
      if (address === null || typeof address === "string") throw new Error("Expected TCP listener");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const headers = { authorization: `Bearer ${credentialId}.${secret}`, "content-type": "application/json" };
      const originalSubstance = substance(projectId);
      const create = async () => fetch(`${baseUrl}/v1/task-contracts`, { method: "POST", headers: { ...headers, "idempotency-key": contractId }, body: JSON.stringify({ projectId, substance: originalSubstance }) });
      const created = await create();
      expect(created.status).toBe(201);
      const createdBody = await created.json() as { contentHash: string; version: number; launchState: string };
      expect(createdBody).toMatchObject({ version: 1, launchState: "awaiting_confirmation" });
      const retried = await create();
      expect(retried.status).toBe(201);
      expect(await retried.json()).toEqual(createdBody);

      const amendedSubstance = { ...originalSubstance, desiredOutcome: "Ship the amended feature" };
      const amended = await fetch(`${baseUrl}/v1/task-contracts/${contractId}`, { method: "PUT", headers, body: JSON.stringify({ projectId, expectedVersion: 1, substance: amendedSubstance }) });
      expect(amended.status).toBe(200);
      const amendedBody = await amended.json() as { contentHash: string; version: number; launchState: string };
      expect(amendedBody).toMatchObject({ version: 2, launchState: "awaiting_confirmation" });
      expect(amendedBody.contentHash).not.toBe(createdBody.contentHash);

      const roles = await fetch(`${baseUrl}/v1/task-contracts/${contractId}/overture-selection`, { method: "POST", headers: { ...headers, "idempotency-key": randomUUID() }, body: JSON.stringify({ projectId, outsideEvidenceRequested: true, previewNeeded: true }) });
      expect(roles.status).toBe(200);
      expect(await roles.json()).toEqual({ roles: ["conversation-lead", "architecture-analyst", "external-research-scout", "security-evaluator", "design-mock-specialist", "task-editor"] });
      const confirmed = await fetch(`${baseUrl}/v1/task-contracts/${contractId}/confirmation`, { method: "POST", headers: { ...headers, "idempotency-key": randomUUID() }, body: JSON.stringify({ projectId, version: 2, contentHash: amendedBody.contentHash }) });
      expect(confirmed.status).toBe(204);
      const launched = await fetch(`${baseUrl}/v1/task-contracts/${contractId}/launch`, { method: "POST", headers, body: JSON.stringify({ projectId }) });
      expect(launched.status).toBe(200);
      expect(await launched.json()).toMatchObject({ contractId, version: 2, launchState: "launched" });

      const goalId = randomUUID();
      const goal = await fetch(`${baseUrl}/v1/goals`, { method: "POST", headers: { ...headers, "idempotency-key": goalId }, body: JSON.stringify({ projectId, contractId }) });
      expect(goal.status).toBe(201);
      expect(await goal.json()).toMatchObject({ goalId, projectId, contractId, state: "draft", version: 1 });

      const forbiddenProject = randomUUID();
      const forbidden = await fetch(`${baseUrl}/v1/task-contracts/${contractId}?projectId=${forbiddenProject}`, { headers: { authorization: `Bearer ${credentialId}.${secret}` } });
      expect(forbidden.status).toBe(403);
    } finally { await controlPlane.close(); }
  });
});
