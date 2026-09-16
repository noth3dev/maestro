import { describe, expect, it } from "vitest";
import { resolveConfiguredModel } from "./entry.js";

describe("configured model selection", () => {
  it("trims the environment model and falls back to the session model", () => {
    expect(resolveConfiguredModel("  openai/gpt-5  ", "anthropic/claude")).toBe("openai/gpt-5");
    expect(resolveConfiguredModel("   ", "anthropic/claude")).toBe("anthropic/claude");
    expect(resolveConfiguredModel(undefined, undefined)).toBeUndefined();
  });
});
