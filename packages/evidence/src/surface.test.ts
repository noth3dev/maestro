import { describe, expect, it } from "vitest";

describe("evidence surface", () => {
  it("pins the barrel export list", async () => {
    const surface = await import("./index.js");
    expect(Object.keys(surface).sort()).toMatchInlineSnapshot(`
      [
        "EvidenceIntegrityError",
        "FileEvidenceStore",
        "sha256Hex",
        "verifyEvidenceRecord",
      ]
    `);
  });
});
