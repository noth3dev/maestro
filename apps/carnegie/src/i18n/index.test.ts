import { describe, expect, it } from "vitest";
import { localeFromPreferences } from "./index.js";

describe("persisted locale", () => {
  it("uses the persisted Korean preference and safely defaults unknown values", () => {
    expect(localeFromPreferences("ko")).toBe("ko");
    expect(localeFromPreferences("en")).toBe("en");
    expect(localeFromPreferences(undefined)).toBe("en");
  });
});
