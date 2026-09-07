import { describe, expect, it } from "vitest";
import { createCommandPalette } from "./palette.js";

describe("command palette", () => {
  it("lists commands with their read/write safety classification", () => {
    const items = createCommandPalette();
    expect(items.find((item) => item.value === "/goal pause")).toMatchObject({ label: "/goal pause", description: "write" });
    expect(items.find((item) => item.value === "/goal emergency-stop")).toMatchObject({ label: "/goal emergency-stop", description: "critical" });
    expect(items.find((item) => item.value === "/goals list")).toMatchObject({ label: "/goals list", description: "read" });
  });
});
