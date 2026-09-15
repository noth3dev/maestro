import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EvidenceIntegrityError, FileEvidenceStore, sha256Hex } from "@maestro/evidence";

const context = {
  correlationId: "11111111-1111-4111-8111-111111111111",
  commandId: "22222222-2222-4222-8222-222222222222",
  projectId: "33333333-3333-4333-8333-333333333333",
  goalId: "44444444-4444-4444-8444-444444444444",
  actorId: "phase8-data-test",
};

describe("Plan 8 §S4 content-addressed artifact integrity", () => {
  it("rejects a corrupted artifact on every direct content read", async () => {
    const root = await mkdtemp(join(tmpdir(), "maestro-phase8-artifact-"));
    const store = new FileEvidenceStore(root);
    const bytes = Buffer.from("trusted artifact");
    const record = await store.capture({ context, bytes, kind: "test-result", mediaType: "text/plain" });

    await writeFile(join(root, "sha256", record.sha256), "tampered artifact");

    await expect(store.read(record.sha256)).rejects.toBeInstanceOf(EvidenceIntegrityError);
    expect(record.sha256).toBe(sha256Hex(bytes));
  });
});
