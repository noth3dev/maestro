import { describe, expect, it } from "vitest";

describe("authority surface", () => {
  it("pins the barrel export list", async () => {
    const surface = await import("./index.js");
    expect(Object.keys(surface).sort()).toMatchInlineSnapshot(`
      [
        "AuthorityClaimConflictError",
        "AuthorizedEffectExecutor",
        "classifyAction",
        "evaluateAction",
      ]
    `);
  });
});
