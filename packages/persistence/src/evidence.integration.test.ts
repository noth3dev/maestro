import { randomUUID } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EvidenceIntegrityError, FileEvidenceStore } from "@maestro/evidence";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { appendEvidenceMetadata, getEvidenceMetadata } from "./evidence.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const context = () => ({ correlationId: randomUUID(), commandId: randomUUID(), projectId: randomUUID(), goalId: randomUUID(), actorId: "operator" });

async function captureAndAppend(pool: Pool): Promise<{ record: Awaited<ReturnType<typeof appendEvidenceMetadata>>; store: FileEvidenceStore }> {
  const store = new FileEvidenceStore(await mkdtemp(join(tmpdir(), "maestro-evidence-")));
  const captured = await store.capture({ context: context(), bytes: Buffer.from("durable evidence"), kind: "test-result", mediaType: "text/plain" });
  return { store, record: await appendEvidenceMetadata(pool, captured) };
}

describeDatabase("durable evidence metadata", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  beforeAll(async () => {
    const migration = await readFile(fileURLToPath(new URL("../migrations/0006_evidence.sql", import.meta.url)), "utf8");
    await pool.query(migration);
  });
  beforeEach(async () => { await pool.query("TRUNCATE evidence_records"); });
  afterAll(async () => { await pool.end(); });

  it("reads valid captured evidence through the verified retrieval API", async () => {
    const { record, store } = await captureAndAppend(pool);
    await expect(getEvidenceMetadata(pool, record.evidenceId, store)).resolves.toEqual(record);
  });

  it("rejects a durable metadata hash corrupted through raw SQL", async () => {
    const { record, store } = await captureAndAppend(pool);
    await pool.query("ALTER TABLE evidence_records DISABLE TRIGGER evidence_records_immutable");
    try {
      await pool.query("UPDATE evidence_records SET sha256 = $1 WHERE evidence_id = $2", ["b".repeat(64), record.evidenceId]);
    } finally {
      await pool.query("ALTER TABLE evidence_records ENABLE TRIGGER evidence_records_immutable");
    }

    await expect(getEvidenceMetadata(pool, record.evidenceId, store)).rejects.toBeInstanceOf(EvidenceIntegrityError);
  });

  it("database guards forbid evidence metadata rewrites and deletion", async () => {
    const { record } = await captureAndAppend(pool);
    await expect(pool.query("UPDATE evidence_records SET kind = 'rewritten' WHERE evidence_id = $1", [record.evidenceId])).rejects.toThrow(/immutable/);
    await expect(pool.query("DELETE FROM evidence_records WHERE evidence_id = $1", [record.evidenceId])).rejects.toThrow(/immutable/);
  });

  it("rejects malformed hashes before database insertion", async () => {
    await expect(appendEvidenceMetadata(pool, { evidenceId: randomUUID(), context: context(), sha256: "invalid", byteLength: 1, kind: "test-result", mediaType: "text/plain", retention: "project_lifetime" })).rejects.toThrow("SHA-256");
  });
});
