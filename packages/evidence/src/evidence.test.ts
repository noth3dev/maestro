import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EvidenceIntegrityError, FileEvidenceStore, sha256Hex } from "./index.js";

const context = {
  correlationId: "11111111-1111-4111-8111-111111111111",
  commandId: "22222222-2222-4222-8222-222222222222",
  projectId: "33333333-3333-4333-8333-333333333333",
  goalId: "44444444-4444-4444-8444-444444444444",
  actorId: "local-operator",
};

describe("FileEvidenceStore", () => {
  it("stores bytes by SHA-256 and returns immutable, project-scoped metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "maestro-evidence-"));
    const store = new FileEvidenceStore(root);
    const bytes = Buffer.from("test evidence");

    const record = await store.capture({ context, bytes, kind: "test-result", mediaType: "text/plain" });

    expect(record.sha256).toBe(sha256Hex(bytes));
    expect(record.context).toEqual(context);
    expect(record.byteLength).toBe(bytes.length);
    expect(await readFile(join(root, "sha256", record.sha256))).toEqual(bytes);
    await expect(store.capture({ context, bytes, kind: "test-result", mediaType: "text/plain" })).resolves.toMatchObject({ sha256: record.sha256 });
  });

  it("rejects a pre-existing artifact whose bytes do not match its address", async () => {
    const root = await mkdtemp(join(tmpdir(), "maestro-evidence-"));
    const store = new FileEvidenceStore(root);
    const bytes = Buffer.from("trusted");
    const hash = sha256Hex(bytes);
    await store.capture({ context, bytes, kind: "test-result", mediaType: "text/plain" });
    await writeFile(join(root, "sha256", hash), "tampered");

    await expect(store.capture({ context, bytes, kind: "test-result", mediaType: "text/plain" })).rejects.toBeInstanceOf(EvidenceIntegrityError);
  });

  it("rejects traversal and invalid evidence metadata before it writes", async () => {
    const root = await mkdtemp(join(tmpdir(), "maestro-evidence-"));
    const store = new FileEvidenceStore(root);
    await expect(store.capture({ context, bytes: Buffer.from("x"), kind: "../escape", mediaType: "text/plain" })).rejects.toThrow("kind");
  });
});
