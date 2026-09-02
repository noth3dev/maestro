import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { TaskContractSubstance } from "@maestro/domain";
import { ExactConfirmationRequiredError, TaskContractIntegrityError, createDurableTaskContract, launchConfirmedTaskContract, readTaskContract, recordExactTaskContractConfirmation, updateDurableTaskContract } from "./task-contract.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const substance = (): TaskContractSubstance => ({
  desiredOutcome: "A durable contract", userVisibleBehavior: ["CEO sees exact draft"], successCriteria: ["launch is bound"], liveEvidence: ["focused PostgreSQL test"],
  scope: ["contract confirmation"], nonGoals: ["agents"], priorities: ["safety"], acceptableTradeoffs: ["no UI"], constraints: ["local only"], knownEdgeCases: ["CEO edit"],
  project: { projectId: "project", repository: "repository", immutableBaseRevision: "2e8e5a5", dataBoundary: "repository files only" },
  evidenceReferences: ["plan/phase2.md"], approvedPreviewReferences: [], expectedGroups: ["Product Group"], expectedDepartments: ["Product Department"],
  criticalActionExpectations: ["exact confirmation"], forbiddenEffects: ["worker launch"], environmentAssumptions: ["PostgreSQL"], externalServiceAssumptions: ["none"],
  budget: { ceiling: "100 USD", reportingExpectations: ["launch"], stoppingConditions: ["ceiling"] },
});

describeDatabase("Task Contract exact confirmation with PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  beforeAll(async () => { await pool.query(await readFile(fileURLToPath(new URL("../migrations/0011_task_contracts.sql", import.meta.url)), "utf8")); });
  beforeEach(async () => { await pool.query("TRUNCATE task_contract_confirmations, task_contract_decisions, task_contracts CASCADE"); });
  afterAll(async () => { await pool.end(); });

  it("rejects launch without an exact confirmation and allows it after one", async () => {
    const contract = await createDurableTaskContract(pool, randomUUID(), substance());
    await expect(launchConfirmedTaskContract(pool, contract.contractId)).rejects.toBeInstanceOf(ExactConfirmationRequiredError);
    await recordExactTaskContractConfirmation(pool, contract.contractId, contract.version, contract.contentHash, "ceo");
    await expect(launchConfirmedTaskContract(pool, contract.contractId)).resolves.toMatchObject({ launchState: "launched" });
  });

  it("preserves an exact confirmation for a no-op update and treats launch retry as idempotent", async () => {
    const contract = await createDurableTaskContract(pool, randomUUID(), substance());
    await recordExactTaskContractConfirmation(pool, contract.contractId, contract.version, contract.contentHash, "operator");
    const unchanged = await updateDurableTaskContract(pool, contract.contractId, contract.version, substance());
    expect(unchanged.version).toBe(contract.version);
    await expect(launchConfirmedTaskContract(pool, contract.contractId)).resolves.toMatchObject({ launchState: "launched" });
    await expect(launchConfirmedTaskContract(pool, contract.contractId)).resolves.toMatchObject({ launchState: "launched" });
  });

  it("fails closed when raw database content or hash is tampered", async () => {
    const contract = await createDurableTaskContract(pool, randomUUID(), substance());
    await pool.query("UPDATE task_contracts SET content = jsonb_set(content, '{desiredOutcome}', '\"tampered\"') WHERE contract_id = $1", [contract.contractId]);
    await expect(readTaskContract(pool, contract.contractId)).rejects.toBeInstanceOf(TaskContractIntegrityError);
    await expect(recordExactTaskContractConfirmation(pool, contract.contractId, contract.version, contract.contentHash, "operator")).rejects.toBeInstanceOf(TaskContractIntegrityError);
    const hashTampered = await createDurableTaskContract(pool, randomUUID(), substance());
    await pool.query("UPDATE task_contracts SET content_hash = $1 WHERE contract_id = $2", ["0".repeat(64), hashTampered.contractId]);
    await expect(launchConfirmedTaskContract(pool, hashTampered.contractId)).rejects.toBeInstanceOf(TaskContractIntegrityError);
  });

  it("invalidates the old confirmation after a substantive edit until the new exact content is confirmed", async () => {
    const original = await createDurableTaskContract(pool, randomUUID(), substance());
    await recordExactTaskContractConfirmation(pool, original.contractId, original.version, original.contentHash, "ceo");
    const amended = await updateDurableTaskContract(pool, original.contractId, original.version, { ...substance(), desiredOutcome: "Amended outcome" }, { reason: "CEO edit" });
    await expect(launchConfirmedTaskContract(pool, original.contractId)).rejects.toBeInstanceOf(ExactConfirmationRequiredError);
    await recordExactTaskContractConfirmation(pool, amended.contractId, amended.version, amended.contentHash, "ceo");
    await expect(launchConfirmedTaskContract(pool, amended.contractId)).resolves.toMatchObject({ launchState: "launched" });
  });
});
