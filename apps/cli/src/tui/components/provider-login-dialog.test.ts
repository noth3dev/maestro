import { describe, expect, it } from "vitest";
import { renderProviderLoginDialog } from "./provider-login-dialog.js";

describe("provider login dialog", () => {
  it("shows a selectable Codex account and an explicitly blocked Anthropic subscription", () => {
    const rendered = renderProviderLoginDialog(120, 0, "selecting").join("\n");
    expect(rendered).toContain("ChatGPT Plus / Pro");
    expect(rendered).toContain("OpenAI Codex account");
    expect(rendered).toContain("Claude Pro / Max");
    expect(rendered).toContain("provider approval required");
    expect(rendered).toContain("Enter continue");
  });
  it("shows a compact chooser with visible controls at supported narrow heights", () => {
    const ansiEscapePattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
    for (const width of [40, 80]) {
      const lines = renderProviderLoginDialog(width, 0, "selecting", undefined, true).map((line) => line.replace(ansiEscapePattern, ""));
      expect(lines).toEqual([
        "Sign in to Maestro",
        "› ChatGPT Plus / Pro",
        "  Claude Pro / Max (unavailable)",
        "↑/↓ choose · Enter continue · Esc cancel",
      ]);
      expect(lines.every((line) => line.length <= width)).toBe(true);
    }

    const anthropic = renderProviderLoginDialog(40, 1, "selecting", undefined, true).map((line) => line.replace(ansiEscapePattern, ""));
    expect(anthropic[1]).toBe("› Claude Pro / Max (unavailable)");
    expect(anthropic[2]).toBe("  ChatGPT Plus / Pro");
  });

  it("shows the login URL and copy shortcut while waiting", () => {
    const rendered = renderProviderLoginDialog(180, 0, "waiting", "https://auth.openai.com/oauth/authorize?state=test").join("\n");
    expect(rendered).toContain("https://auth.openai.com/oauth/authorize?state=test");
    expect(rendered).toContain("Alt+C copy link");
  });
});
