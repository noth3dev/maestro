import { describe, expect, it } from "vitest";

describe("local-backend surface", () => {
  it("pins the barrel export list", async () => {
    const surface = await import("./index.js");
    expect(Object.keys(surface).sort()).toMatchInlineSnapshot();
  });
});
