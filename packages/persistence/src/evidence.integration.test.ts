import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { appendEvidenceMetadata, getEvidenceMetadata } from "./evidence.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const context = () => ({ correlationId: randomUUID(), commandId: randomUUID(), projectId: randomUUID(), goalId: randomUUID(), actorId: "operator" });
const hash = "a".repeat(64);

describeDatabase("durable evidence metadata", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  beforeAll(async () => {
    const migration = await readFile(fileURLToPath(new URL("../migrations/0006_evidence.sql", import.meta.url)), "utf8");
    await pool.query(migration);
  });
  beforeEach(async () => { await pool.query("TRUNCATE evidence_records"); });
  afterAll(async () => { await pool.end(); });

  it("appends project-and-goal-scoped SHA-256 metadata and reads it back unchanged", async () => {
    const record = await appendEvidenceMetadata(pool, { evidenceId: randomUUID(), context: context(), sha256: hash, byteLength: 12, kind: "test-result", mediaType: "text/plain", retention: "project_lifetime" });
    await expect(getEvidenceMetadata(pool, record.evidenceId)).resolves.toEqual(record);
  });

  it("database guards forbid evidence metadata rewrites and deletion", async () => {
    const record = await appendEvidenceMetadata(pool, { evidenceId: randomUUID(), context: context(), sha256: hash, byteLength: 12, kind: "test-result", mediaType: "text/plain", retention: "project_lifetime" });
    await expect(pool.query("UPDATE evidence_records SET kind = 'rewritten' WHERE evidence_id = $1", [record.evidenceId])).rejects.toThrow(/immutable/);
    await expect(pool.query("DELETE FROM evidence_records WHERE evidence_id = $1", [record.evidenceId])).rejects.toThrow(/immutable/);
  });

  it("rejects malformed hashes before database insertion", async () => {
    await expect(appendEvidenceMetadata(pool, { evidenceId: randomUUID(), context: context(), sha256: "invalid", byteLength: 1, kind: "test-result", mediaType: "text/plain", retention: "project_lifetime" })).rejects.toThrow("SHA-256");
  });
});
